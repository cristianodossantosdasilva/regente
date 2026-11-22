//! Utilidades de sistema: uso de CPU/RAM por árvore de processos, git, busca no PATH, base64.
use std::collections::HashMap;
use std::process::Command;
use sysinfo::{Pid, ProcessesToUpdate, System};

#[cfg(windows)]
fn hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

/// CPU (% de um núcleo normalizado pelo total de núcleos) e RAM (bytes) somados na árvore de cada raiz.
pub fn tree_usage(sys: &mut System, roots: &[(String, u32)]) -> HashMap<String, (f32, u64)> {
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1) as f32;
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, p) in sys.processes() {
        if let Some(parent) = p.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let mut out = HashMap::new();
    for (id, root) in roots {
        let mut stack = vec![Pid::from_u32(*root)];
        let (mut cpu, mut mem) = (0f32, 0u64);
        let mut seen = 0;
        while let Some(pid) = stack.pop() {
            seen += 1;
            if seen > 512 {
                break;
            }
            if let Some(p) = sys.process(pid) {
                cpu += p.cpu_usage();
                mem += p.memory();
            }
            if let Some(c) = children.get(&pid) {
                stack.extend(c.iter().copied());
            }
        }
        out.insert(id.clone(), (cpu / cores, mem));
    }
    out
}

pub fn which(name: &str) -> Option<String> {
    let finder = if cfg!(windows) { "where.exe" } else { "which" };
    let o = hidden(&mut Command::new(finder)).arg(name).output().ok()?;
    if !o.status.success() {
        return None;
    }
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        if which("pwsh.exe").is_some() {
            "pwsh.exe".into()
        } else {
            "powershell.exe".into()
        }
    } else {
        unix_shell(std::env::var("SHELL").ok())
    }
}

/// Shell padrão no Unix: o `$SHELL` do usuário se for um caminho absoluto; senão `/bin/sh`.
/// Nunca procura executáveis do Windows (`pwsh.exe`), que o WSL expõe no PATH por interoperabilidade.
pub fn unix_shell(env_shell: Option<String>) -> String {
    match env_shell {
        Some(sh) if sh.starts_with('/') && !sh.trim().is_empty() => sh,
        _ => "/bin/sh".into(),
    }
}

pub fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let o = hidden(&mut Command::new("git"))
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_shell_uses_env_shell_or_falls_back() {
        assert_eq!(unix_shell(Some("/bin/zsh".into())), "/bin/zsh");
        assert_eq!(
            unix_shell(Some("pwsh.exe".into())),
            "/bin/sh",
            "nunca um executável do Windows"
        );
        assert_eq!(unix_shell(Some("".into())), "/bin/sh");
        assert_eq!(unix_shell(None), "/bin/sh");
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn tree_usage_sees_current_process() {
        let mut s = System::new();
        let me = std::process::id();
        let u = tree_usage(&mut s, &[("self".into(), me)]);
        assert!(u["self"].1 > 0);
    }
}
