pub mod ansi;
pub mod broker;
pub mod orchestrator;
pub mod persist;
pub mod pty;
pub mod state;
pub mod sys;

use orchestrator::{Edge, NoteInfo, TermInfo};
use pty::{ExitSink, OutputSink, SpawnSpec};
use serde::Serialize;
use serde_json::{json, Value};
use state::AppState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

type St<'a> = State<'a, Arc<AppState>>;

fn safe_name(s: &str) -> Result<String, String> {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(s.to_string())
    } else {
        Err("identificador inválido".into())
    }
}

// ---------- info ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    cli_dir: Option<String>,
    pipe: String,
    version: String,
    cli_available: bool,
    default_shell: String,
    home: String,
}

#[tauri::command]
fn app_info(st: St) -> AppInfo {
    AppInfo {
        data_dir: st.data_dir.display().to_string(),
        cli_dir: st.cli_dir.as_ref().map(|p| p.display().to_string()),
        pipe: st.pipe_name.clone(),
        version: env!("CARGO_PKG_VERSION").into(),
        cli_available: st
            .cli_dir
            .as_ref()
            .map(|d| d.join("regente.exe").exists())
            .unwrap_or(false),
        default_shell: sys::default_shell(),
        home: std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default(),
    }
}

// ---------- PTY ----------

#[derive(Serialize)]
struct SpawnRes {
    pid: Option<u32>,
}

#[tauri::command]
async fn pty_spawn(
    app: tauri::AppHandle,
    st: St<'_>,
    mut spec: SpawnSpec,
) -> Result<SpawnRes, String> {
    spec.env.insert("REGENTE_PIPE".into(), st.pipe_name.clone());
    spec.env
        .insert("REGENTE_TOKEN".into(), st.issue_token(&spec.id));
    spec.env.insert("REGENTE_TERMINAL".into(), spec.id.clone());
    if let Some(dir) = &st.cli_dir {
        let old = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![dir.clone()];
        paths.extend(std::env::split_paths(&old));
        if let Ok(joined) = std::env::join_paths(paths) {
            spec.env
                .insert("PATH".into(), joined.to_string_lossy().into_owned());
        }
    }
    let a1 = app.clone();
    let out: OutputSink = Arc::new(move |id, start, data| {
        let _ = a1.emit(
            "pty-output",
            json!({"id": id, "start": start, "data": data}),
        );
    });
    let a2 = app.clone();
    let exit: ExitSink = Arc::new(move |id, code| {
        a2.state::<Arc<AppState>>().revoke_tokens(id);
        let _ = a2.emit("pty-exit", json!({"id": id, "code": code}));
    });
    let pid = st.pty.spawn(spec, out, exit)?;
    Ok(SpawnRes { pid })
}

#[tauri::command]
fn pty_write(st: St, id: String, data: String) -> Result<(), String> {
    st.pty.write(&id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(st: St, id: String, cols: u16, rows: u16) -> Result<(), String> {
    st.pty.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_kill(st: St, id: String) {
    st.revoke_tokens(&id);
    st.pty.kill(&id);
}

#[tauri::command]
fn pty_set_streaming(st: St, id: String, on: bool) {
    st.pty.set_streaming(&id, on);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Replay {
    data: String,
    end: u64,
    exit_code: Option<u32>,
}

#[tauri::command]
fn pty_replay(st: St, id: String) -> Result<Replay, String> {
    let (data, end, exit_code) = st.pty.snapshot(&id).ok_or("terminal inexistente")?;
    Ok(Replay {
        data,
        end,
        exit_code,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TermStat {
    id: String,
    pid: Option<u32>,
    alive: bool,
    exit_code: Option<u32>,
    cpu: f32,
    rss_bytes: u64,
    idle_ms: u64,
    ring_bytes: usize,
    tail: String,
}

#[tauri::command]
fn pty_stats(st: St) -> Vec<TermStat> {
    let stats = st.pty.stats();
    let usage = {
        let mut sysm = st.sys.lock().unwrap();
        sys::tree_usage(
            &mut sysm,
            &stats
                .iter()
                .filter_map(|s| s.pid.map(|p| (s.id.clone(), p)))
                .collect::<Vec<_>>(),
        )
    };
    stats
        .into_iter()
        .map(|s| {
            let (cpu, rss) = usage.get(&s.id).copied().unwrap_or((0.0, 0));
            let tail = st
                .pty
                .tail(&s.id, 600)
                .map(|t| ansi::strip_ansi(&t))
                .unwrap_or_default();
            TermStat {
                id: s.id,
                pid: s.pid,
                alive: s.exit.is_none(),
                exit_code: s.exit,
                cpu,
                rss_bytes: rss,
                idle_ms: s.idle_ms,
                ring_bytes: s.ring_bytes,
                tail,
            }
        })
        .collect()
}

#[derive(Serialize)]
struct Hit {
    id: String,
    line: String,
}

/// Busca em memória na saída (sem ANSI) de todos os terminais vivos.
#[tauri::command]
fn search_output(st: St, query: String) -> Vec<Hit> {
    let q = query.to_lowercase();
    if q.len() < 2 {
        return vec![];
    }
    let mut hits = vec![];
    for id in st.pty.ids() {
        if let Some((raw, _, _)) = st.pty.snapshot(&id) {
            for line in ansi::strip_ansi(&raw).lines() {
                if line.to_lowercase().contains(&q) {
                    hits.push(Hit {
                        id: id.clone(),
                        line: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= 100 {
                        return hits;
                    }
                }
            }
        }
    }
    hits
}

// ---------- orquestração ----------

#[tauri::command]
fn orch_sync(st: St, terms: Vec<TermInfo>, notes: Vec<NoteInfo>, edges: Vec<Edge>) {
    let mut o = st.orch.lock().unwrap();
    // Mantém o texto que o broker acabou de gravar numa nota se o front ainda não o recebeu.
    let prev: HashMap<String, String> = o
        .notes
        .iter()
        .map(|(k, v)| (k.clone(), v.text.clone()))
        .collect();
    o.sync(terms, notes, edges);
    for (k, n) in o.notes.iter_mut() {
        if n.text.is_empty() {
            if let Some(t) = prev.get(k) {
                n.text = t.clone();
            }
        }
    }
}

/// Digitação humana num terminal encerra a cadeia de mensagens (profundidade) dele.
#[tauri::command]
fn orch_reset_depth(st: St, id: String) {
    st.orch.lock().unwrap().reset_depth(&id);
}

/// O front informa o estado dos agentes (working/idle/…) para que `peers` o exponha.
#[tauri::command]
fn orch_set_states(st: St, states: HashMap<String, String>) {
    st.orch.lock().unwrap().agent_state = states;
}

#[tauri::command]
fn orch_set_paused(st: St, paused: bool) {
    st.orch.lock().unwrap().paused = paused;
}

#[tauri::command]
fn orch_log(st: St) -> Value {
    json!(st.orch.lock().unwrap().log.iter().collect::<Vec<_>>())
}

/// A interface responde a um pedido de topologia do coordenador (`coord-request`).
#[tauri::command]
fn coord_answer(st: St, id: String, ok: bool, result: Value, error: Option<String>) {
    if let Some(tx) = st.coords.lock().unwrap().remove(&id) {
        let _ = tx.send(if ok {
            Ok(result)
        } else {
            Err(error.unwrap_or_else(|| "falha na interface".into()))
        });
    }
}

/// Dispara uma rotina agendada pela interface (pré-execução, `{{output}}`, pausa e auditoria no broker).
#[tauri::command]
async fn routine_fire(
    ctx: State<'_, broker::Ctx>,
    term: String,
    title: String,
    text: String,
    pre_run: Option<String>,
    cwd: Option<String>,
    reminder: bool,
) -> Result<String, String> {
    ctx.fire_routine(&term, &title, &text, pre_run, cwd, reminder)
        .await
}

#[tauri::command]
fn confirm_answer(st: St, id: String, allow: bool) {
    if let Some(tx) = st.confirms.lock().unwrap().remove(&id) {
        let _ = tx.send(allow);
    }
}

// ---------- persistência ----------

fn ws_dir(st: &AppState, id: &str) -> Result<PathBuf, String> {
    Ok(st.data_dir.join("workspaces").join(safe_name(id)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WsEntry {
    id: String,
    name: String,
    root: String,
    updated_ms: u64,
}

#[tauri::command]
fn ws_list(st: St) -> Vec<WsEntry> {
    let base = st.data_dir.join("workspaces");
    let mut v = vec![];
    for e in std::fs::read_dir(base).into_iter().flatten().flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if let Ok((txt, _)) = persist::load_with_recovery(&e.path()) {
            let j: Value = serde_json::from_str(&txt).unwrap_or(Value::Null);
            let updated = std::fs::metadata(e.path().join("workspace.json"))
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            v.push(WsEntry {
                id,
                name: j["name"].as_str().unwrap_or("Sem nome").into(),
                root: j["root"].as_str().unwrap_or("").into(),
                updated_ms: updated,
            });
        }
    }
    v.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    v
}

#[tauri::command]
fn ws_load(st: St, id: String) -> Result<Value, String> {
    let (txt, recovered) =
        persist::load_with_recovery(&ws_dir(&st, &id)?).map_err(|e| e.to_string())?;
    Ok(json!({"text": txt, "recovered": recovered}))
}

#[tauri::command]
fn ws_save(st: St, id: String, text: String) -> Result<(), String> {
    persist::save_atomic(&ws_dir(&st, &id)?, &text).map_err(|e| e.to_string())
}

#[tauri::command]
fn ws_delete(st: St, id: String) -> Result<(), String> {
    let d = ws_dir(&st, &id)?;
    if d.exists() {
        std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn config_load(st: St, name: String) -> Result<Option<String>, String> {
    let p = st
        .data_dir
        .join("config")
        .join(format!("{}.json", safe_name(&name)?));
    Ok(std::fs::read_to_string(p).ok())
}

#[tauri::command]
fn config_save(st: St, name: String, text: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?;
    let dir = st.data_dir.join("config");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(format!("{}.json", safe_name(&name)?));
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, p).map_err(|e| e.to_string())
}

// ---------- arquivos e git ----------

#[tauri::command]
fn fs_read_text(path: String) -> Result<String, String> {
    let m = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if m.len() > 2 * 1024 * 1024 {
        return Err("arquivo maior que 2 MB".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn fs_read_base64(path: String) -> Result<String, String> {
    let m = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if m.len() > 12 * 1024 * 1024 {
        return Err("arquivo maior que 12 MB".into());
    }
    Ok(sys::base64(
        &std::fs::read(&path).map_err(|e| e.to_string())?,
    ))
}

/// Grava somente dentro de `<root>/.regente/` (contexto versionável do workspace).
#[tauri::command]
fn fs_write_context(root: String, rel: String, text: String) -> Result<(), String> {
    let rel_p = Path::new(&rel);
    if rel_p.is_absolute()
        || rel_p
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("caminho inválido".into());
    }
    let root_p = Path::new(&root);
    if !root_p.is_dir() {
        return Err("diretório raiz inexistente".into());
    }
    let target = root_p.join(".regente").join(rel_p);
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(target, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn detect_commands(names: Vec<String>) -> HashMap<String, Option<String>> {
    names
        .into_iter()
        .map(|n| {
            let r = sys::which(&n);
            (n, r)
        })
        .collect()
}

#[tauri::command]
fn git_info(cwd: String) -> Option<Value> {
    let branch = sys::git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let dirty = sys::git(&cwd, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    Some(json!({"branch": branch.trim(), "dirty": dirty}))
}

#[tauri::command]
fn git_worktree_add(cwd: String, name: String) -> Result<String, String> {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if slug.is_empty() {
        return Err("nome inválido".into());
    }
    let top = sys::git(&cwd, &["rev-parse", "--show-toplevel"])?;
    let top = PathBuf::from(top.trim());
    let base = top
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".into());
    let path = top
        .parent()
        .unwrap_or(&top)
        .join(format!("{base}-wt-{slug}"));
    let branch = format!("regente/{slug}");
    sys::git(
        &cwd,
        &["worktree", "add", "-b", &branch, &path.to_string_lossy()],
    )?;
    Ok(path.to_string_lossy().into_owned())
}

// ---------- app ----------

fn data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Regente")
}

fn find_cli_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    Some(dir)
}

pub fn run() {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let state = Arc::new(AppState::new(dir, find_cli_dir()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let emit: broker::Emit = Arc::new(move |name, payload| {
                let _ = handle.emit(name, payload);
            });
            let ctx = broker::Ctx {
                state: state.clone(),
                emit,
            };
            app.manage(ctx.clone());
            tauri::async_runtime::spawn(broker::serve(ctx));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_set_streaming,
            pty_replay,
            pty_stats,
            search_output,
            orch_sync,
            orch_set_states,
            orch_set_paused,
            orch_reset_depth,
            orch_log,
            confirm_answer,
            coord_answer,
            routine_fire,
            ws_list,
            ws_load,
            ws_save,
            ws_delete,
            config_load,
            config_save,
            fs_read_text,
            fs_read_base64,
            fs_write_context,
            detect_commands,
            git_info,
            git_worktree_add,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Regente");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Não deixa processos órfãos.
            if let Some(st) = handle.try_state::<Arc<AppState>>() {
                for id in st.pty.ids() {
                    st.pty.kill(&id);
                }
            }
        }
    });
}
