//! Teste de integração da orquestração: broker real (named pipe) + PTYs reais (cmd.exe) + cliente da CLI.
#![cfg(windows)]

use regente_client::{call, Env};
use regente_lib::broker::{serve, Ctx, Emit};
use regente_lib::orchestrator::{Edge, NoteInfo, TermInfo};
use regente_lib::pty::{ExitSink, OutputSink, SpawnSpec};
use regente_lib::state::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Harness {
    state: Arc<AppState>,
    events: Arc<Mutex<Vec<(String, Value)>>>,
}

fn term(id: &str, name: &str) -> TermInfo {
    TermInfo {
        id: id.into(),
        name: name.into(),
        profile: "shell".into(),
        paste: false,
        coordinator: false,
    }
}
fn edge(id: &str, from: &str, to: &str, bidi: bool, confirm: bool) -> Edge {
    Edge {
        id: id.into(),
        from: from.into(),
        to: to.into(),
        bidirectional: bidi,
        confirm,
        allow_keys: false,
    }
}

fn spawn_cmd(state: &AppState, id: &str) {
    let out: OutputSink = Arc::new(|_, _, _| {});
    let ex: ExitSink = Arc::new(|_, _| {});
    state
        .pty
        .spawn(
            SpawnSpec {
                id: id.into(),
                program: "cmd.exe".into(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 120,
                rows: 30,
                scrollback_bytes: None,
            },
            out,
            ex,
        )
        .unwrap();
}

fn setup(tag: &str, edges: Vec<Edge>) -> Harness {
    let dir = std::env::temp_dir().join(format!("regente-e2e-{tag}-{}", std::process::id()));
    let mut st = AppState::new(dir, None);
    st.pipe_name = format!(r"\\.\pipe\regente-e2e-{tag}-{}", std::process::id());
    let state = Arc::new(st);
    for id in ["a", "b"] {
        spawn_cmd(&state, id);
    }
    state.orch.lock().unwrap().sync(
        vec![term("a", "Claude"), term("b", "Kiro")],
        vec![NoteInfo {
            id: "n1".into(),
            title: "Plano".into(),
            text: "inicio".into(),
        }],
        edges,
    );
    let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(vec![]));
    let ev = events.clone();
    let st2 = state.clone();
    let emit: Emit = Arc::new(move |name, payload| {
        // Simula o usuário aprovando/negando confirmações.
        if name == "confirm-request" {
            let id = payload["id"].as_str().unwrap().to_string();
            let allow = !payload["body"].as_str().unwrap_or("").contains("NEGAR");
            let st3 = st2.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                if let Some(tx) = st3.confirms.lock().unwrap().remove(&id) {
                    let _ = tx.send(allow);
                }
            });
        }
        // Simula a interface atendendo pedidos do coordenador.
        if name == "coord-request" {
            let id = payload["id"].as_str().unwrap().to_string();
            let reply: Result<Value, String> = match payload["op"].as_str().unwrap_or("") {
                "recruit" if payload["params"]["profile"] == "inexistente" => {
                    Err("perfil 'inexistente' não existe".into())
                }
                "recruit" => Ok(
                    json!({"id": format!("n-{id}"), "name": payload["params"]["name"].as_str().filter(|n| !n.is_empty()).unwrap_or("Novo"), "profile": "shell"}),
                ),
                _ => Ok(json!({})),
            };
            let st3 = st2.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(50));
                if let Some(tx) = st3.coords.lock().unwrap().remove(&id) {
                    let _ = tx.send(reply);
                }
            });
        }
        ev.lock().unwrap().push((name.to_string(), payload));
    });
    tauri::async_runtime::spawn(serve(Ctx {
        state: state.clone(),
        emit,
    }));
    // espera o pipe existir
    let deadline = Instant::now() + Duration::from_secs(5);
    while std::fs::metadata(&state.pipe_name).is_err() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    Harness { state, events }
}

impl Harness {
    fn env(&self, term: &str) -> Env {
        Env {
            pipe: self.state.pipe_name.clone(),
            token: self.state.issue_token(term),
            terminal: term.into(),
        }
    }
    fn wait_output(&self, term: &str, needle: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let t = self.state.pty.tail(term, 64 * 1024).unwrap_or_default();
            if t.contains(needle) || Instant::now() > deadline {
                return t;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn cleanup(&self) {
        for id in self.state.pty.ids() {
            self.state.pty.kill(&id);
        }
    }
}

#[test]
fn send_ask_reply_read_notes_and_rules() {
    let h = setup(
        "main",
        vec![
            edge("e1", "a", "b", false, false),
            edge("e2", "a", "n1", false, false),
        ],
    );
    let a = h.env("a");
    let b = h.env("b");

    // peers: A enxerga só o Kiro (e a nota); B enxerga A mas não pode enviar.
    let p = call(&a, "peers", json!({})).unwrap();
    assert_eq!(p["peers"].as_array().unwrap().len(), 1);
    assert_eq!(p["peers"][0]["name"], "Kiro");
    assert_eq!(p["peers"][0]["canSend"], true);
    assert_eq!(p["notes"][0]["title"], "Plano");

    // send: texto injetado no PTY de destino pelo broker.
    let r = call(
        &a,
        "send",
        json!({"to": "kiro", "body": "revise o modulo X"}),
    )
    .unwrap();
    assert_eq!(r["delivered"], true);
    let out = h.wait_output("b", "revise o modulo X");
    assert!(
        out.contains("[Regente] Mensagem de Claude"),
        "saída de B: {out:?}"
    );

    // direção respeitada: B → A é negado, e fica no log como 'denied'.
    let e = call(&b, "send", json!({"to": "claude", "body": "oi"})).unwrap_err();
    assert!(
        e.contains("não está") || e.contains("não há conexão") || e.contains("não encontrado"),
        "erro: {e}"
    );

    // token inválido
    let bad = Env {
        token: "errado".into(),
        ..h.env("a")
    };
    assert_eq!(
        call(&bad, "peers", json!({})).unwrap_err(),
        "não autorizado"
    );

    // ask --wait: B responde com `reply` e A recebe o texto.
    let a2 = h.env("a");
    let asker = std::thread::spawn(move || {
        call(
            &a2,
            "ask",
            json!({"to": "kiro", "body": "qual a nota?", "wait": true, "timeoutS": 30}),
        )
    });
    let out = h.wait_output("b", "qual a nota?");
    let id = out
        .split("pergunta (id ")
        .nth(1)
        .and_then(|s| s.split(')').next())
        .expect("id na mensagem")
        .to_string();
    call(&b, "reply", json!({"id": id, "body": "resposta-42"})).unwrap();
    let reply = asker.join().unwrap().unwrap();
    assert_eq!(reply["reply"], "resposta-42");
    // não se responde duas vezes
    assert!(call(&b, "reply", json!({"id": id, "body": "de novo"})).is_err());

    // read: A lê a saída de B
    let t = call(&a, "read", json!({"peer": "kiro", "last": 50})).unwrap();
    assert!(t["text"].as_str().unwrap().contains("revise o modulo X"));

    // notas conectadas: leitura e escrita
    assert_eq!(
        call(&a, "note_read", json!({"note": "plano"})).unwrap()["text"],
        "inicio"
    );
    call(
        &a,
        "note_add",
        json!({"note": "Plano", "text": "decisao: usar named pipe"}),
    )
    .unwrap();
    assert!(h.state.orch.lock().unwrap().notes["n1"]
        .text
        .contains("decisao: usar named pipe"));
    assert!(h
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|(n, _)| n == "note-updated"));
    // leitura por faixa, edição por trecho único e substituição total
    let r = call(
        &a,
        "note_read",
        json!({"note": "plano", "offset": 1, "limit": 1}),
    )
    .unwrap();
    assert_eq!(r["text"], "inicio");
    assert!(r["totalLines"].as_u64().unwrap() >= 2);
    call(
        &a,
        "note_edit",
        json!({"note": "plano", "old": "inicio", "new": "começo"}),
    )
    .unwrap();
    assert!(h.state.orch.lock().unwrap().notes["n1"]
        .text
        .starts_with("começo"));
    assert!(call(
        &a,
        "note_edit",
        json!({"note": "plano", "old": "naoexiste", "new": "x"})
    )
    .unwrap_err()
    .contains("não encontrado"));
    call(
        &a,
        "note_write",
        json!({"note": "plano", "text": "novo\u{1b}[31m texto"}),
    )
    .unwrap();
    assert_eq!(
        h.state.orch.lock().unwrap().notes["n1"].text,
        "novo[31m texto"
    );
    call(
        &a,
        "note_add",
        json!({"note": "plano", "text": "decisao: usar named pipe"}),
    )
    .unwrap();
    // B não está conectado à nota
    assert!(call(&b, "note_read", json!({"note": "plano"})).is_err());
    assert!(call(
        &b,
        "note_edit",
        json!({"note": "plano", "old": "a", "new": "b"})
    )
    .is_err());

    // identidade, estado, status de trabalho, notify e diagnóstico
    h.state
        .orch
        .lock()
        .unwrap()
        .agent_state
        .insert("b".into(), "idle".into());
    let ping = call(&a, "ping", json!({})).unwrap();
    assert_eq!(ping["terminal"]["name"], "Claude");
    call(
        &b,
        "status",
        json!({"text": "revisando", "state": "working", "progress": "1/3"}),
    )
    .unwrap();
    assert!(
        call(&b, "status", json!({"text": "x", "state": "inventado"}))
            .unwrap_err()
            .contains("estado inválido")
    );
    let peers = call(&a, "peers", json!({})).unwrap();
    assert_eq!(peers["self"]["name"], "Claude");
    let kiro = peers["peers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "Kiro")
        .unwrap()
        .clone();
    assert_eq!(kiro["state"], "idle");
    assert_eq!(kiro["work"]["progress"], "1/3");
    assert!(h
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|(n, _)| n == "work-status"));
    call(&a, "notify", json!({"text": "terminei \u{1b}[31mtudo"})).unwrap();
    let ev = h
        .events
        .lock()
        .unwrap()
        .iter()
        .find(|(n, _)| n == "agent-notify")
        .cloned()
        .expect("evento agent-notify");
    assert_eq!(ev.1["text"], "terminei [31mtudo");
    assert!(call(&a, "notify", json!({"text": "de novo"}))
        .unwrap_err()
        .contains("limite"));

    // keys: negado sem permissão; liberado com allow_keys; devolve o texto resultante
    assert!(
        call(&a, "keys", json!({"to": "kiro", "keys": "echo oi\\n"}))
            .unwrap_err()
            .contains("não permite")
    );
    h.state
        .orch
        .lock()
        .unwrap()
        .edges
        .iter_mut()
        .for_each(|e| e.allow_keys = true);
    let k = call(
        &a,
        "keys",
        json!({"to": "kiro", "keys": "echo teclas-ok\\n"}),
    )
    .unwrap();
    assert!(
        k["text"].as_str().unwrap().contains("teclas-ok"),
        "saída: {k}"
    );
    h.state
        .orch
        .lock()
        .unwrap()
        .edges
        .iter_mut()
        .for_each(|e| e.allow_keys = false);

    // pausa global bloqueia tudo
    h.state.orch.lock().unwrap().paused = true;
    assert!(call(&a, "send", json!({"to": "kiro", "body": "x"}))
        .unwrap_err()
        .contains("pausada"));
    assert!(call(&a, "note_add", json!({"note": "plano", "text": "x"}))
        .unwrap_err()
        .contains("pausada"));
    h.state.orch.lock().unwrap().paused = false;

    // o log auditável registrou envio, pergunta, resposta e negativa
    let kinds: Vec<String> = h
        .state
        .orch
        .lock()
        .unwrap()
        .log
        .iter()
        .map(|l| l.kind.clone())
        .collect();
    for k in ["send", "ask", "reply", "denied", "note"] {
        assert!(
            kinds.contains(&k.to_string()),
            "faltou '{k}' no log: {kinds:?}"
        );
    }
    // log de auditoria persistido em disco (JSONL)
    let audit = std::fs::read_to_string(h.state.data_dir.join("logs").join("orchestration.jsonl"))
        .expect("log de auditoria");
    assert!(
        audit.lines().count() >= 5 && audit.contains("\"kind\":\"reply\""),
        "auditoria: {audit}"
    );
    h.cleanup();
}

#[test]
fn anti_loop_stops_ping_pong_between_agents() {
    let h = setup("loop", vec![edge("e1", "a", "b", true, false)]);
    let (a, b) = (h.env("a"), h.env("b"));
    // a→b (1), b→a (2), a→b (3), b→a (4), a→b (5 = bloqueado)
    for (i, (env, to)) in [(&a, "kiro"), (&b, "claude"), (&a, "kiro"), (&b, "claude")]
        .into_iter()
        .enumerate()
    {
        call(env, "send", json!({"to": to, "body": format!("ping {i}")}))
            .unwrap_or_else(|e| panic!("passo {i}: {e}"));
    }
    let err = call(&a, "send", json!({"to": "kiro", "body": "ping 4"})).unwrap_err();
    assert!(err.contains("profundidade"), "erro: {err}");
    h.cleanup();
}

#[test]
fn human_confirmation_per_connection() {
    let h = setup("confirm", vec![edge("e1", "a", "b", false, true)]);
    let a = h.env("a");
    // aprovado pelo "usuário"
    call(&a, "send", json!({"to": "kiro", "body": "pode seguir"})).unwrap();
    h.wait_output("b", "pode seguir");
    // negado
    let e = call(&a, "send", json!({"to": "kiro", "body": "NEGAR isto"})).unwrap_err();
    assert!(e.contains("não confirmado"), "erro: {e}");
    assert!(!h
        .state
        .pty
        .tail("b", 64 * 1024)
        .unwrap()
        .contains("NEGAR isto"));
    h.cleanup();
}

#[test]
fn escape_sequences_in_messages_are_stripped() {
    let h = setup("esc", vec![edge("e1", "a", "b", false, false)]);
    let a = h.env("a");
    call(
        &a,
        "send",
        json!({"to": "kiro", "body": "ola\u{1b}]0;titulo-malicioso\u{7}fim"}),
    )
    .unwrap();
    let out = h.wait_output("b", "fim");
    // (o ConPTY emite seus próprios BEL de título; o que importa é a sequência vinda da mensagem)
    assert!(
        !out.contains("\u{1b}]0;titulo-malicioso"),
        "OSC injetado por mensagem não deveria chegar ao terminal"
    );
    assert!(out.contains("fim"));
    h.cleanup();
}

#[test]
fn coordinator_recruits_connects_and_dismisses_with_limits() {
    let h = setup("coord", vec![]);
    let a = h.env("a");
    // sem ser coordenador: negado
    assert!(call(&a, "recruit", json!({"profile": "shell"}))
        .unwrap_err()
        .contains("coordenador"));
    h.state
        .orch
        .lock()
        .unwrap()
        .terms
        .get_mut("a")
        .unwrap()
        .coordinator = true;

    // perfil inexistente: o erro da interface chega ao agente
    assert!(call(&a, "recruit", json!({"profile": "inexistente"}))
        .unwrap_err()
        .contains("não existe"));
    let r = call(&a, "recruit", json!({"profile": "shell", "name": "Worker"})).unwrap();
    assert_eq!(r["name"], "Worker");
    let child = r["id"].as_str().unwrap().to_string();
    assert_eq!(h.state.orch.lock().unwrap().recruit_count("a"), 1);
    // a interface passa a refletir o novo terminal
    h.state.orch.lock().unwrap().terms.insert(
        child.clone(),
        TermInfo {
            id: child.clone(),
            name: "Worker".into(),
            profile: "shell".into(),
            paste: false,
            coordinator: false,
        },
    );

    // conectar: só entre quem ele gerencia (ele mesmo + recrutados)
    call(&a, "connect", json!({"a": "claude", "b": "worker"})).unwrap();
    assert!(call(&a, "connect", json!({"a": "claude", "b": "kiro"}))
        .unwrap_err()
        .contains("não é você"));
    assert!(call(&a, "connect", json!({"a": "worker", "b": "worker"}))
        .unwrap_err()
        .contains("diferentes"));
    // dispensar: só recrutados
    assert!(call(&a, "dismiss", json!({"name": "kiro"}))
        .unwrap_err()
        .contains("não é você"));
    assert!(call(&a, "dismiss", json!({"name": "claude"})).is_err());
    call(&a, "dismiss", json!({"name": "worker"})).unwrap();
    assert_eq!(h.state.orch.lock().unwrap().recruit_count("a"), 0);

    // limite por coordenador
    for i in 0..6 {
        call(
            &a,
            "recruit",
            json!({"profile": "shell", "name": format!("W{i}")}),
        )
        .unwrap();
    }
    assert!(call(&a, "recruit", json!({"profile": "shell"}))
        .unwrap_err()
        .contains("limite"));
    // pausa global bloqueia a topologia
    h.state.orch.lock().unwrap().paused = true;
    assert!(call(&a, "dismiss", json!({"name": "w0"}))
        .unwrap_err()
        .contains("pausada"));
    h.state.orch.lock().unwrap().paused = false;
    let kinds: Vec<String> = h
        .state
        .orch
        .lock()
        .unwrap()
        .log
        .iter()
        .map(|l| l.kind.clone())
        .collect();
    for k in ["recruit", "connect", "dismiss"] {
        assert!(
            kinds.contains(&k.to_string()),
            "faltou '{k}' no log: {kinds:?}"
        );
    }
    h.cleanup();
}

#[test]
fn routine_fire_injects_honours_pause_prerun_and_reminder() {
    let h = setup("routine", vec![]);
    let ctx = Ctx {
        state: h.state.clone(),
        emit: {
            let ev = h.events.clone();
            Arc::new(move |n, p| ev.lock().unwrap().push((n.to_string(), p)))
        },
    };
    let fire = |text: &str, pre: Option<&str>, reminder: bool| {
        tauri::async_runtime::block_on(ctx.fire_routine(
            "b",
            "Verificar CI",
            text,
            pre.map(String::from),
            None,
            reminder,
        ))
    };
    // envio simples (sanitizado) vai ao terminal
    assert_eq!(fire("rotina-simples-ok", None, false).unwrap(), "enviada");
    assert!(h
        .wait_output("b", "rotina-simples-ok")
        .contains("rotina-simples-ok"));
    // pré-execução com {{output}}
    assert_eq!(
        fire("saida={{output}}", Some("Write-Output 'abc123'"), false).unwrap(),
        "enviada"
    );
    assert!(h.wait_output("b", "saida=abc123").contains("saida=abc123"));
    // pré-execução sem saída: ignorada, nada é injetado
    assert_eq!(
        fire("nao-deve-aparecer", Some("exit 1"), false).unwrap(),
        "ignorada"
    );
    std::thread::sleep(Duration::from_millis(500));
    assert!(!h
        .state
        .pty
        .tail("b", 64 * 1024)
        .unwrap()
        .contains("nao-deve-aparecer"));
    // lembrete: notifica o usuário em vez de injetar
    assert_eq!(fire("hora do café", None, true).unwrap(), "lembrete");
    assert!(h
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|(n, p)| n == "agent-notify" && p["text"] == "hora do café"));
    // pausa global
    h.state.orch.lock().unwrap().paused = true;
    assert_eq!(fire("pausado", None, false).unwrap(), "pausada");
    h.state.orch.lock().unwrap().paused = false;
    // agente inexistente
    assert!(
        tauri::async_runtime::block_on(ctx.fire_routine("zzz", "x", "oi", None, None, false))
            .is_err()
    );
    let kinds: Vec<String> = h
        .state
        .orch
        .lock()
        .unwrap()
        .log
        .iter()
        .map(|l| l.kind.clone())
        .collect();
    assert!(kinds.iter().filter(|k| *k == "routine").count() >= 3);
    h.cleanup();
}

#[test]
fn tokens_are_per_terminal_and_block_impersonation() {
    let h = setup("token", vec![edge("e1", "a", "b", false, false)]);
    let a = h.env("a");
    let b = h.env("b");
    assert_ne!(a.token, b.token, "cada terminal tem o seu segredo");
    // o terminal b tenta falar em nome de a (token de b + terminal de a)
    let forged = Env {
        terminal: "a".into(),
        ..b.clone()
    };
    assert!(call(&forged, "peers", json!({}))
        .unwrap_err()
        .contains("não autorizado"));
    assert!(call(&forged, "send", json!({"to": "kiro", "body": "falso"})).is_err());
    // o token de a não vale para b
    let forged2 = Env {
        terminal: "b".into(),
        ..a.clone()
    };
    assert!(call(&forged2, "peers", json!({})).is_err());
    // chamadas legítimas continuam funcionando
    assert!(call(&a, "peers", json!({})).is_ok());
    // a tentativa ficou registrada
    assert!(h
        .state
        .orch
        .lock()
        .unwrap()
        .log
        .iter()
        .any(|l| l.kind == "denied" && l.body.contains("se passar")));
    // revogar o terminal invalida o token
    h.state.revoke_tokens("a");
    assert!(call(&a, "peers", json!({}))
        .unwrap_err()
        .contains("não autorizado"));
    h.cleanup();
}

#[test]
fn keys_refused_on_confirm_connections_and_pause_blocks_reply() {
    // conexão com "permitir teclas" E "exigir confirmação": keys é recusado
    let mut e = edge("e1", "a", "b", false, true);
    e.allow_keys = true;
    let h = setup("keysconf", vec![e]);
    let a = h.env("a");
    let b = h.env("b");
    assert!(call(&a, "keys", json!({"to": "kiro", "keys": "x"}))
        .unwrap_err()
        .contains("confirmação"));
    // sem confirmação, uma pergunta assíncrona cria uma pendência; pausar bloqueia o reply
    h.state.orch.lock().unwrap().edges[0].confirm = false;
    let sent = call(
        &a,
        "ask",
        json!({"to": "kiro", "body": "oi?", "wait": false}),
    )
    .unwrap();
    let id = sent["id"].as_str().unwrap().to_string();
    h.state.orch.lock().unwrap().paused = true;
    assert!(call(&b, "reply", json!({"id": id, "body": "sim"}))
        .unwrap_err()
        .contains("pausada"));
    h.state.orch.lock().unwrap().paused = false;
    // mensagens enormes são recusadas
    assert!(call(
        &a,
        "send",
        json!({"to": "kiro", "body": "x".repeat(40 * 1024)})
    )
    .unwrap_err()
    .contains("grande demais"));
    // status em excesso
    call(&a, "status", json!({"text": "um", "state": "working"})).unwrap();
    assert!(
        call(&a, "status", json!({"text": "dois", "state": "working"}))
            .unwrap_err()
            .contains("excesso")
    );
    // resposta inline é sanitizada
    h.cleanup();
}

#[test]
fn oversize_request_line_is_rejected_without_killing_the_broker() {
    use std::io::{Read, Write};
    let h = setup("bigline", vec![]);
    let a = h.env("a");
    let mut f = (0..40)
        .find_map(|_| {
            match std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&a.pipe)
            {
                Ok(f) => Some(f),
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(100));
                    None
                }
            }
        })
        .expect("abrir o pipe");
    let big = vec![b'x'; 1_200_000];
    let _ = f.write_all(&big);
    let _ = f.write_all(b"\n");
    let mut resp = String::new();
    let _ = f.read_to_string(&mut resp);
    assert!(resp.contains("grande demais"), "resposta: {resp:.100}");
    // o broker continua atendendo
    assert!(call(&a, "ping", json!({})).is_ok());
    h.cleanup();
}
