//! Servidor MCP (stdio, JSON-RPC por linha) que expõe as operações do broker como ferramentas.
use regente_client::{call, format_peers, Env};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

fn tools() -> Value {
    let s = |props: Value, req: Vec<&str>| json!({"type": "object", "properties": props, "required": req});
    json!([
        {"name": "regente_peers", "description": "Lista agentes e notas conectados a este terminal no canvas do Regente.", "inputSchema": s(json!({}), vec![])},
        {"name": "regente_send", "description": "Envia uma mensagem a um agente conectado (sem esperar resposta).", "inputSchema": s(json!({"to": {"type": "string"}, "message": {"type": "string"}}), vec!["to", "message"])},
        {"name": "regente_ask", "description": "Faz uma pergunta a um agente conectado e espera a resposta (wait=true).", "inputSchema": s(json!({"to": {"type": "string"}, "question": {"type": "string"}, "wait": {"type": "boolean"}, "timeout_s": {"type": "integer"}}), vec!["to", "question"])},
        {"name": "regente_reply", "description": "Responde a uma mensagem recebida de outro agente, pelo id informado na mensagem.", "inputSchema": s(json!({"id": {"type": "string"}, "reply": {"type": "string"}}), vec!["id", "reply"])},
        {"name": "regente_read", "description": "Lê as últimas linhas da saída de um agente conectado.", "inputSchema": s(json!({"peer": {"type": "string"}, "last": {"type": "integer"}}), vec!["peer"])},
        {"name": "regente_status", "description": "Publica o status de trabalho deste agente (state: working|blocked|review|done; progress opcional 'n/m'), visível ao usuário e aos pares.", "inputSchema": s(json!({"text": {"type": "string"}, "state": {"type": "string"}, "progress": {"type": "string"}}), vec!["text", "state"])},
        {"name": "regente_notify", "description": "Envia uma notificação do sistema ao usuário (máx. 500 caracteres; use só quando o usuário pediu).", "inputSchema": s(json!({"text": {"type": "string"}}), vec!["text"])},
        {"name": "regente_keys", "description": "Envia teclas cruas a um agente conectado (\\n Enter, \\t Tab, \\e ESC, \\xNN byte) e devolve a saída resultante; só funciona se a conexão permitir teclas.", "inputSchema": s(json!({"to": {"type": "string"}, "keys": {"type": "string"}}), vec!["to", "keys"])},
        {"name": "regente_recruit", "description": "(coordenador) Cria um agente novo no canvas, já conectado a você. profile: id ou nome do perfil (ex.: claude, kiro, shell).", "inputSchema": s(json!({"profile": {"type": "string"}, "name": {"type": "string"}, "cwd": {"type": "string"}}), vec!["profile"])},
        {"name": "regente_connect", "description": "(coordenador) Conecta dois agentes que você gerencia (você e os que recrutou).", "inputSchema": s(json!({"a": {"type": "string"}, "b": {"type": "string"}, "bidirectional": {"type": "boolean"}}), vec!["a", "b"])},
        {"name": "regente_dismiss", "description": "(coordenador) Encerra e remove um agente que você recrutou.", "inputSchema": s(json!({"name": {"type": "string"}}), vec!["name"])},
        {"name": "regente_note_list", "description": "Lista as notas conectadas a este terminal.", "inputSchema": s(json!({}), vec![])},
        {"name": "regente_note_read", "description": "Lê uma nota conectada; offset (1-based) e limit selecionam uma faixa de linhas.", "inputSchema": s(json!({"note": {"type": "string"}, "offset": {"type": "integer"}, "limit": {"type": "integer"}}), vec!["note"])},
        {"name": "regente_note_edit", "description": "Troca um trecho de uma nota conectada; falha se o trecho antigo não existir ou aparecer mais de uma vez.", "inputSchema": s(json!({"note": {"type": "string"}, "old": {"type": "string"}, "new": {"type": "string"}}), vec!["note", "old", "new"])},
        {"name": "regente_note_write", "description": "Substitui todo o conteúdo de uma nota conectada (prefira note_edit ou note_add).", "inputSchema": s(json!({"note": {"type": "string"}, "text": {"type": "string"}}), vec!["note", "text"])},
        {"name": "regente_note_add", "description": "Acrescenta texto ao final de uma nota conectada (memória compartilhada).", "inputSchema": s(json!({"note": {"type": "string"}, "text": {"type": "string"}}), vec!["note", "text"])}
    ])
}

fn run_tool(env: &Env, name: &str, a: &Value) -> Result<String, String> {
    let st = |k: &str| a[k].as_str().unwrap_or("").to_string();
    match name {
        "regente_peers" => call(env, "peers", json!({})).map(|v| format_peers(&v)),
        "regente_send" => call(env, "send", json!({"to": st("to"), "body": st("message")})).map(|v| format!("enviado (id {})", v["id"].as_str().unwrap_or("?"))),
        "regente_ask" => {
            let wait = a["wait"].as_bool().unwrap_or(true);
            call(env, "ask", json!({"to": st("to"), "body": st("question"), "wait": wait, "timeoutS": a["timeout_s"].as_u64().unwrap_or(300)}))
                .map(|v| v["reply"].as_str().map(String::from).unwrap_or_else(|| format!("pergunta enviada (id {})", v["id"].as_str().unwrap_or("?"))))
        }
        "regente_reply" => call(env, "reply", json!({"id": st("id"), "body": st("reply")})).map(|_| "resposta enviada".into()),
        "regente_read" => call(env, "read", json!({"peer": st("peer"), "last": a["last"].as_u64().unwrap_or(40)})).map(|v| v["text"].as_str().unwrap_or("").into()),
        "regente_status" => call(env, "status", json!({"text": st("text"), "state": st("state"), "progress": a["progress"].as_str()})).map(|_| "status publicado".into()),
        "regente_notify" => call(env, "notify", json!({"text": st("text")})).map(|_| "notificação enviada".into()),
        "regente_keys" => call(env, "keys", json!({"to": st("to"), "keys": st("keys")})).map(|v| v["text"].as_str().unwrap_or("").into()),
        "regente_recruit" => call(env, "recruit", json!({"profile": st("profile"), "name": a["name"].as_str(), "cwd": a["cwd"].as_str()}))
            .map(|v| format!("recrutado: {} (perfil {})", v["name"].as_str().unwrap_or("?"), v["profile"].as_str().unwrap_or("?"))),
        "regente_connect" => call(env, "connect", json!({"a": st("a"), "b": st("b"), "bidirectional": a["bidirectional"].as_bool().unwrap_or(true)})).map(|_| "conectados".into()),
        "regente_dismiss" => call(env, "dismiss", json!({"name": st("name")})).map(|_| "agente dispensado".into()),
        "regente_note_list" => call(env, "note_list", json!({})).map(|v| {
            v["notes"].as_array().cloned().unwrap_or_default().iter().map(|n| n["title"].as_str().unwrap_or("?").to_string()).collect::<Vec<_>>().join("\n")
        }),
        "regente_note_read" => call(env, "note_read", json!({"note": st("note"), "offset": a["offset"].as_u64(), "limit": a["limit"].as_u64()})).map(|v| v["text"].as_str().unwrap_or("").into()),
        "regente_note_edit" => call(env, "note_edit", json!({"note": st("note"), "old": st("old"), "new": st("new")})).map(|_| "nota editada".into()),
        "regente_note_write" => call(env, "note_write", json!({"note": st("note"), "text": st("text")})).map(|_| "nota substituída".into()),
        "regente_note_add" => call(env, "note_add", json!({"note": st("note"), "text": st("text")})).map(|_| "nota atualizada".into()),
        other => Err(format!("ferramenta desconhecida: {other}")),
    }
}

/// Processa uma mensagem JSON-RPC; `None` para notificações (sem resposta).
pub fn handle(env: &Result<Env, String>, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned()?; // sem id = notificação
    let method = msg["method"].as_str().unwrap_or("");
    let ok = |r: Value| Some(json!({"jsonrpc": "2.0", "id": id, "result": r}));
    match method {
        "initialize" => ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "regente-mcp", "version": env!("CARGO_PKG_VERSION")}
        })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({"tools": tools()})),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let args = &msg["params"]["arguments"];
            let res = match env {
                Ok(e) => run_tool(e, name, args),
                Err(m) => Err(m.clone()),
            };
            match res {
                Ok(t) => ok(json!({"content": [{"type": "text", "text": t}]})),
                Err(m) => ok(json!({"content": [{"type": "text", "text": m}], "isError": true})),
            }
        }
        _ => Some(
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("método não suportado: {method}")}}),
        ),
    }
}

fn main() {
    let env = Env::load();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(resp) = handle(&env, &msg) {
            let _ = writeln!(out, "{resp}");
            let _ = out.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env() -> Result<Env, String> {
        Err("sem ambiente".into())
    }

    #[test]
    fn initialize_and_list_tools() {
        let r = handle(&no_env(), &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}})).unwrap();
        assert_eq!(r["result"]["serverInfo"]["name"], "regente-mcp");
        let r = handle(
            &no_env(),
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        assert!(r["result"]["tools"].as_array().unwrap().len() >= 8);
    }

    #[test]
    fn notifications_get_no_reply() {
        assert!(handle(
            &no_env(),
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .is_none());
    }

    #[test]
    fn tool_call_without_env_reports_error() {
        let r = handle(&no_env(), &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"regente_peers","arguments":{}}})).unwrap();
        assert_eq!(r["result"]["isError"], true);
    }
}
