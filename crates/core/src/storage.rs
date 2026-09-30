//! Keep pre-Suneiro installations usable without moving databases or attachments.

use std::path::{Path, PathBuf};

/// Existing Suneiro data wins. Otherwise keep using Runner's directory in place:
/// transcript attachment paths are absolute, and SQLite may have WAL sidecars.
pub fn data_dir(preferred: &Path) -> PathBuf {
    if database_path(preferred).is_file() {
        return preferred.to_path_buf();
    }
    if let Some(parent) = preferred.parent() {
        let legacy = parent.join("dev.runner.desktop");
        if database_path(&legacy).is_file() {
            return legacy;
        }
    }
    preferred.to_path_buf()
}

/// New installations use the new name; existing databases remain in place.
pub fn database_path(dir: &Path) -> PathBuf {
    let current = dir.join("suneiro.sqlite");
    let legacy = dir.join("runner.sqlite");
    if !current.exists() && legacy.is_file() { legacy } else { current }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn fresh_install_uses_suneiro() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join("com.suneiro.desktop");
        assert_eq!(data_dir(&preferred), preferred);
        assert_eq!(database_path(&preferred), preferred.join("suneiro.sqlite"));
    }

    #[test]
    fn upgrade_reads_legacy_data_and_keeps_attachments_in_place() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join("dev.runner.desktop");
        let preferred = root.path().join("com.suneiro.desktop");
        let old = Store::open(&legacy.join("runner.sqlite")).unwrap();
        old.set_setting("settings", r#"{"branchPrefix":"custom/"}"#).unwrap();
        std::fs::create_dir_all(legacy.join("attachments")).unwrap();
        std::fs::write(legacy.join("attachments/image.png"), b"image").unwrap();
        // Tauri can create its new directory before the core starts.
        std::fs::create_dir_all(&preferred).unwrap();
        let resolved = data_dir(&preferred);
        assert_eq!(resolved, legacy);
        let upgraded = Store::open(&database_path(&resolved)).unwrap();
        assert_eq!(upgraded.setting("settings").unwrap(), old.setting("settings").unwrap());
        assert!(resolved.join("attachments/image.png").is_file());
        assert!(!preferred.join("suneiro.sqlite").exists());
    }

    #[test]
    fn existing_suneiro_database_takes_precedence() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join("com.suneiro.desktop");
        let legacy = root.path().join("dev.runner.desktop");
        let _old = Store::open(&legacy.join("runner.sqlite")).unwrap();
        let _new = Store::open(&preferred.join("suneiro.sqlite")).unwrap();
        assert_eq!(data_dir(&preferred), preferred);
        let _same_dir_old = Store::open(&preferred.join("runner.sqlite")).unwrap();
        assert_eq!(database_path(&preferred), preferred.join("suneiro.sqlite"));
    }
}
