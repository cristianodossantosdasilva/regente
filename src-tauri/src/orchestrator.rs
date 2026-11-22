//! Regras puras da orquestração agente-a-agente (sem I/O, totalmente testável):
//! grafo de conexões, autorização de envio, anti-loop (profundidade), limite de taxa,
//! pausa global e log auditável.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Profundidade máxima de uma cadeia de mensagens A→B→C→...
pub const MAX_DEPTH: u8 = 4;
/// Quanto tempo a profundidade "recebida" por um terminal continua valendo.
pub const DEPTH_TTL: Duration = Duration::from_secs(600);
/// Mensagens por minuto por remetente.
pub const RATE_LIMIT: usize = 30;
const MAX_LOG: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub profile: String,
    /// Usa "bracketed paste" ao injetar texto (agentes TUI); senão achata em uma linha.
    #[serde(default)]
    pub paste: bool,
    /// Pode recrutar, conectar e dispensar agentes (`regente recruit/connect/dismiss`).
    #[serde(default)]
    pub coordinator: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInfo {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub bidirectional: bool,
    /// Exige confirmação humana a cada mensagem nesta conexão.
    #[serde(default)]
    pub confirm: bool,
    /// Permite que `from` envie teclas cruas (`regente keys`) ao terminal `to` (operar menus interativos).
    #[serde(default)]
    pub allow_keys: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Deny {
    Paused,
    UnknownSender,
    UnknownPeer(String),
    NotConnected,
    DepthExceeded,
    RateLimited,
}

impl std::fmt::Display for Deny {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Deny::Paused => write!(f, "orquestração pausada pelo usuário"),
            Deny::UnknownSender => write!(f, "terminal remetente desconhecido"),
            Deny::UnknownPeer(p) => write!(
                f,
                "par '{p}' não encontrado entre as conexões deste terminal"
            ),
            Deny::NotConnected => write!(f, "não há conexão permitindo esse envio"),
            Deny::DepthExceeded => write!(
                f,
                "limite de profundidade ({MAX_DEPTH}) excedido: possível loop entre agentes"
            ),
            Deny::RateLimited => write!(f, "limite de mensagens por minuto excedido"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub ts: u64,
    pub kind: String, // send | ask | reply | note | denied | system
    pub from: String,
    pub to: String,
    pub depth: u8,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub profile: String,
    /// Este terminal pode enviar a este par.
    pub can_send: bool,
    /// Este par pode enviar a este terminal.
    pub can_receive: bool,
    /// Estado do agente informado pelo front (working/waiting/idle/error/exited), se conhecido.
    pub state: Option<String>,
    /// Último status de trabalho publicado pelo par (`regente status`).
    pub work: Option<WorkStatus>,
}

/// Status de trabalho que um terminal publica para o usuário e para os pares.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStatus {
    pub text: String,
    pub state: String,
    pub progress: Option<String>,
}

pub const WORK_STATES: [&str; 4] = ["working", "blocked", "review", "done"];
/// Caractere que nunca deve chegar a um terminal, rótulo ou status: controle (inclui ESC), separadores Unicode de linha,
/// marcas bidi e zero-width (usados para esconder ou falsificar texto).
pub fn is_unsafe_char(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// Máximo de agentes vivos recrutados por um mesmo coordenador.
pub const MAX_RECRUITS: usize = 6;
/// Tempo até a interface refletir um recrutado no `sync`; antes disso ele não é podado.
const RECRUIT_GRACE: Duration = Duration::from_secs(20);
pub const NOTIFY_MIN_INTERVAL: Duration = Duration::from_secs(10);
pub const STATUS_MIN_INTERVAL: Duration = Duration::from_secs(2);
/// Operações de topologia (recruit/connect/dismiss) por coordenador por minuto.
pub const TOPOLOGY_PER_MIN: usize = 10;

/// Valida e normaliza um status de trabalho: texto ≤ 120 caracteres, estado conhecido, progresso `n/m` (m ≥ 1, n ≤ m).
pub fn validate_work(
    text: &str,
    state: &str,
    progress: Option<&str>,
) -> Result<WorkStatus, String> {
    let text: String = text
        .chars()
        .filter(|c| !is_unsafe_char(*c))
        .take(120)
        .collect();
    if text.trim().is_empty() {
        return Err("texto do status vazio".into());
    }
    if !WORK_STATES.contains(&state) {
        return Err(format!(
            "estado inválido '{state}' (use: {})",
            WORK_STATES.join(", ")
        ));
    }
    let progress = match progress.map(str::trim).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) => {
            let (n, m) = p
                .split_once('/')
                .ok_or("progresso deve ser n/m, ex.: 2/5")?;
            let (n, m): (u32, u32) = (
                n.trim()
                    .parse()
                    .map_err(|_| "progresso deve ser n/m, ex.: 2/5")?,
                m.trim()
                    .parse()
                    .map_err(|_| "progresso deve ser n/m, ex.: 2/5")?,
            );
            if m == 0 || n > m || m > 9999 {
                return Err("progresso fora do intervalo (0 ≤ n ≤ m, m ≥ 1)".into());
            }
            Some(format!("{n}/{m}"))
        }
    };
    Ok(WorkStatus {
        text: text.trim().to_string(),
        state: state.to_string(),
        progress,
    })
}

#[derive(Default)]
pub struct Orchestrator {
    pub terms: HashMap<String, TermInfo>,
    pub notes: HashMap<String, NoteInfo>,
    pub edges: Vec<Edge>,
    pub paused: bool,
    /// Estado do agente por terminal, alimentado pelo front.
    pub agent_state: HashMap<String, String>,
    pub work: HashMap<String, WorkStatus>,
    notified: HashMap<String, Instant>,
    status_at: HashMap<String, Instant>,
    topo: HashMap<String, VecDeque<Instant>>,
    /// Vagas de recrutamento reservadas enquanto a interface ainda cria o terminal.
    pending_recruits: HashMap<String, usize>,
    /// filho -> (coordenador que o recrutou, quando).
    pub recruited: HashMap<String, (String, Instant)>,
    depth_in: HashMap<String, (u8, Instant)>,
    sent: HashMap<String, VecDeque<Instant>>,
    pub log: VecDeque<LogEntry>,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sync(&mut self, terms: Vec<TermInfo>, notes: Vec<NoteInfo>, edges: Vec<Edge>) {
        self.terms = terms.into_iter().map(|t| (t.id.clone(), t)).collect();
        // Texto de notas vem do front; preserva o texto atual do broker se o front enviou vazio por ainda não ter sincronizado.
        self.notes = notes.into_iter().map(|n| (n.id.clone(), n)).collect();
        self.edges = edges;
        let terms = &self.terms;
        self.agent_state.retain(|k, _| terms.contains_key(k));
        self.work.retain(|k, _| terms.contains_key(k));
        let now = Instant::now();
        self.recruited.retain(|child, (coord, at)| {
            terms.contains_key(coord)
                && (terms.contains_key(child) || now.saturating_duration_since(*at) < RECRUIT_GRACE)
        });
    }

    pub fn recruit_count(&self, coord: &str) -> usize {
        self.recruited.values().filter(|(c, _)| c == coord).count()
    }

    /// Reserva uma vaga de recrutamento (vivos + em andamento) antes de pedir à interface; evita estourar o limite em paralelo.
    pub fn reserve_recruit(&mut self, coord: &str) -> Result<(), String> {
        let pending = self.pending_recruits.get(coord).copied().unwrap_or(0);
        if self.recruit_count(coord) + pending >= MAX_RECRUITS {
            return Err(format!(
                "limite de {MAX_RECRUITS} agentes recrutados por coordenador; dispense algum antes"
            ));
        }
        *self.pending_recruits.entry(coord.to_string()).or_insert(0) += 1;
        Ok(())
    }

    pub fn release_recruit(&mut self, coord: &str) {
        if let Some(n) = self.pending_recruits.get_mut(coord) {
            *n = n.saturating_sub(1);
        }
    }

    /// Limite de taxa das operações de topologia por coordenador.
    pub fn allow_topology(&mut self, coord: &str, now: Instant) -> bool {
        let q = self.topo.entry(coord.to_string()).or_default();
        while q
            .front()
            .map(|t| now.saturating_duration_since(*t) > Duration::from_secs(60))
            .unwrap_or(false)
        {
            q.pop_front();
        }
        if q.len() >= TOPOLOGY_PER_MIN {
            return false;
        }
        q.push_back(now);
        true
    }

    /// `status` no máximo uma vez por intervalo por terminal.
    pub fn allow_status(&mut self, term: &str, now: Instant) -> bool {
        if let Some(last) = self.status_at.get(term) {
            if now.saturating_duration_since(*last) < STATUS_MIN_INTERVAL {
                return false;
            }
        }
        self.status_at.insert(term.to_string(), now);
        true
    }

    pub fn record_recruit(&mut self, coord: &str, child: &str, now: Instant) {
        self.recruited
            .insert(child.to_string(), (coord.to_string(), now));
    }

    /// O coordenador gerencia a si mesmo e aos agentes que ele recrutou.
    pub fn can_manage(&self, coord: &str, id: &str) -> bool {
        id == coord
            || self
                .recruited
                .get(id)
                .map(|(c, _)| c == coord)
                .unwrap_or(false)
    }

    /// Resolve um nome (exato, sem diferenciar maiúsculas, ou prefixo único) entre os terminais gerenciados pelo coordenador.
    pub fn resolve_managed(&self, coord: &str, query: &str) -> Result<String, String> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Err("informe o nome do agente".into());
        }
        let cands: Vec<&TermInfo> = self
            .terms
            .values()
            .filter(|t| self.can_manage(coord, &t.id))
            .collect();
        if let Some(t) = cands.iter().find(|t| t.id == query.trim()) {
            return Ok(t.id.clone());
        }
        let exact: Vec<&&TermInfo> = cands
            .iter()
            .filter(|t| t.name.to_lowercase() == q)
            .collect();
        match exact.len() {
            1 => return Ok(exact[0].id.clone()),
            0 => {}
            _ => {
                return Err(format!(
                    "'{query}' é ambíguo: há mais de um agente com esse nome"
                ))
            }
        }
        let pre: Vec<&&TermInfo> = cands
            .iter()
            .filter(|t| t.name.to_lowercase().starts_with(&q))
            .collect();
        match pre.len() {
            1 => Ok(pre[0].id.clone()),
            0 => Err(format!(
                "'{query}' não é você nem um agente que você recrutou"
            )),
            _ => Err(format!(
                "'{query}' é ambíguo entre os agentes que você gerencia"
            )),
        }
    }

    /// Publica o status de trabalho de um terminal conhecido.
    pub fn set_work(&mut self, term: &str, w: WorkStatus) -> Result<(), Deny> {
        if !self.terms.contains_key(term) {
            return Err(Deny::UnknownSender);
        }
        self.work.insert(term.to_string(), w);
        Ok(())
    }

    /// Limita `notify` a uma por intervalo mínimo por terminal. `true` = liberado (e registra o uso).
    pub fn allow_notify(&mut self, term: &str, now: Instant) -> bool {
        if let Some(last) = self.notified.get(term) {
            if now.saturating_duration_since(*last) < NOTIFY_MIN_INTERVAL {
                return false;
            }
        }
        self.notified.insert(term.to_string(), now);
        true
    }

    pub fn edge_between(&self, from: &str, to: &str) -> Option<&Edge> {
        self.edges.iter().find(|e| {
            (e.from == from && e.to == to) || (e.bidirectional && e.from == to && e.to == from)
        })
    }

    /// Se QUALQUER conexão que permite este envio exige confirmação, exige (vale a mais restritiva).
    pub fn needs_confirm(&self, from: &str, to: &str) -> bool {
        self.edges
            .iter()
            .filter(|e| {
                (e.from == from && e.to == to) || (e.bidirectional && e.from == to && e.to == from)
            })
            .any(|e| e.confirm)
    }

    /// `keys` só é permitido se existe conexão que libera este sentido e TODAS as que o liberam têm `allow_keys`.
    pub fn keys_allowed(&self, from: &str, to: &str) -> bool {
        // Direcional: vale só de `e.from` para `e.to`, mesmo em conexões bidirecionais (o destino não opera a origem).
        let mut it = self
            .edges
            .iter()
            .filter(|e| e.from == from && e.to == to)
            .peekable();
        it.peek().is_some() && it.all(|e| e.allow_keys)
    }

    fn touches(&self, a: &str, b: &str) -> bool {
        self.edges
            .iter()
            .any(|e| (e.from == a && e.to == b) || (e.from == b && e.to == a))
    }

    pub fn peers(&self, me: &str) -> Vec<Peer> {
        let mut v: Vec<Peer> = self
            .terms
            .values()
            .filter(|t| t.id != me && self.touches(me, &t.id))
            .map(|t| Peer {
                id: t.id.clone(),
                name: t.name.clone(),
                profile: t.profile.clone(),
                can_send: self.edge_between(me, &t.id).is_some(),
                can_receive: self.edge_between(&t.id, me).is_some(),
                state: self.agent_state.get(&t.id).cloned(),
                work: self.work.get(&t.id).cloned(),
            })
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    /// Notas conectadas a este terminal (por qualquer direção).
    pub fn notes_for(&self, me: &str) -> Vec<&NoteInfo> {
        let mut v: Vec<&NoteInfo> = self
            .notes
            .values()
            .filter(|n| self.touches(me, &n.id))
            .collect();
        v.sort_by(|a, b| a.title.cmp(&b.title));
        v
    }

    /// Resolve um par (por id, nome exato, ou prefixo único do nome) dentre as conexões do terminal.
    pub fn resolve_peer(&self, me: &str, query: &str) -> Result<String, Deny> {
        let q = query.trim().to_lowercase();
        let peers = self.peers(me);
        if let Some(p) = peers
            .iter()
            .find(|p| p.id.to_lowercase() == q || p.name.to_lowercase() == q)
        {
            return Ok(p.id.clone());
        }
        let pref: Vec<&Peer> = peers
            .iter()
            .filter(|p| p.name.to_lowercase().starts_with(&q))
            .collect();
        if pref.len() == 1 && !q.is_empty() {
            return Ok(pref[0].id.clone());
        }
        Err(Deny::UnknownPeer(query.to_string()))
    }

    pub fn resolve_note(&self, me: &str, query: &str) -> Option<String> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return None;
        }
        let notes = self.notes_for(me);
        notes
            .iter()
            .find(|n| n.id.to_lowercase() == q || n.title.to_lowercase() == q)
            .or_else(|| {
                let m: Vec<_> = notes
                    .iter()
                    .filter(|n| n.title.to_lowercase().starts_with(&q))
                    .collect();
                if m.len() == 1 {
                    Some(m[0])
                } else {
                    None
                }
            })
            .map(|n| n.id.clone())
    }

    /// Autoriza um envio e devolve a profundidade da nova mensagem.
    pub fn authorize_send(&mut self, from: &str, to: &str, now: Instant) -> Result<u8, Deny> {
        if self.paused {
            return Err(Deny::Paused);
        }
        if !self.terms.contains_key(from) {
            return Err(Deny::UnknownSender);
        }
        if !self.terms.contains_key(to) || self.edge_between(from, to).is_none() {
            return Err(Deny::NotConnected);
        }
        let depth = match self.depth_in.get(from) {
            Some((d, t)) if now.duration_since(*t) < DEPTH_TTL => d.saturating_add(1),
            _ => 1,
        };
        if depth > MAX_DEPTH {
            return Err(Deny::DepthExceeded);
        }
        let q = self.sent.entry(from.to_string()).or_default();
        while q
            .front()
            .map(|t| now.duration_since(*t) > Duration::from_secs(60))
            .unwrap_or(false)
        {
            q.pop_front();
        }
        if q.len() >= RATE_LIMIT {
            return Err(Deny::RateLimited);
        }
        q.push_back(now);
        Ok(depth)
    }

    /// Registra que `to` recebeu uma mensagem de profundidade `depth`.
    /// Uma entrega rasa nunca reduz a profundidade de uma cadeia em andamento (evita burlar o anti-loop).
    pub fn mark_delivered(&mut self, to: &str, depth: u8, now: Instant) {
        let d = match self.depth_in.get(to) {
            Some((old, t)) if now.duration_since(*t) < DEPTH_TTL => (*old).max(depth),
            _ => depth,
        };
        self.depth_in.insert(to.to_string(), (d, now));
    }

    /// Ação humana no terminal (teclado) encerra a cadeia: zera a profundidade vigente dele.
    pub fn reset_depth(&mut self, term: &str) {
        self.depth_in.remove(term);
    }

    pub fn push_log(&mut self, entry: LogEntry) {
        self.log.push_back(entry);
        while self.log.len() > MAX_LOG {
            self.log.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Orchestrator {
        let mut o = Orchestrator::new();
        let t = |id: &str, name: &str| TermInfo {
            id: id.into(),
            name: name.into(),
            profile: "x".into(),
            paste: true,
            coordinator: false,
        };
        o.sync(
            vec![t("a", "Claude"), t("b", "Kiro"), t("c", "Agy")],
            vec![NoteInfo {
                id: "n1".into(),
                title: "Plano".into(),
                text: "oi".into(),
            }],
            vec![
                Edge {
                    id: "e1".into(),
                    from: "a".into(),
                    to: "b".into(),
                    bidirectional: false,
                    confirm: false,
                    allow_keys: false,
                },
                Edge {
                    id: "e2".into(),
                    from: "b".into(),
                    to: "c".into(),
                    bidirectional: true,
                    confirm: false,
                    allow_keys: false,
                },
                Edge {
                    id: "e3".into(),
                    from: "a".into(),
                    to: "n1".into(),
                    bidirectional: false,
                    confirm: false,
                    allow_keys: false,
                },
            ],
        );
        o
    }

    #[test]
    fn only_connected_peers_visible() {
        let o = setup();
        let p = o.peers("a");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].name, "Kiro");
        assert!(p[0].can_send && !p[0].can_receive);
        assert_eq!(o.notes_for("a").len(), 1);
        assert!(o.notes_for("c").is_empty());
    }

    #[test]
    fn direction_is_enforced() {
        let mut o = setup();
        let now = Instant::now();
        assert!(o.authorize_send("a", "b", now).is_ok());
        assert_eq!(o.authorize_send("b", "a", now), Err(Deny::NotConnected));
        assert_eq!(o.authorize_send("a", "c", now), Err(Deny::NotConnected));
        // bidirecional funciona nos dois sentidos
        assert!(o.authorize_send("b", "c", now).is_ok());
        assert!(o.authorize_send("c", "b", now).is_ok());
    }

    #[test]
    fn anti_loop_depth_limit() {
        let mut o = setup();
        let now = Instant::now();
        // b <-> c ficam trocando mensagens; cada entrega aumenta a profundidade
        let mut depth = o.authorize_send("b", "c", now).unwrap();
        let mut last_ok = depth;
        let (mut from, mut to) = ("b", "c");
        for _ in 0..10 {
            o.mark_delivered(to, depth, now);
            std::mem::swap(&mut from, &mut to);
            match o.authorize_send(from, to, now) {
                Ok(d) => {
                    depth = d;
                    last_ok = d;
                }
                Err(e) => {
                    assert_eq!(e, Deny::DepthExceeded);
                    break;
                }
            }
        }
        assert_eq!(last_ok, MAX_DEPTH);
    }

    #[test]
    fn depth_expires_after_ttl() {
        let mut o = setup();
        let t0 = Instant::now();
        o.mark_delivered("b", MAX_DEPTH, t0);
        let later = t0 + DEPTH_TTL + Duration::from_secs(1);
        assert_eq!(o.authorize_send("b", "c", later), Ok(1));
        assert_eq!(o.authorize_send("b", "c", t0), Err(Deny::DepthExceeded));
    }

    #[test]
    fn pause_blocks_everything() {
        let mut o = setup();
        o.paused = true;
        assert_eq!(
            o.authorize_send("a", "b", Instant::now()),
            Err(Deny::Paused)
        );
    }

    #[test]
    fn rate_limit_applies() {
        let mut o = setup();
        let now = Instant::now();
        for _ in 0..RATE_LIMIT {
            assert!(o.authorize_send("a", "b", now).is_ok());
        }
        assert_eq!(o.authorize_send("a", "b", now), Err(Deny::RateLimited));
        assert!(o
            .authorize_send("a", "b", now + Duration::from_secs(61))
            .is_ok());
    }

    #[test]
    fn resolve_peer_by_name_and_prefix() {
        let o = setup();
        assert_eq!(o.resolve_peer("a", "kiro").unwrap(), "b");
        assert_eq!(o.resolve_peer("a", "Ki").unwrap(), "b");
        assert!(o.resolve_peer("a", "Agy").is_err()); // existe, mas não está conectado a "a"
    }

    #[test]
    fn shallow_delivery_does_not_reset_chain_depth() {
        let mut o = setup();
        let now = Instant::now();
        o.mark_delivered("b", MAX_DEPTH, now);
        o.mark_delivered("b", 1, now); // mensagem rasa não pode zerar a cadeia
        assert_eq!(o.authorize_send("b", "c", now), Err(Deny::DepthExceeded));
    }

    #[test]
    fn human_action_resets_depth() {
        let mut o = setup();
        let now = Instant::now();
        o.mark_delivered("b", MAX_DEPTH, now);
        o.reset_depth("b");
        assert_eq!(o.authorize_send("b", "c", now), Ok(1));
    }

    #[test]
    fn depth_does_not_overflow() {
        let mut o = setup();
        let now = Instant::now();
        o.mark_delivered("b", u8::MAX, now);
        assert_eq!(o.authorize_send("b", "c", now), Err(Deny::DepthExceeded));
    }

    #[test]
    fn strictest_edge_decides_confirmation() {
        let mut o = setup();
        o.edges.push(Edge {
            id: "x".into(),
            from: "a".into(),
            to: "b".into(),
            bidirectional: false,
            confirm: true,
            allow_keys: false,
        });
        // existem duas arestas a→b (uma sem confirmação, outra com): vale a mais restritiva
        assert!(o.needs_confirm("a", "b"));
        assert!(!o.needs_confirm("b", "c"));
    }

    #[test]
    fn empty_note_query_matches_nothing() {
        let o = setup();
        assert_eq!(o.resolve_note("a", ""), None);
        assert_eq!(o.resolve_note("a", "   "), None);
    }

    #[test]
    fn resolve_note_by_title() {
        let o = setup();
        assert_eq!(o.resolve_note("a", "plano").as_deref(), Some("n1"));
        assert_eq!(o.resolve_note("c", "plano"), None);
    }
    #[test]
    fn validate_work_rules() {
        let w = validate_work("revisando módulo", "working", Some("2/5")).unwrap();
        assert_eq!(
            (w.text.as_str(), w.progress.as_deref()),
            ("revisando módulo", Some("2/5"))
        );
        assert!(validate_work("x", "feito", None).is_err());
        assert!(validate_work("   ", "done", None).is_err());
        assert!(validate_work("x", "done", Some("6/5")).is_err());
        assert!(validate_work("x", "done", Some("1/0")).is_err());
        assert!(validate_work("x", "done", Some("a/b")).is_err());
        assert_eq!(
            validate_work("x", "done", Some("  ")).unwrap().progress,
            None
        );
        assert_eq!(
            validate_work(&"y".repeat(500), "done", None)
                .unwrap()
                .text
                .chars()
                .count(),
            120
        );
    }

    #[test]
    fn work_status_and_state_show_in_peers_and_are_pruned() {
        let mut o = setup();
        o.agent_state.insert("b".into(), "idle".into());
        o.set_work(
            "b",
            validate_work("testando", "review", Some("1/2")).unwrap(),
        )
        .unwrap();
        let p = o.peers("a");
        let kiro = p.iter().find(|x| x.name == "Kiro").unwrap();
        assert_eq!(kiro.state.as_deref(), Some("idle"));
        assert_eq!(kiro.work.as_ref().unwrap().state, "review");
        assert!(o
            .set_work("zzz", validate_work("x", "done", None).unwrap())
            .is_err());
        // terminal removido no sync perde estado e status
        o.sync(
            vec![TermInfo {
                id: "a".into(),
                name: "Claude".into(),
                profile: "x".into(),
                paste: true,
                coordinator: false,
            }],
            vec![],
            vec![],
        );
        assert!(o.agent_state.is_empty() && o.work.is_empty());
    }

    #[test]
    fn notify_is_rate_limited_per_terminal() {
        let mut o = setup();
        let t0 = Instant::now();
        assert!(o.allow_notify("a", t0));
        assert!(!o.allow_notify("a", t0 + Duration::from_secs(3)));
        assert!(o.allow_notify("b", t0 + Duration::from_secs(3)));
        assert!(o.allow_notify("a", t0 + NOTIFY_MIN_INTERVAL + Duration::from_secs(1)));
    }

    #[test]
    fn keys_need_explicit_permission_on_every_connection() {
        let mut o = setup();
        assert!(!o.keys_allowed("a", "b"));
        o.edges[0].allow_keys = true;
        assert!(o.keys_allowed("a", "b"));
        assert!(
            !o.keys_allowed("b", "a"),
            "sentido contrário não está liberado"
        );
        // segunda conexão a→b sem a permissão: vale a mais restritiva
        o.edges.push(Edge {
            id: "dup".into(),
            from: "a".into(),
            to: "b".into(),
            bidirectional: false,
            confirm: false,
            allow_keys: false,
        });
        assert!(!o.keys_allowed("a", "b"));
        assert!(!o.keys_allowed("a", "c"), "sem conexão não há permissão");
    }

    #[test]
    fn coordinator_manages_only_itself_and_its_recruits() {
        let mut o = setup();
        let t0 = Instant::now();
        o.record_recruit("a", "b", t0);
        assert!(o.can_manage("a", "a") && o.can_manage("a", "b"));
        assert!(!o.can_manage("a", "c") && !o.can_manage("b", "a"));
        assert_eq!(o.resolve_managed("a", "kir").unwrap(), "b");
        assert_eq!(o.resolve_managed("a", "CLAUDE").unwrap(), "a");
        assert!(
            o.resolve_managed("a", "Agy").is_err(),
            "Agy não foi recrutado"
        );
        assert!(o.resolve_managed("a", "").is_err());
        assert_eq!(o.recruit_count("a"), 1);
    }

    #[test]
    fn recruits_are_pruned_when_gone_but_kept_during_grace() {
        let mut o = setup();
        o.record_recruit("a", "novo", Instant::now());
        // ainda não apareceu no sync, mas está dentro da carência
        o.sync(
            vec![TermInfo {
                id: "a".into(),
                name: "Claude".into(),
                profile: "x".into(),
                paste: true,
                coordinator: true,
            }],
            vec![],
            vec![],
        );
        assert!(o.recruited.contains_key("novo"));
        // coordenador sumiu: poda tudo
        o.sync(vec![], vec![], vec![]);
        assert!(o.recruited.is_empty());
    }

    #[test]
    fn keys_permission_is_directional_even_on_bidirectional_edges() {
        let mut o = setup();
        o.edges[1].allow_keys = true; // b <-> c
        assert!(o.keys_allowed("b", "c"));
        assert!(
            !o.keys_allowed("c", "b"),
            "o destino não pode operar a origem"
        );
    }

    #[test]
    fn recruit_reservation_prevents_parallel_overflow() {
        let mut o = setup();
        for _ in 0..MAX_RECRUITS {
            o.reserve_recruit("a").unwrap();
        }
        assert!(
            o.reserve_recruit("a").is_err(),
            "vagas reservadas contam para o limite"
        );
        o.release_recruit("a");
        assert!(o.reserve_recruit("a").is_ok());
    }

    #[test]
    fn topology_and_status_rate_limits() {
        let mut o = setup();
        let t0 = Instant::now();
        for _ in 0..TOPOLOGY_PER_MIN {
            assert!(o.allow_topology("a", t0));
        }
        assert!(!o.allow_topology("a", t0 + Duration::from_secs(30)));
        assert!(o.allow_topology("a", t0 + Duration::from_secs(61)));
        assert!(o.allow_status("a", t0));
        assert!(!o.allow_status("a", t0 + Duration::from_secs(1)));
        assert!(o.allow_status("a", t0 + STATUS_MIN_INTERVAL + Duration::from_millis(1)));
    }

    #[test]
    fn duplicate_names_are_ambiguous_and_unsafe_chars_are_filtered() {
        let mut o = setup();
        o.sync(
            vec![
                TermInfo {
                    id: "a".into(),
                    name: "Claude".into(),
                    profile: "x".into(),
                    paste: true,
                    coordinator: true,
                },
                TermInfo {
                    id: "r1".into(),
                    name: "Revisor".into(),
                    profile: "x".into(),
                    paste: true,
                    coordinator: false,
                },
                TermInfo {
                    id: "r2".into(),
                    name: "Revisor".into(),
                    profile: "x".into(),
                    paste: true,
                    coordinator: false,
                },
            ],
            vec![],
            vec![],
        );
        o.record_recruit("a", "r1", Instant::now());
        o.record_recruit("a", "r2", Instant::now());
        assert!(o
            .resolve_managed("a", "revisor")
            .unwrap_err()
            .contains("ambíguo"));
        assert_eq!(
            o.resolve_managed("a", "r2").unwrap(),
            "r2",
            "o id exato sempre resolve"
        );
        assert!(
            is_unsafe_char('\u{202E}')
                && is_unsafe_char('\u{2028}')
                && is_unsafe_char('\u{200B}')
                && is_unsafe_char('\u{1b}')
        );
        assert!(!is_unsafe_char('ç') && !is_unsafe_char('a'));
        assert_eq!(
            validate_work("ok\u{202E}evil\u{2028}x", "done", None)
                .unwrap()
                .text,
            "okevilx"
        );
    }
}
