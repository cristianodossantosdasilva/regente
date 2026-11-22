//! Persistência: escrita atômica, backup rotativo e recuperação após crash.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const MAX_BACKUPS: usize = 10;
/// Intervalo mínimo entre backups (o salvamento é contínuo; evita inundar a pasta).
const BACKUP_INTERVAL: Duration = Duration::from_secs(60);

fn backups_dir(dir: &Path) -> PathBuf {
    dir.join("backups")
}

fn list_backups(dir: &Path) -> Vec<(SystemTime, PathBuf)> {
    let mut v: Vec<(SystemTime, PathBuf)> = fs::read_dir(backups_dir(dir))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, e.path()))
        })
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0)); // mais novo primeiro
    v
}

/// Salva `content` em `dir/workspace.json` de forma atômica, rotacionando backups.
pub fn save_atomic(dir: &Path, content: &str) -> io::Result<()> {
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("JSON inválido: {e}")))?;
    fs::create_dir_all(dir)?;
    let target = dir.join("workspace.json");
    if target.exists() {
        let recent = list_backups(dir)
            .first()
            .map(|(t, _)| t.elapsed().unwrap_or_default() < BACKUP_INTERVAL)
            .unwrap_or(false);
        if !recent {
            fs::create_dir_all(backups_dir(dir))?;
            let stamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            fs::copy(
                &target,
                backups_dir(dir).join(format!("workspace-{stamp}.json")),
            )?;
            for (_, old) in list_backups(dir).into_iter().skip(MAX_BACKUPS) {
                let _ = fs::remove_file(old);
            }
        }
    }
    let tmp = dir.join("workspace.json.tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, &target)
}

/// Carrega o workspace; se o arquivo principal estiver corrompido, usa o backup válido mais recente.
/// Retorna (conteúdo, recuperado_de_backup).
pub fn load_with_recovery(dir: &Path) -> io::Result<(String, bool)> {
    let valid = |p: &Path| -> Option<String> {
        let s = fs::read_to_string(p).ok()?;
        serde_json::from_str::<serde_json::Value>(&s).ok()?;
        Some(s)
    };
    if let Some(s) = valid(&dir.join("workspace.json")) {
        return Ok((s, false));
    }
    for (_, p) in list_backups(dir) {
        if let Some(s) = valid(&p) {
            return Ok((s, true));
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "workspace não encontrado",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads() {
        let d = tempfile::tempdir().unwrap();
        save_atomic(d.path(), r#"{"version":1}"#).unwrap();
        let (s, rec) = load_with_recovery(d.path()).unwrap();
        assert_eq!(s, r#"{"version":1}"#);
        assert!(!rec);
    }

    #[test]
    fn rejects_invalid_json() {
        let d = tempfile::tempdir().unwrap();
        assert!(save_atomic(d.path(), "{oops").is_err());
    }

    #[test]
    fn recovers_from_corrupt_main_file() {
        let d = tempfile::tempdir().unwrap();
        save_atomic(d.path(), r#"{"version":1,"n":1}"#).unwrap();
        // o segundo save cria backup do primeiro
        save_atomic(d.path(), r#"{"version":1,"n":2}"#).unwrap();
        fs::write(d.path().join("workspace.json"), "{corrompido").unwrap();
        let (s, rec) = load_with_recovery(d.path()).unwrap();
        assert!(rec);
        assert!(s.contains("\"n\":1"));
    }

    #[test]
    fn rotates_backups() {
        let d = tempfile::tempdir().unwrap();
        save_atomic(d.path(), r#"{"a":0}"#).unwrap();
        fs::create_dir_all(backups_dir(d.path())).unwrap();
        for i in 0..15 {
            let p = backups_dir(d.path()).join(format!("workspace-{i}.json"));
            fs::write(&p, "{}").unwrap();
            let f = fs::OpenOptions::new().write(true).open(&p).unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(3600 + i))
                .unwrap();
        }
        save_atomic(d.path(), r#"{"a":1}"#).unwrap();
        assert!(list_backups(d.path()).len() <= MAX_BACKUPS);
    }
}
