//! Cliente do broker do Regente (named pipe no Windows, uma requisição JSON por linha).
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};

#[derive(Clone)]
pub struct Env {
    pub pipe: String,
    pub token: String,
    pub terminal: String,
}

impl Env {
    pub fn load() -> Result<Env, String> {
        let get = |k: &str| {
            std::env::var(k).map_err(|_| {
                format!("variável {k} ausente: execute dentro de um terminal do Regente")
            })
        };
        Ok(Env {
            pipe: get("REGENTE_PIPE")?,
            token: get("REGENTE_TOKEN")?,
            terminal: get("REGENTE_TERMINAL")?,
        })
    }
}

/// Chama um método do broker e devolve `result` ou a mensagem de erro.
pub fn call(env: &Env, method: &str, mut params: Value) -> Result<Value, String> {
    if let Some(o) = params.as_object_mut() {
        o.insert("token".into(), json!(env.token));
        o.insert("from".into(), json!(env.terminal));
    }
    let req = json!({"id": 1, "method": method, "params": params}).to_string();
    let mut file = open_pipe(&env.pipe)?;
    file.write_all(format!("{req}\n").as_bytes())
        .map_err(|e| format!("falha ao enviar: {e}"))?;
    file.flush().ok();
    let mut line = String::new();
    BufReader::new(file)
        .read_line(&mut line)
        .map_err(|e| format!("falha ao ler resposta: {e}"))?;
    let v: Value =
        serde_json::from_str(&line).map_err(|e| format!("resposta inválida do broker: {e}"))?;
    if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
        return Err(err["message"]
            .as_str()
            .unwrap_or("erro desconhecido")
            .to_string());
    }
    Ok(v["result"].clone())
}

/// Conexão com o broker: arquivo do named pipe (Windows) ou socket Unix.
#[cfg(unix)]
type Conn = std::os::unix::net::UnixStream;
#[cfg(not(unix))]
type Conn = std::fs::File;

#[cfg(unix)]
fn open_pipe(path: &str) -> Result<Conn, String> {
    Conn::connect(path).map_err(|e| format!("não consegui conectar ao Regente ({path}): {e}"))
}

#[cfg(not(unix))]
fn open_pipe(path: &str) -> Result<Conn, String> {
    let mut last = String::new();
    // ERROR_PIPE_BUSY (231) é transitório: tenta algumas vezes.
    for _ in 0..20 {
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
        {
            Ok(f) => return Ok(f),
            Err(e) if e.raw_os_error() == Some(231) => {
                last = e.to_string();
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("não consegui conectar ao Regente ({path}): {e}")),
        }
    }
    Err(format!("broker ocupado: {last}"))
}

/// Formata a resposta de `peers` para leitura humana/agente.
pub fn format_peers(v: &Value) -> String {
    let mut out = String::new();
    if v["paused"].as_bool().unwrap_or(false) {
        out.push_str("(orquestração PAUSADA pelo usuário)\n");
    }
    if let Some(name) = v["self"]["name"].as_str() {
        out.push_str(&format!(
            "você: {name} [{}]\n",
            v["self"]["profile"].as_str().unwrap_or("")
        ));
    }
    let peers = v["peers"].as_array().cloned().unwrap_or_default();
    if peers.is_empty() {
        out.push_str("Nenhum agente conectado a este terminal.\n");
    }
    for p in peers {
        let can_send = p["canSend"].as_bool().unwrap_or(false);
        let can_recv = p["canReceive"].as_bool().unwrap_or(false);
        let dir = match (can_send, can_recv) {
            (true, true) => "<->",
            (true, false) => "->",
            _ => "<-",
        };
        let state = p["state"]
            .as_str()
            .map(|s| format!(" ({s})"))
            .unwrap_or_default();
        let work = match (p["work"]["state"].as_str(), p["work"]["text"].as_str()) {
            (Some(st), Some(tx)) => format!(
                " — {st}: {tx}{}",
                p["work"]["progress"]
                    .as_str()
                    .map(|g| format!(" [{g}]"))
                    .unwrap_or_default()
            ),
            _ => String::new(),
        };
        out.push_str(&format!(
            "{} {} [{}]{}{}\n",
            dir,
            p["name"].as_str().unwrap_or("?"),
            p["profile"].as_str().unwrap_or(""),
            state,
            work
        ));
    }
    for n in v["notes"].as_array().cloned().unwrap_or_default() {
        out.push_str(&format!("nota: {}\n", n["title"].as_str().unwrap_or("?")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_peers() {
        let v = json!({"paused": false, "peers": [{"name": "Kiro", "profile": "kiro", "canSend": true, "canReceive": false}], "notes": [{"title": "Plano"}]});
        let s = format_peers(&v);
        assert!(s.contains("-> Kiro [kiro]"));
        assert!(s.contains("nota: Plano"));
    }
}
