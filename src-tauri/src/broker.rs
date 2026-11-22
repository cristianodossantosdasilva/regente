//! Broker local: servidor JSON-RPC (uma linha JSON por requisição) sobre named pipe.
//!
//! Segurança: o pipe rejeita clientes remotos e toda chamada precisa do token de sessão, que só
//! existe no ambiente dos terminais criados pelo app. Mensagens entre agentes só trafegam por
//! conexões desenhadas no canvas, e a injeção no PTY de destino acontece exclusivamente aqui.
use crate::ansi::{last_lines, strip_ansi};
use crate::orchestrator::{is_unsafe_char, validate_work, Deny, LogEntry};
use crate::pty::now_ms;
use crate::state::{AppState, Pending};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

/// Emite um evento para a UI (no app: `AppHandle::emit`; nos testes: coletor).
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Clone)]
pub struct Ctx {
    pub state: Arc<AppState>,
    pub emit: Emit,
}

#[derive(Deserialize)]
struct Req {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Remove caracteres de controle (incluindo ESC) para impedir injeção de sequências de terminal.
pub fn sanitize(text: &str) -> String {
    text.chars()
        .filter(|c| *c == '\n' || *c == '\t' || !is_unsafe_char(*c))
        .collect()
}

/// Rótulo de uma linha só (nomes, títulos, status): sem quebras, controles, bidi nem zero-width.
pub fn clean_label(text: &str, max: usize) -> String {
    text.chars()
        .filter(|c| !is_unsafe_char(*c))
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Teto de tamanho de mensagens e de notas (DoS).
pub const MAX_MSG: usize = 32 * 1024;
pub const MAX_NOTE: usize = 256 * 1024;
pub const MAX_LINE: u64 = 1024 * 1024;

/// Log de auditoria append-only (JSONL) em `<dados>/logs/orchestration.jsonl`; rotaciona em 5 MB.
fn audit(data_dir: &std::path::Path, entry: &LogEntry) {
    use std::io::Write;
    let dir = data_dir.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join("orchestration.jsonl");
    if std::fs::metadata(&file)
        .map(|m| m.len() > 5 * 1024 * 1024)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&file, dir.join("orchestration.1.jsonl"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
    {
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = writeln!(f, "{line}");
        }
    }
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}

impl Ctx {
    fn log(&self, kind: &str, from: &str, to: &str, depth: u8, body: &str) -> String {
        let id = short_id();
        let entry = LogEntry {
            id: id.clone(),
            ts: now_ms(),
            kind: kind.into(),
            from: from.into(),
            to: to.into(),
            depth,
            body: body.chars().take(2000).collect(),
        };
        self.state.orch.lock().unwrap().push_log(entry.clone());
        audit(&self.state.data_dir, &entry);
        (self.emit)(
            "activity",
            serde_json::to_value(&entry).unwrap_or(Value::Null),
        );
        id
    }

    /// Dispara uma rotina agendada: pré-checagem opcional, `{{output}}`, sanitização, pausa global e auditoria.
    /// Só a interface (comando Tauri) chama isto; agentes não conseguem criar nem disparar rotinas pelo pipe.
    pub async fn fire_routine(
        &self,
        term: &str,
        title: &str,
        text: &str,
        pre_run: Option<String>,
        cwd: Option<String>,
        reminder: bool,
    ) -> Result<String, String> {
        {
            let o = self.state.orch.lock().unwrap();
            if o.paused {
                return Ok("pausada".into());
            }
            if !o.terms.contains_key(term) {
                return Err("o agente da rotina não existe mais".into());
            }
        }
        let mut body = text.to_string();
        if let Some(cmd) = pre_run.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            let (cmd, cwd) = (cmd.to_string(), cwd);
            let out = tokio::time::timeout(
                Duration::from_secs(90),
                tokio::task::spawn_blocking(move || run_pre(&cmd, cwd.as_deref())),
            )
            .await
            .map_err(|_| "pré-execução excedeu o tempo".to_string())?
            .map_err(|e| e.to_string())?;
            match out {
                Some(o) => body = body.replace("{{output}}", &o),
                None => {
                    self.log(
                        "routine",
                        "rotina",
                        term,
                        0,
                        &format!("{title}: ignorada (pré-execução sem saída ou com erro)"),
                    );
                    return Ok("ignorada".into());
                }
            }
        } else {
            body = body.replace("{{output}}", "");
        }
        let body: String = sanitize(&body).chars().take(4000).collect();
        if body.trim().is_empty() {
            return Err("rotina sem texto".into());
        }
        // A pausa pode ter sido ligada durante a pré-execução (até 60 s).
        if self.state.orch.lock().unwrap().paused {
            return Ok("pausada".into());
        }
        if reminder {
            let name = self.name_of(term);
            self.log("routine", "rotina", term, 0, &format!("{title}: lembrete"));
            (self.emit)(
                "agent-notify",
                json!({"id": term, "name": format!("{title} ({name})"), "text": body.chars().take(500).collect::<String>()}),
            );
            return Ok("lembrete".into());
        }
        self.inject(term, &body).await?;
        self.log(
            "routine",
            "rotina",
            term,
            0,
            &format!("{title}: {}", body.chars().take(200).collect::<String>()),
        );
        Ok("enviada".into())
    }

    fn name_of(&self, id: &str) -> String {
        let o = self.state.orch.lock().unwrap();
        o.terms
            .get(id)
            .map(|t| t.name.clone())
            .or_else(|| o.notes.get(id).map(|n| n.title.clone()))
            .unwrap_or_else(|| id.to_string())
    }

    /// Injeta texto no PTY de destino (somente o broker faz isso).
    async fn inject(&self, to: &str, text: &str) -> Result<(), String> {
        let paste = self
            .state
            .orch
            .lock()
            .unwrap()
            .terms
            .get(to)
            .map(|t| t.paste)
            .unwrap_or(false);
        let clean = sanitize(text);
        if paste {
            self.state
                .pty
                .write(to, format!("\x1b[200~{clean}\x1b[201~").as_bytes())?;
        } else {
            // Shell comum: vira comentário para não ser executado/parseado como comando.
            let flat = format!("# {}", clean.replace('\n', " | "));
            self.state.pty.write(to, flat.as_bytes())?;
        }
        tokio::time::sleep(Duration::from_millis(180)).await;
        self.state.pty.write(to, b"\r")
    }

    async fn deliver(&self, from: &str, params: &Value, kind: &str) -> Result<Value, String> {
        let target_q = s(params, "to");
        let body = s(params, "body");
        if body.trim().is_empty() {
            return Err("mensagem vazia".into());
        }
        if body.len() > MAX_MSG {
            return Err(format!(
                "mensagem grande demais (máx. {} KiB)",
                MAX_MSG / 1024
            ));
        }
        let wait = params
            .get("wait")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let timeout = params
            .get("timeoutS")
            .and_then(|v| v.as_u64())
            .unwrap_or(300)
            .clamp(5, 3600);

        // 1) autorização
        let (to, depth, confirm) = {
            let mut o = self.state.orch.lock().unwrap();
            let to = o.resolve_peer(from, &target_q);
            let to = match to {
                Ok(t) => t,
                Err(e) => {
                    drop(o);
                    self.log("denied", from, &target_q, 0, &e.to_string());
                    return Err(e.to_string());
                }
            };
            match o.authorize_send(from, &to, Instant::now()) {
                Ok(depth) => {
                    let confirm = o.needs_confirm(from, &to);
                    (to, depth, confirm)
                }
                Err(e) => {
                    drop(o);
                    self.log("denied", from, &to, 0, &e.to_string());
                    return Err(e.to_string());
                }
            }
        };
        let from_name = self.name_of(from);

        // 2) confirmação humana opcional
        if confirm {
            let req_id = short_id();
            let (tx, rx) = oneshot::channel();
            self.state
                .confirms
                .lock()
                .unwrap()
                .insert(req_id.clone(), tx);
            (self.emit)(
                "confirm-request",
                json!({"id": req_id, "from": from, "fromName": from_name, "to": to, "toName": self.name_of(&to), "body": sanitize(&body).chars().take(1000).collect::<String>(), "bodyLen": body.chars().count()}),
            );
            let ok = matches!(
                tokio::time::timeout(Duration::from_secs(120), rx).await,
                Ok(Ok(true))
            );
            self.state.confirms.lock().unwrap().remove(&req_id);
            if !ok {
                self.log(
                    "denied",
                    from,
                    &to,
                    depth,
                    "recusada pelo usuário (ou sem resposta)",
                );
                return Err("envio não confirmado pelo usuário".into());
            }
            // O usuário pode ter pausado ou apagado a conexão enquanto o diálogo estava aberto.
            let o = self.state.orch.lock().unwrap();
            if o.paused {
                return Err(Deny::Paused.to_string());
            }
            if o.edge_between(from, &to).is_none() {
                return Err(Deny::NotConnected.to_string());
            }
        }

        // 3) registro, injeção e profundidade
        let msg_id = self.log(kind, from, &to, depth, &body);
        let (tx, rx) = oneshot::channel();
        self.state.pending.lock().unwrap().insert(
            msg_id.clone(),
            Pending {
                from: from.into(),
                to: to.clone(),
                depth,
                wait: if wait { Some(tx) } else { None },
            },
        );
        let text = if kind == "ask" {
            format!("[Regente] {from_name} pergunta (id {msg_id}): {body}\n(Responda com: regente reply {msg_id} \"<resposta>\" — ou use a ferramenta regente_reply)")
        } else {
            format!("[Regente] Mensagem de {from_name} (id {msg_id}): {body}\n(Se precisar responder: regente reply {msg_id} \"<resposta>\")")
        };
        if let Err(e) = self.inject(&to, &text).await {
            self.state.pending.lock().unwrap().remove(&msg_id);
            return Err(format!("falha ao entregar: {e}"));
        }
        self.state
            .orch
            .lock()
            .unwrap()
            .mark_delivered(&to, depth, Instant::now());

        if !wait {
            return Ok(json!({"id": msg_id, "delivered": true}));
        }
        match tokio::time::timeout(Duration::from_secs(timeout), rx).await {
            Ok(Ok(reply)) => Ok(json!({"id": msg_id, "reply": reply})),
            _ => {
                // A resposta tardia será reenviada ao terminal remetente.
                if let Some(p) = self.state.pending.lock().unwrap().get_mut(&msg_id) {
                    p.wait = None;
                }
                Err(format!("tempo esgotado ({timeout}s) sem resposta; se chegar depois, será entregue ao seu terminal (id {msg_id})"))
            }
        }
    }

    async fn reply(&self, from: &str, params: &Value) -> Result<Value, String> {
        let id = s(params, "id");
        let body = sanitize(&s(params, "body"));
        if body.len() > MAX_MSG {
            return Err(format!(
                "resposta grande demais (máx. {} KiB)",
                MAX_MSG / 1024
            ));
        }
        if self.state.orch.lock().unwrap().paused {
            return Err(Deny::Paused.to_string());
        }
        let pend = {
            let mut p = self.state.pending.lock().unwrap();
            match p.get(&id) {
                Some(x) if x.to == from => p.remove(&id),
                Some(_) => return Err("você não é o destinatário dessa mensagem".into()),
                None => return Err("mensagem desconhecida ou já respondida".into()),
            }
        };
        let pend = pend.ok_or("mensagem desconhecida")?;
        self.log("reply", from, &pend.from, pend.depth, &body);
        let delivered_inline = match pend.wait {
            Some(tx) => tx.send(body.clone()).is_ok(),
            None => false,
        };
        if !delivered_inline {
            let name = self.name_of(from);
            self.inject(
                &pend.from,
                &format!("[Regente] Resposta de {name} à mensagem {id}: {body}"),
            )
            .await?;
            self.state
                .orch
                .lock()
                .unwrap()
                .mark_delivered(&pend.from, pend.depth, Instant::now());
        }
        Ok(json!({"ok": true}))
    }

    /// Só terminais marcados como coordenador podem alterar a topologia; respeita a pausa global.
    fn require_coordinator(&self, from: &str) -> Result<(), String> {
        let o = self.state.orch.lock().unwrap();
        if o.paused {
            return Err(Deny::Paused.to_string());
        }
        match o.terms.get(from) {
            Some(t) if t.coordinator => Ok(()),
            Some(_) => Err("apenas terminais marcados como coordenador podem fazer isso (paleta: Alternar coordenador)".into()),
            None => Err(Deny::UnknownSender.to_string()),
        }
    }

    /// Pede à interface que execute uma operação de topologia e espera a resposta (até 10 s).
    async fn coord_call(&self, from: &str, op: &str, params: Value) -> Result<Value, String> {
        let id = short_id();
        let (tx, rx) = oneshot::channel();
        self.state.coords.lock().unwrap().insert(id.clone(), tx);
        let expires = now_ms() + 10_000;
        (self.emit)(
            "coord-request",
            json!({"id": id, "op": op, "from": from, "params": params, "expiresAt": expires}),
        );
        let res = tokio::time::timeout(Duration::from_secs(10), rx).await;
        self.state.coords.lock().unwrap().remove(&id);
        match res {
            Ok(Ok(r)) => r,
            _ => Err("a interface não respondeu a tempo (há um workspace aberto?)".into()),
        }
    }

    async fn handle(&self, method: &str, params: Value) -> Result<Value, String> {
        // O remetente vem do token (um por terminal), nunca de um campo informado pelo cliente.
        let from = self
            .state
            .term_for_token(&s(&params, "token"))
            .ok_or("não autorizado")?;
        let claimed = s(&params, "from");
        if !claimed.is_empty() && claimed != from {
            self.log(
                "denied",
                &from,
                &claimed,
                0,
                "tentativa de se passar por outro terminal",
            );
            return Err("não autorizado".into());
        }
        match method {
            "peers" => {
                let o = self.state.orch.lock().unwrap();
                if !o.terms.contains_key(&from) {
                    return Err(Deny::UnknownSender.to_string());
                }
                let notes: Vec<Value> = o
                    .notes_for(&from)
                    .iter()
                    .map(|n| json!({"id": n.id, "title": n.title}))
                    .collect();
                let me = &o.terms[&from];
                let me_json = json!({"id": me.id, "name": me.name, "profile": me.profile, "state": o.agent_state.get(&from), "work": o.work.get(&from)});
                Ok(
                    json!({"self": me_json, "peers": o.peers(&from), "notes": notes, "paused": o.paused}),
                )
            }
            "send" => self.deliver(&from, &params, "send").await,
            "ask" => self.deliver(&from, &params, "ask").await,
            "reply" => self.reply(&from, &params).await,
            "read" => {
                let peer = {
                    let o = self.state.orch.lock().unwrap();
                    o.resolve_peer(&from, &s(&params, "peer"))
                        .map_err(|e| e.to_string())?
                };
                let n = params
                    .get("last")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(40)
                    .clamp(1, 500) as usize;
                let raw = self
                    .state
                    .pty
                    .tail(&peer, 256 * 1024)
                    .ok_or("terminal inexistente")?;
                let text = last_lines(&strip_ansi(&raw), n);
                self.log("read", &from, &peer, 0, &format!("últimas {n} linhas"));
                Ok(json!({"text": text}))
            }
            "keys" => {
                let raw = s(&params, "keys");
                let bytes = decode_escapes(&raw)?;
                let (to, label) = {
                    let mut o = self.state.orch.lock().unwrap();
                    if o.paused {
                        return Err(Deny::Paused.to_string());
                    }
                    let to = o
                        .resolve_peer(&from, &s(&params, "to"))
                        .map_err(|e| e.to_string())?;
                    if !o.keys_allowed(&from, &to) {
                        drop(o);
                        self.log(
                            "denied",
                            &from,
                            &to,
                            0,
                            "keys: a conexão não permite envio de teclas",
                        );
                        return Err("a conexão não permite envio de teclas (ative \"Permitir teclas\" na linha de conexão)".into());
                    }
                    if o.needs_confirm(&from, &to) {
                        drop(o);
                        self.log(
                            "denied",
                            &from,
                            &to,
                            0,
                            "keys: a conexão exige confirmação humana",
                        );
                        return Err(
                            "`keys` não é permitido em conexões que exigem confirmação humana"
                                .into(),
                        );
                    }
                    o.authorize_send(&from, &to, Instant::now())
                        .map_err(|e| e.to_string())?;
                    (
                        to.clone(),
                        o.terms.get(&to).map(|t| t.name.clone()).unwrap_or(to),
                    )
                };
                self.log(
                    "keys",
                    &from,
                    &to,
                    0,
                    &format!(
                        "{} byte(s): {}",
                        bytes.len(),
                        raw.chars().take(200).collect::<String>()
                    ),
                );
                self.state.pty.write(&to, &bytes)?;
                tokio::time::sleep(Duration::from_millis(450)).await;
                let raw_out = self.state.pty.tail(&to, 64 * 1024).unwrap_or_default();
                Ok(json!({"text": last_lines(&strip_ansi(&raw_out), 25), "to": label}))
            }
            "recruit" => {
                self.require_coordinator(&from)?;
                let profile = s(&params, "profile");
                if profile.trim().is_empty() {
                    return Err("informe o perfil do agente (ex.: claude, kiro, shell)".into());
                }
                let name = clean_label(&s(&params, "name"), 60);
                {
                    let mut o = self.state.orch.lock().unwrap();
                    if !o.allow_topology(&from, Instant::now()) {
                        return Err("limite de operações de topologia por minuto excedido".into());
                    }
                    o.reserve_recruit(&from)?;
                }
                let called = self
                    .coord_call(
                        &from,
                        "recruit",
                        json!({"profile": profile, "name": name, "cwd": s(&params, "cwd")}),
                    )
                    .await;
                self.state.orch.lock().unwrap().release_recruit(&from);
                let r = called?;
                let child = r["id"]
                    .as_str()
                    .ok_or("resposta inválida da interface")?
                    .to_string();
                self.state
                    .orch
                    .lock()
                    .unwrap()
                    .record_recruit(&from, &child, Instant::now());
                self.log(
                    "recruit",
                    &from,
                    &child,
                    0,
                    &format!(
                        "recrutou {} ({})",
                        r["name"].as_str().unwrap_or("?"),
                        profile.trim()
                    ),
                );
                Ok(r)
            }
            "connect" => {
                self.require_coordinator(&from)?;
                let (a, b) = {
                    let o = self.state.orch.lock().unwrap();
                    (
                        o.resolve_managed(&from, &s(&params, "a"))?,
                        o.resolve_managed(&from, &s(&params, "b"))?,
                    )
                };
                if a == b {
                    return Err("escolha dois agentes diferentes".into());
                }
                if !self
                    .state
                    .orch
                    .lock()
                    .unwrap()
                    .allow_topology(&from, Instant::now())
                {
                    return Err("limite de operações de topologia por minuto excedido".into());
                }
                let bi = params
                    .get("bidirectional")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                self.coord_call(
                    &from,
                    "connect",
                    json!({"a": a, "b": b, "bidirectional": bi}),
                )
                .await?;
                self.log(
                    "connect",
                    &a,
                    &b,
                    0,
                    if bi {
                        "conexão bidirecional criada pelo coordenador"
                    } else {
                        "conexão criada pelo coordenador"
                    },
                );
                Ok(json!({"ok": true}))
            }
            "dismiss" => {
                self.require_coordinator(&from)?;
                let id = {
                    let o = self.state.orch.lock().unwrap();
                    let id = o.resolve_managed(&from, &s(&params, "name"))?;
                    if id == from {
                        return Err("o coordenador não pode dispensar a si mesmo".into());
                    }
                    id
                };
                if !self
                    .state
                    .orch
                    .lock()
                    .unwrap()
                    .allow_topology(&from, Instant::now())
                {
                    return Err("limite de operações de topologia por minuto excedido".into());
                }
                let name = self.name_of(&id);
                self.coord_call(&from, "dismiss", json!({"id": id})).await?;
                self.state.orch.lock().unwrap().recruited.remove(&id);
                self.log("dismiss", &from, &id, 0, &format!("dispensou {name}"));
                Ok(json!({"ok": true}))
            }
            "ping" => {
                let o = self.state.orch.lock().unwrap();
                let me = o
                    .terms
                    .get(&from)
                    .ok_or_else(|| Deny::UnknownSender.to_string())?;
                Ok(json!({
                    "ok": true,
                    "version": env!("CARGO_PKG_VERSION"),
                    "terminal": {"id": me.id, "name": me.name, "profile": me.profile},
                    "paused": o.paused,
                    "connections": o.peers(&from).len(),
                    "notes": o.notes_for(&from).len(),
                }))
            }
            "status" => {
                let w = validate_work(
                    &s(&params, "text"),
                    &s(&params, "state"),
                    params.get("progress").and_then(|v| v.as_str()),
                )?;
                let name = {
                    let mut o = self.state.orch.lock().unwrap();
                    if !o.allow_status(&from, Instant::now()) {
                        return Err("status em excesso: aguarde alguns segundos".into());
                    }
                    o.set_work(&from, w.clone()).map_err(|e| e.to_string())?;
                    o.terms[&from].name.clone()
                };
                let shown = match &w.progress {
                    Some(p) => format!("[{}] {} ({p})", w.state, w.text),
                    None => format!("[{}] {}", w.state, w.text),
                };
                self.log("status", &from, &from, 0, &shown);
                (self.emit)(
                    "work-status",
                    json!({"id": from, "name": name, "status": w}),
                );
                Ok(json!({"ok": true}))
            }
            "notify" => {
                let text: String = sanitize(&s(&params, "text")).chars().take(500).collect();
                if text.trim().is_empty() {
                    return Err("mensagem vazia".into());
                }
                let name = {
                    let mut o = self.state.orch.lock().unwrap();
                    if o.paused {
                        return Err(Deny::Paused.to_string());
                    }
                    if !o.terms.contains_key(&from) {
                        return Err(Deny::UnknownSender.to_string());
                    }
                    if !o.allow_notify(&from, Instant::now()) {
                        return Err("limite de notificações: aguarde alguns segundos".into());
                    }
                    o.terms[&from].name.clone()
                };
                self.log("notify", &from, "usuário", 0, &text);
                (self.emit)(
                    "agent-notify",
                    json!({"id": from, "name": clean_label(&name, 60), "text": text}),
                );
                Ok(json!({"ok": true}))
            }
            "note_list" => {
                let o = self.state.orch.lock().unwrap();
                Ok(
                    json!({"notes": o.notes_for(&from).iter().map(|n| json!({"id": n.id, "title": n.title})).collect::<Vec<_>>()}),
                )
            }
            "note_read" => {
                let o = self.state.orch.lock().unwrap();
                let id = o
                    .resolve_note(&from, &s(&params, "note"))
                    .ok_or("nota não conectada a este terminal")?;
                let n = &o.notes[&id];
                let offset = params
                    .get("offset")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize);
                let limit = params
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize);
                let (text, total) = slice_lines(&n.text, offset, limit);
                Ok(json!({"title": n.title, "text": text, "totalLines": total}))
            }
            "note_write" | "note_edit" => {
                let (id, title, full) = {
                    let mut o = self.state.orch.lock().unwrap();
                    if o.paused {
                        return Err(Deny::Paused.to_string());
                    }
                    let id = o
                        .resolve_note(&from, &s(&params, "note"))
                        .ok_or("nota não conectada a este terminal")?;
                    let n = o.notes.get_mut(&id).unwrap();
                    if method == "note_write" {
                        let t = sanitize(&s(&params, "text"));
                        if t.len() > MAX_NOTE {
                            return Err(format!(
                                "a nota ficaria maior que {} KiB",
                                MAX_NOTE / 1024
                            ));
                        }
                        n.text = t;
                    } else {
                        n.text = edit_once(
                            &n.text,
                            &sanitize(&s(&params, "old")),
                            &sanitize(&s(&params, "new")),
                        )?;
                    }
                    (id, n.title.clone(), n.text.clone())
                };
                let what = if method == "note_write" {
                    "substituiu"
                } else {
                    "editou um trecho de"
                };
                self.log("note", &from, &id, 0, &format!("{what} a nota '{title}'"));
                (self.emit)("note-updated", json!({"id": id, "text": full}));
                Ok(json!({"ok": true}))
            }
            "note_add" => {
                let (id, title, full) = {
                    let mut o = self.state.orch.lock().unwrap();
                    if o.paused {
                        return Err(Deny::Paused.to_string());
                    }
                    let id = o
                        .resolve_note(&from, &s(&params, "note"))
                        .ok_or("nota não conectada a este terminal")?;
                    let add = sanitize(&s(&params, "text"));
                    let n = o.notes.get_mut(&id).unwrap();
                    if n.text.len() + add.len() > MAX_NOTE {
                        return Err(format!("a nota ficaria maior que {} KiB", MAX_NOTE / 1024));
                    }
                    if !n.text.is_empty() && !n.text.ends_with('\n') {
                        n.text.push('\n');
                    }
                    n.text.push_str(&add);
                    n.text.push('\n');
                    (id, n.title.clone(), n.text.clone())
                };
                self.log(
                    "note",
                    &from,
                    &id,
                    0,
                    &format!("adicionou texto à nota '{title}'"),
                );
                (self.emit)("note-updated", json!({"id": id, "text": full}));
                Ok(json!({"ok": true}))
            }
            other => Err(format!("método desconhecido: {other}")),
        }
    }

    async fn handle_line(&self, line: &str) -> String {
        let resp = match serde_json::from_str::<Req>(line) {
            Err(e) => json!({"id": null, "error": {"message": format!("JSON inválido: {e}")}}),
            Ok(req) => match self.handle(&req.method, req.params).await {
                Ok(r) => json!({"id": req.id, "result": r}),
                Err(m) => json!({"id": req.id, "error": {"message": m}}),
            },
        };
        resp.to_string()
    }
}

#[cfg(windows)]
pub async fn serve(ctx: Ctx) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = ctx.state.pipe_name.clone();
    let mut server = match ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&name)
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[regente] broker não iniciou: {e}");
            return;
        }
    };
    loop {
        if server.connect().await.is_err() {
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        }
        let next = match ServerOptions::new()
            .reject_remote_clients(true)
            .create(&name)
        {
            Ok(n) => n,
            Err(e) => {
                eprintln!("[regente] broker: {e}");
                return;
            }
        };
        let conn = std::mem::replace(&mut server, next);
        let c = ctx.clone();
        tauri::async_runtime::spawn(async move {
            let (r, mut w) = tokio::io::split(conn);
            let mut reader = BufReader::new(r);
            let mut line = String::new();
            loop {
                line.clear();
                let n = match (&mut reader).take(MAX_LINE).read_line(&mut line).await {
                    Ok(n) => n,
                    Err(_) => break,
                };
                if n == 0 {
                    break;
                }
                if !line.ends_with('\n') && n as u64 >= MAX_LINE {
                    let _ = w
                        .write_all(
                            b"{\"id\":null,\"error\":{\"message\":\"requisicao grande demais\"}}\n",
                        )
                        .await;
                    break;
                }
                if line.trim().is_empty() {
                    continue;
                }
                let out = c.handle_line(&line).await;
                if w.write_all(format!("{out}\n").as_bytes()).await.is_err() {
                    break;
                }
            }
        });
    }
}

#[cfg(not(windows))]
pub async fn serve(_ctx: Ctx) {
    eprintln!("[regente] broker por named pipe só está implementado para Windows");
}

/// Executa o comando de pré-checagem de uma rotina (PowerShell, até 60 s) e devolve a saída.
/// `None` = falhou, estourou o tempo ou não produziu saída: a rotina não deve acordar o agente.
/// Nunca trava: um processo neto que segure o pipe não impede o retorno (a saída lida até ali é usada).
pub fn run_pre(cmd: &str, cwd: Option<&str>) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    // Força UTF-8 na saída do PowerShell (senão sai em OEM e os acentos viram lixo).
    let script = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {cmd}");
    let mut c = Command::new("powershell.exe");
    c.args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(d) = cwd.filter(|d| !d.trim().is_empty() && std::path::Path::new(d).is_dir()) {
        c.current_dir(d);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = c.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let done = Arc::new(AtomicBool::new(false));
    {
        let (buf, done) = (buf.clone(), done.clone());
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = stdout.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                let mut b = buf.lock().unwrap();
                if b.len() < 64 * 1024 {
                    let take = n.min(64 * 1024 - b.len());
                    b.extend_from_slice(&chunk[..take]);
                } // excedente é descartado, mas continua lendo para não bloquear quem escreve
            }
            done.store(true, Ordering::Relaxed);
        });
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                kill_process_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    // Dá até 1,5 s para o leitor esvaziar o pipe; se um neto o segura, segue com o que já foi lido.
    let grace = Instant::now() + Duration::from_millis(1500);
    while !done.load(Ordering::Relaxed) && Instant::now() < grace {
        std::thread::sleep(Duration::from_millis(25));
    }
    let out = String::from_utf8_lossy(&buf.lock().unwrap()).into_owned();
    let text: String = out.trim().chars().take(8000).collect();
    match status {
        Some(st) if st.success() && !text.is_empty() => Some(text),
        _ => None,
    }
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .creation_flags(0x0800_0000)
        .output();
}
#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

/// Decodifica escapes de teclas: `\n` Enter, `\t` Tab, `\e` ESC, `\xNN` byte, `\\` barra. Máx. 512 bytes.
pub fn decode_escapes(s: &str) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            let mut buf = [0u8; 4];
            out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            continue;
        }
        match it.next() {
            Some('n') => out.push(b'\r'),
            Some('t') => out.push(b'\t'),
            Some('e') => out.push(0x1b),
            Some('\\') => out.push(b'\\'),
            Some('x') => {
                let h: String = [it.next(), it.next()].into_iter().flatten().collect();
                out.push(
                    u8::from_str_radix(&h, 16)
                        .map_err(|_| format!("escape \\x inválido: '{h}'"))?,
                );
            }
            Some(o) => {
                out.push(b'\\');
                let mut buf = [0u8; 4];
                out.extend_from_slice(o.encode_utf8(&mut buf).as_bytes());
            }
            None => out.push(b'\\'),
        }
        if out.len() > 512 {
            return Err("sequência de teclas longa demais (máx. 512 bytes)".into());
        }
    }
    if out.is_empty() {
        return Err("nenhuma tecla informada".into());
    }
    if out.len() > 512 {
        return Err("sequência de teclas longa demais (máx. 512 bytes)".into());
    }
    Ok(out)
}

/// Fatia por linhas (offset 1-based). Sem argumentos devolve tudo. Retorna (trecho, total de linhas).
pub fn slice_lines(text: &str, offset: Option<usize>, limit: Option<usize>) -> (String, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    if offset.is_none() && limit.is_none() {
        return (text.to_string(), total);
    }
    let start = offset.unwrap_or(1).max(1) - 1;
    let end = limit
        .map(|l| start.saturating_add(l))
        .unwrap_or(total)
        .min(total);
    if start >= total {
        return (String::new(), total);
    }
    (lines[start..end].join("\n"), total)
}

/// Troca `old` por `new` somente se `old` ocorrer exatamente uma vez (evita edição no lugar errado).
pub fn edit_once(text: &str, old: &str, new: &str) -> Result<String, String> {
    if old.is_empty() {
        return Err("trecho antigo vazio".into());
    }
    match text.matches(old).count() {
        0 => Err("trecho não encontrado na nota".into()),
        1 => Ok(text.replacen(old, new, 1)),
        n => Err(format!(
            "trecho ambíguo: aparece {n} vezes; use um trecho maior"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_escape_sequences() {
        assert_eq!(
            sanitize("oi\x1b[31m\x07 ok\nlinha2\t!"),
            "oi[31m ok\nlinha2\t!"
        );
    }

    #[test]
    fn sanitize_and_labels_drop_bidi_zero_width_and_line_separators() {
        assert_eq!(
            sanitize("a\u{202E}b\u{200B}c\u{2028}d\u{2029}e\nf"),
            "abcde\nf"
        );
        assert_eq!(clean_label("  Rev\nisor\u{202E}  ", 60), "Revisor");
        assert_eq!(clean_label("abcdef", 3), "abc");
    }

    #[test]
    fn run_pre_does_not_hang_when_a_grandchild_holds_the_pipe() {
        let t0 = Instant::now();
        let out = run_pre(
            "Start-Process -NoNewWindow ping -ArgumentList '-n','25','127.0.0.1'",
            None,
        );
        assert!(
            t0.elapsed() < Duration::from_secs(20),
            "run_pre travou por {:?}",
            t0.elapsed()
        );
        assert!(out.is_some(), "deveria devolver o que foi lido até ali");
    }

    #[test]
    fn run_pre_keeps_accents() {
        assert_eq!(
            run_pre("Write-Output 'ação útil'", None).as_deref(),
            Some("ação útil")
        );
    }

    #[test]
    fn run_pre_returns_output_or_none() {
        assert_eq!(
            run_pre("Write-Output 'ola rotina'", None).as_deref(),
            Some("ola rotina")
        );
        assert_eq!(
            run_pre("Write-Output ''", None),
            None,
            "sem saída não acorda o agente"
        );
        assert_eq!(
            run_pre("Write-Output 'x'; exit 3", None),
            None,
            "código de saída != 0"
        );
    }

    #[test]
    fn decode_escapes_rules() {
        assert_eq!(decode_escapes("2\\n").unwrap(), b"2\r");
        assert_eq!(
            decode_escapes("\\e[A\\t\\x03").unwrap(),
            vec![0x1b, b'[', b'A', b'\t', 3]
        );
        assert_eq!(decode_escapes("a\\\\b\\q").unwrap(), b"a\\b\\q");
        assert_eq!(decode_escapes("ação").unwrap(), "ação".as_bytes());
        assert!(decode_escapes("").is_err());
        assert!(decode_escapes("\\xZZ").is_err());
        assert!(decode_escapes(&"a".repeat(600)).is_err());
    }

    #[test]
    fn slice_lines_by_range() {
        let t = "a\nb\nc\nd";
        assert_eq!(slice_lines(t, None, None), ("a\nb\nc\nd".to_string(), 4));
        assert_eq!(slice_lines(t, Some(2), Some(2)), ("b\nc".to_string(), 4));
        assert_eq!(slice_lines(t, Some(3), None), ("c\nd".to_string(), 4));
        assert_eq!(slice_lines(t, Some(9), Some(2)), (String::new(), 4));
        assert_eq!(slice_lines(t, Some(0), Some(1)), ("a".to_string(), 4));
    }

    #[test]
    fn edit_once_requires_unique_match() {
        assert_eq!(edit_once("um dois tres", "dois", "2").unwrap(), "um 2 tres");
        assert!(edit_once("x x", "x", "y").unwrap_err().contains("ambíguo"));
        assert!(edit_once("abc", "z", "y")
            .unwrap_err()
            .contains("não encontrado"));
        assert!(edit_once("abc", "", "y").is_err());
    }
}
