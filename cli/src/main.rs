use regente_client::{call, format_peers, Env};
use serde_json::json;
use std::io::Read;
use std::process::exit;

const USO: &str = "regente — orquestração entre agentes do canvas

USO:
  regente peers                              lista pares e notas conectados
  regente send <par> <mensagem...>           envia uma mensagem (sem esperar)
  regente ask <par> <pergunta...> [--wait] [--timeout <s>]
                                             pergunta; com --wait bloqueia até a resposta
  regente reply <id> <resposta...>           responde a uma mensagem recebida (use '-' para ler do stdin)
  regente read <par> [--last <N>]            últimas N linhas da saída do par (padrão 40)
  regente note list                          notas conectadas
  regente ask --batch '{\"par1\":\"pergunta\",\"par2\":\"pergunta\"}' [--timeout <s>]
                                             pergunta a vários pares em paralelo; devolve JSON [{name, output|error}]
  regente note read <nota> [--offset <N>] [--limit <N>]   lê uma nota (faixa de linhas, 1-based)
  regente note add <nota> <texto...>         acrescenta texto a uma nota
  regente note edit <nota> <antigo> <novo>   troca um trecho que apareça uma única vez
  regente note write <nota> <texto...>       substitui todo o conteúdo da nota
  regente status <texto...> --state working|blocked|review|done [--progress n/m]
                                             publica o seu status de trabalho (visível ao usuário e aos pares)
  regente notify <mensagem...>               envia uma notificação do sistema ao usuário (use só quando pedido)
  regente keys <par> <teclas>                envia teclas cruas ao par (\\n Enter, \\t Tab, \\e ESC, \\xNN); exige 'Permitir teclas' na conexão
  regente recruit <perfil> [--name <nome>] [--cwd <pasta>]
                                             (coordenador) cria um agente novo já conectado a você
  regente connect <a> <b> [--one-way]        (coordenador) conecta dois agentes que você gerencia
  regente dismiss <nome>                     (coordenador) encerra um agente que você recrutou
  regente debug                              diagnóstico da conexão com o broker
  regente mcp-config                         imprime a configuração MCP (regente-mcp)
";

fn text_arg(parts: &[String]) -> String {
    if parts.len() == 1 && parts[0] == "-" {
        let mut s = String::new();
        let _ = std::io::stdin().read_to_string(&mut s);
        return s.trim().to_string();
    }
    parts.join(" ")
}

#[derive(Default)]
struct Flags {
    wait: bool,
    timeout: Option<u64>,
    last: Option<u64>,
    offset: Option<u64>,
    limit: Option<u64>,
    batch: Option<String>,
    state: Option<String>,
    progress: Option<String>,
    name: Option<String>,
    cwd: Option<String>,
    one_way: bool,
}

/// Separa flags (`--wait`, `--timeout N`, `--last N`, `--offset N`, `--limit N`, `--batch JSON`) dos argumentos posicionais.
fn parse(args: &[String]) -> (Vec<String>, Flags) {
    let (mut pos, mut f) = (vec![], Flags::default());
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].clone();
        let mut take = || {
            i += 1;
            args.get(i).cloned()
        };
        match flag.as_str() {
            "--wait" => f.wait = true,
            "--timeout" => f.timeout = take().and_then(|v| v.parse().ok()),
            "--last" => f.last = take().and_then(|v| v.parse().ok()),
            "--offset" => f.offset = take().and_then(|v| v.parse().ok()),
            "--limit" => f.limit = take().and_then(|v| v.parse().ok()),
            "--batch" => f.batch = take(),
            "--state" => f.state = take(),
            "--progress" => f.progress = take(),
            "--name" => f.name = take(),
            "--cwd" => f.cwd = take(),
            "--one-way" => f.one_way = true,
            other => pos.push(other.to_string()),
        }
        i += 1;
    }
    (pos, f)
}

/// Pergunta a vários pares em paralelo (uma conexão ao broker por par) e devolve `[{name, output|error}]`.
fn ask_batch(env: &Env, spec: &str, timeout: u64) -> Result<String, String> {
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(spec)
        .map_err(|e| format!("--batch inválido (esperado objeto {{par: pergunta}}): {e}"))?;
    if map.is_empty() {
        return Err("--batch vazio".into());
    }
    let handles: Vec<_> = map
        .into_iter()
        .map(|(name, q)| {
            let env = env.clone();
            std::thread::spawn(move || {
                let body = q.as_str().unwrap_or("").to_string();
                match call(
                    &env,
                    "ask",
                    json!({"to": name, "body": body, "wait": true, "timeoutS": timeout}),
                ) {
                    Ok(v) => json!({"name": name, "output": v["reply"].as_str().unwrap_or("")}),
                    Err(e) => json!({"name": name, "error": e}),
                }
            })
        })
        .collect();
    let out: Vec<_> = handles
        .into_iter()
        .map(|h| {
            h.join()
                .unwrap_or_else(|_| json!({"error": "falha interna"}))
        })
        .collect();
    Ok(serde_json::to_string_pretty(&out).unwrap())
}

/// Diagnóstico: variáveis do ambiente, ida e volta ao broker e resumo das conexões.
fn debug(env: &Env) -> Result<String, String> {
    let mut out = format!(
        "pipe: {}\nterminal: {}\nregente: {}\n",
        env.pipe,
        env.terminal,
        env!("CARGO_PKG_VERSION")
    );
    let t0 = std::time::Instant::now();
    let v = call(env, "ping", json!({})).map_err(|e| format!("{out}\nFALHA ao falar com o broker: {e}\nDica: reinicie este terminal se o app foi reiniciado (o pipe muda a cada execução)."))?;
    out.push_str(&format!(
        "broker: ok em {} ms (app {})\nvocê: {} [{}]\nconexões: {} · notas: {} · pausado: {}\n",
        t0.elapsed().as_millis(),
        v["version"].as_str().unwrap_or("?"),
        v["terminal"]["name"].as_str().unwrap_or("?"),
        v["terminal"]["profile"].as_str().unwrap_or(""),
        v["connections"],
        v["notes"],
        v["paused"]
    ));
    Ok(out)
}

fn fail(msg: &str) -> ! {
    eprintln!("regente: {msg}");
    exit(1)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().cloned() else {
        print!("{USO}");
        return;
    };
    if cmd == "-h" || cmd == "--help" || cmd == "help" {
        print!("{USO}");
        return;
    }
    if cmd == "mcp-config" {
        let exe = std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .map(|d| d.join(format!("regente-mcp{}", std::env::consts::EXE_SUFFIX)))
        });
        let command = exe
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "regente-mcp".into());
        println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"mcpServers": {"regente": {"command": command, "args": []}}})
            )
            .unwrap()
        );
        println!("\nClaude Code: claude mcp add regente -- regente-mcp");
        return;
    }
    let env = Env::load().unwrap_or_else(|e| fail(&e));
    let rest = &args[1..];
    let (pos, f) = parse(rest);
    let (wait, timeout, last) = (f.wait, f.timeout, f.last);

    let result = match cmd.as_str() {
        "peers" => call(&env, "peers", json!({})).map(|v| format_peers(&v)),
        "send" => {
            if pos.len() < 2 {
                fail("uso: regente send <par> <mensagem...>")
            }
            call(&env, "send", json!({"to": pos[0], "body": text_arg(&pos[1..])})).map(|v| format!("enviado (id {})", v["id"].as_str().unwrap_or("?")))
        }
        "ask" if f.batch.is_some() => ask_batch(&env, f.batch.as_deref().unwrap(), timeout.unwrap_or(300)),
        "ask" => {
            if pos.len() < 2 {
                fail("uso: regente ask <par> <pergunta...> [--wait]")
            }
            call(&env, "ask", json!({"to": pos[0], "body": text_arg(&pos[1..]), "wait": wait, "timeoutS": timeout.unwrap_or(300)})).map(|v| {
                match v["reply"].as_str() {
                    Some(r) => r.to_string(),
                    None => format!("pergunta enviada (id {}); a resposta chegará neste terminal", v["id"].as_str().unwrap_or("?")),
                }
            })
        }
        "reply" => {
            if pos.len() < 2 {
                fail("uso: regente reply <id> <resposta...>")
            }
            call(&env, "reply", json!({"id": pos[0], "body": text_arg(&pos[1..])})).map(|_| "resposta enviada".to_string())
        }
        "read" => {
            if pos.is_empty() {
                fail("uso: regente read <par> [--last N]")
            }
            call(&env, "read", json!({"peer": pos[0], "last": last.unwrap_or(40)})).map(|v| v["text"].as_str().unwrap_or("").to_string())
        }
        "status" => {
            let uso = "uso: regente status <texto...> --state working|blocked|review|done [--progress n/m]";
            let Some(state) = f.state.clone() else { fail(uso) };
            if pos.is_empty() {
                fail(uso)
            }
            call(&env, "status", json!({"text": text_arg(&pos), "state": state, "progress": f.progress})).map(|_| "status publicado".to_string())
        }
        "notify" => {
            if pos.is_empty() {
                fail("uso: regente notify <mensagem...>")
            }
            call(&env, "notify", json!({"text": text_arg(&pos)})).map(|_| "notificação enviada".to_string())
        }
        "keys" => {
            if pos.len() < 2 {
                fail("uso: regente keys <par> \"<teclas>\"   (ex.: regente keys kiro \"2\\n\")")
            }
            call(&env, "keys", json!({"to": pos[0], "keys": pos[1..].join(" ")})).map(|v| v["text"].as_str().unwrap_or("").to_string())
        }
        "recruit" => {
            if pos.is_empty() {
                fail("uso: regente recruit <perfil> [--name <nome>] [--cwd <pasta>]")
            }
            call(&env, "recruit", json!({"profile": pos[0], "name": f.name, "cwd": f.cwd}))
                .map(|v| format!("recrutado: {} (perfil {})", v["name"].as_str().unwrap_or("?"), v["profile"].as_str().unwrap_or("?")))
        }
        "connect" => {
            if pos.len() < 2 {
                fail("uso: regente connect <a> <b> [--one-way]")
            }
            call(&env, "connect", json!({"a": pos[0], "b": pos[1], "bidirectional": !f.one_way})).map(|_| "conectados".to_string())
        }
        "dismiss" => {
            if pos.is_empty() {
                fail("uso: regente dismiss <nome>")
            }
            call(&env, "dismiss", json!({"name": pos.join(" ")})).map(|_| "agente dispensado".to_string())
        }
        "debug" => debug(&env),
        "note" => match pos.first().map(|s| s.as_str()) {
            Some("list") => call(&env, "note_list", json!({})).map(|v| {
                v["notes"].as_array().cloned().unwrap_or_default().iter().map(|n| n["title"].as_str().unwrap_or("?").to_string()).collect::<Vec<_>>().join("\n")
            }),
            Some("read") if pos.len() >= 2 => call(&env, "note_read", json!({"note": pos[1..].join(" "), "offset": f.offset, "limit": f.limit})).map(|v| v["text"].as_str().unwrap_or("").to_string()),
            Some("edit") if pos.len() == 4 => call(&env, "note_edit", json!({"note": pos[1], "old": pos[2], "new": pos[3]})).map(|_| "nota editada".to_string()),
            Some("write") if pos.len() >= 3 => call(&env, "note_write", json!({"note": pos[1], "text": text_arg(&pos[2..])})).map(|_| "nota substituída".to_string()),
            Some("add") if pos.len() >= 3 => call(&env, "note_add", json!({"note": pos[1], "text": text_arg(&pos[2..])})).map(|_| "nota atualizada".to_string()),
            _ => fail("uso: regente note list | read <nota> [--offset N --limit N] | add <nota> <texto...> | edit <nota> <antigo> <novo> | write <nota> <texto...>"),
        },
        other => fail(&format!("comando desconhecido: {other}\n\n{USO}")),
    };
    match result {
        Ok(out) => println!("{out}"),
        Err(e) => fail(&e),
    }
}
