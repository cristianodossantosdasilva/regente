use crate::orchestrator::Orchestrator;
use crate::pty::PtyManager;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use sysinfo::System;
use tokio::sync::oneshot;

/// Mensagem enviada entre agentes que ainda aguarda resposta.
pub struct Pending {
    pub from: String,
    pub to: String,
    pub depth: u8,
    pub wait: Option<oneshot::Sender<String>>,
}

pub struct AppState {
    pub pty: PtyManager,
    pub orch: Mutex<Orchestrator>,
    pub pending: Mutex<HashMap<String, Pending>>,
    pub confirms: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    /// Pedidos do coordenador à interface (recrutar/conectar/dispensar) aguardando resposta.
    pub coords: Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, String>>>>,
    /// token -> terminal. Cada terminal recebe o seu próprio segredo (REGENTE_TOKEN); o broker deduz o remetente
    /// do token e ignora qualquer identidade declarada, então um agente não consegue se passar por outro terminal.
    pub term_tokens: Mutex<HashMap<String, String>>,
    pub pipe_name: String,
    pub data_dir: PathBuf,
    pub cli_dir: Option<PathBuf>,
    pub sys: Mutex<System>,
}

impl AppState {
    /// Gera um segredo novo para o terminal (256 bits) e o registra.
    pub fn issue_token(&self, term: &str) -> String {
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        self.term_tokens
            .lock()
            .unwrap()
            .insert(token.clone(), term.to_string());
        token
    }

    /// Invalida todos os segredos do terminal (ao encerrar/matar o processo).
    pub fn revoke_tokens(&self, term: &str) {
        self.term_tokens.lock().unwrap().retain(|_, t| t != term);
    }

    pub fn term_for_token(&self, token: &str) -> Option<String> {
        self.term_tokens.lock().unwrap().get(token).cloned()
    }

    pub fn new(data_dir: PathBuf, cli_dir: Option<PathBuf>) -> Self {
        AppState {
            pty: PtyManager::new(),
            orch: Mutex::new(Orchestrator::new()),
            pending: Mutex::new(HashMap::new()),
            confirms: Mutex::new(HashMap::new()),
            coords: Mutex::new(HashMap::new()),
            term_tokens: Mutex::new(HashMap::new()),
            pipe_name: format!(r"\\.\pipe\regente-broker-{}", std::process::id()),
            data_dir,
            cli_dir,
            sys: Mutex::new(System::new()),
        }
    }
}
