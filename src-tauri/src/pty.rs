//! Gerenciamento de PTY (ConPTY no Windows) com buffer circular de replay.
//!
//! O buffer guarda a saída já decodificada em UTF-8 e numera os bytes (`start`/`end`),
//! permitindo que o front-end descarte o xterm de terminais fora da tela ("dormência")
//! e recrie o estado depois via `snapshot`, sem perder nem duplicar saída.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// (id, offset inicial, texto)
pub type OutputSink = Arc<dyn Fn(&str, u64, String) + Send + Sync>;
/// (id, código de saída)
pub type ExitSink = Arc<dyn Fn(&str, u32) + Send + Sync>;

const DEFAULT_RING_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnSpec {
    pub id: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub scrollback_bytes: Option<usize>,
}

pub struct Ring {
    buf: VecDeque<u8>,
    total: u64,
    cap: usize,
}

impl Ring {
    pub fn new(cap: usize) -> Self {
        Ring {
            buf: VecDeque::new(),
            total: 0,
            cap: cap.max(4096),
        }
    }
    /// Acrescenta bytes e devolve o offset inicial.
    pub fn push(&mut self, bytes: &[u8]) -> u64 {
        let start = self.total;
        self.buf.extend(bytes.iter());
        self.total += bytes.len() as u64;
        if self.buf.len() > self.cap {
            let excess = self.buf.len() - self.cap;
            self.buf.drain(..excess);
        }
        start
    }
    pub fn snapshot(&self) -> (String, u64) {
        let (a, b) = self.buf.as_slices();
        let mut v = Vec::with_capacity(self.buf.len());
        v.extend_from_slice(a);
        v.extend_from_slice(b);
        // descarta bytes de continuação UTF-8 no início (corte no meio de um caractere)
        let skip = v.iter().take_while(|b| (**b & 0xC0) == 0x80).count();
        (String::from_utf8_lossy(&v[skip..]).into_owned(), self.total)
    }
    pub fn len(&self) -> usize {
        self.buf.len()
    }
}

pub struct Session {
    pub id: String,
    pub pid: Option<u32>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    ring: Mutex<Ring>,
    last_output_ms: AtomicU64,
    exit: Mutex<Option<u32>>,
    removed: AtomicBool,
    /// Quando falso (terminal dormente), a saída só vai para o buffer, sem eventos para a UI.
    streaming: AtomicBool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Extrai o maior prefixo UTF-8 válido de `carry`, deixando bytes incompletos para a próxima leitura.
pub fn take_valid_utf8(carry: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                break;
            }
            Err(e) => {
                let v = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..v]).unwrap_or(""));
                match e.error_len() {
                    Some(l) => {
                        out.push('\u{FFFD}');
                        carry.drain(..v + l);
                    }
                    None => {
                        carry.drain(..v);
                        break;
                    }
                }
            }
        }
    }
    out
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

pub struct SessionStat {
    pub id: String,
    pub pid: Option<u32>,
    pub exit: Option<u32>,
    pub idle_ms: u64,
    pub ring_bytes: usize,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(
        &self,
        spec: SpawnSpec,
        out: OutputSink,
        on_exit: ExitSink,
    ) -> Result<Option<u32>, String> {
        if self.get(&spec.id).is_some() {
            return Err(format!("terminal {} já existe", spec.id));
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: spec.rows.max(2),
                cols: spec.cols.max(10),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            if std::path::Path::new(cwd).is_dir() {
                cmd.cwd(cwd);
            }
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let pid = child.process_id();
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let sess = Arc::new(Session {
            id: spec.id.clone(),
            pid,
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            ring: Mutex::new(Ring::new(
                spec.scrollback_bytes.unwrap_or(DEFAULT_RING_BYTES),
            )),
            last_output_ms: AtomicU64::new(now_ms()),
            exit: Mutex::new(None),
            removed: AtomicBool::new(false),
            streaming: AtomicBool::new(true),
        });
        self.sessions
            .lock()
            .unwrap()
            .insert(spec.id.clone(), sess.clone());

        // Leitor de saída
        let s1 = sess.clone();
        std::thread::spawn(move || {
            let mut reader: Box<dyn Read + Send> = reader;
            let mut buf = [0u8; 16384];
            let mut carry: Vec<u8> = Vec::new();
            let emit = |text: String| {
                if text.is_empty() {
                    return;
                }
                let start = s1.ring.lock().unwrap().push(text.as_bytes());
                s1.last_output_ms.store(now_ms(), Ordering::Relaxed);
                if s1.streaming.load(Ordering::Relaxed) {
                    out(&s1.id, start, text);
                }
            };
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        carry.extend_from_slice(&buf[..n]);
                        emit(take_valid_utf8(&mut carry));
                    }
                }
            }
            if !carry.is_empty() {
                emit(String::from_utf8_lossy(&carry).into_owned());
            }
        });

        // Vigia de saída do processo (o EOF do ConPTY não é confiável para isso)
        let s2 = sess.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if s2.removed.load(Ordering::Relaxed) {
                break;
            }
            let status = s2.child.lock().unwrap().try_wait();
            if let Ok(Some(st)) = status {
                let code = st.exit_code();
                *s2.exit.lock().unwrap() = Some(code);
                std::thread::sleep(std::time::Duration::from_millis(300)); // deixa a última saída chegar
                on_exit(&s2.id, code);
                break;
            }
        });
        Ok(pid)
    }

    pub fn get(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let s = self.get(id).ok_or("terminal inexistente")?;
        let mut w = s.writer.lock().unwrap();
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let s = self.get(id).ok_or("terminal inexistente")?;
        let r = s
            .master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(10),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string());
        r
    }

    /// Encerra o processo e toda a árvore de filhos, e libera o PTY.
    pub fn kill(&self, id: &str) {
        let removed = self.sessions.lock().unwrap().remove(id);
        if let Some(s) = removed {
            s.removed.store(true, Ordering::Relaxed);
            if let Some(pid) = s.pid {
                kill_tree(pid);
            }
            let _ = s.child.lock().unwrap().kill();
        }
    }

    pub fn snapshot(&self, id: &str) -> Option<(String, u64, Option<u32>)> {
        let s = self.get(id)?;
        let (text, end) = s.ring.lock().unwrap().snapshot();
        let exit = *s.exit.lock().unwrap();
        Some((text, end, exit))
    }

    pub fn set_streaming(&self, id: &str, on: bool) {
        if let Some(s) = self.get(id) {
            s.streaming.store(on, Ordering::Relaxed);
        }
    }

    /// Últimos `max_bytes` do buffer (texto bruto, com ANSI).
    pub fn tail(&self, id: &str, max_bytes: usize) -> Option<String> {
        let s = self.get(id)?;
        let r = s.ring.lock().unwrap();
        let skip = r.buf.len().saturating_sub(max_bytes);
        let v: Vec<u8> = r.buf.iter().skip(skip).copied().collect();
        let lead = v.iter().take_while(|b| (**b & 0xC0) == 0x80).count();
        Some(String::from_utf8_lossy(&v[lead..]).into_owned())
    }

    pub fn stats(&self) -> Vec<SessionStat> {
        let now = now_ms();
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| SessionStat {
                id: s.id.clone(),
                pid: s.pid,
                exit: *s.exit.lock().unwrap(),
                idle_ms: now.saturating_sub(s.last_output_ms.load(Ordering::Relaxed)),
                ring_bytes: s.ring.lock().unwrap().len(),
            })
            .collect()
    }

    pub fn ids(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output();
}

#[cfg(unix)]
fn kill_tree(pid: u32) {
    // O PTY cria uma sessão nova: o pid do filho é também o id do grupo de processos.
    if pid > 1 {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(any(windows, unix)))]
fn kill_tree(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn ring_caps_and_numbers_bytes() {
        let mut r = Ring::new(4096);
        let s0 = r.push(&vec![b'a'; 3000]);
        let s1 = r.push(&vec![b'b'; 3000]);
        assert_eq!(s0, 0);
        assert_eq!(s1, 3000);
        let (txt, end) = r.snapshot();
        assert_eq!(end, 6000);
        assert_eq!(txt.len(), 4096);
        assert!(txt.ends_with('b'));
    }

    #[test]
    fn utf8_split_across_reads() {
        let bytes = "ação".as_bytes().to_vec(); // 'ç' e 'ã' têm 2 bytes
        let mut carry = bytes[..2].to_vec(); // 'a' + 1º byte de 'ç'
        let first = take_valid_utf8(&mut carry);
        assert_eq!(first, "a");
        carry.extend_from_slice(&bytes[2..]);
        assert_eq!(take_valid_utf8(&mut carry), "ção");
    }

    #[test]
    fn utf8_invalid_byte_is_replaced() {
        let mut carry = vec![b'o', 0xFF, b'k'];
        assert_eq!(take_valid_utf8(&mut carry), "o\u{FFFD}k");
    }

    #[cfg(windows)]
    #[test]
    fn spawns_real_process_and_reads_output() {
        let m = PtyManager::new();
        let (tx, rx) = mpsc::channel::<String>();
        let (etx, erx) = mpsc::channel::<u32>();
        let out: OutputSink = Arc::new(move |_, _, t| {
            let _ = tx.send(t);
        });
        let ex: ExitSink = Arc::new(move |_, c| {
            let _ = etx.send(c);
        });
        m.spawn(
            SpawnSpec {
                id: "t1".into(),
                program: (if cfg!(windows) { "cmd.exe" } else { "sh" }).into(),
                args: vec!["/c".into(), "echo regente-ok".into()],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
                scrollback_bytes: None,
            },
            out,
            ex,
        )
        .unwrap();
        let mut acc = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline && !acc.contains("regente-ok") {
            if let Ok(t) = rx.recv_timeout(Duration::from_millis(200)) {
                acc.push_str(&t);
            }
        }
        assert!(acc.contains("regente-ok"), "saída: {acc:?}");
        assert_eq!(erx.recv_timeout(Duration::from_secs(10)).unwrap(), 0);
        let (snap, end, exit) = m.snapshot("t1").unwrap();
        assert!(snap.contains("regente-ok"));
        assert!(end > 0);
        assert_eq!(exit, Some(0));
        m.kill("t1");
    }

    #[cfg(windows)]
    #[test]
    fn write_and_resize_work() {
        let m = PtyManager::new();
        let (tx, rx) = mpsc::channel::<String>();
        let out: OutputSink = Arc::new(move |_, _, t| {
            let _ = tx.send(t);
        });
        let ex: ExitSink = Arc::new(|_, _| {});
        m.spawn(
            SpawnSpec {
                id: "t2".into(),
                program: (if cfg!(windows) { "cmd.exe" } else { "sh" }).into(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
                scrollback_bytes: None,
            },
            out,
            ex,
        )
        .unwrap();
        m.resize("t2", 100, 30).unwrap();
        m.write("t2", b"echo eco-teste\r").unwrap();
        let mut acc = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline && acc.matches("eco-teste").count() < 2 {
            if let Ok(t) = rx.recv_timeout(Duration::from_millis(200)) {
                acc.push_str(&t);
            }
        }
        assert!(acc.matches("eco-teste").count() >= 2, "saída: {acc:?}");
        m.kill("t2");
        assert!(m.get("t2").is_none());
    }
}
