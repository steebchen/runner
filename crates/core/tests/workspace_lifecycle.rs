use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use runner_core::{git, Core};

async fn wait_status(core: &Core, id: &str, want: &str) {
    for _ in 0..200 {
        if core.store.workspace(id).unwrap().status == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("workspace never became {want}: {:?}", core.store.workspace(id).unwrap());
}

#[tokio::test]
async fn create_archive_restore() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    for args in [
        &["init", "-q", "-b", "main"][..],
        &["config", "user.email", "t@t"],
        &["config", "user.name", "t"],
        &["commit", "-q", "--allow-empty", "-m", "init"],
    ] {
        git::git(&repo, args).await.unwrap();
    }

    let core = Core::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();
    let mut settings = core.settings();
    settings.workspaces_root = tmp.path().join("ws").to_string_lossy().into();
    core.save_settings(&settings).unwrap();

    let r = core.add_repo(&repo.to_string_lossy()).await.unwrap();
    let ws = core.create_workspace(&r.id).await.unwrap();
    assert_eq!(ws.status, "creating", "creation returns before the worktree exists");
    wait_status(&core, &ws.id, "ready").await;

    // Commit work on the workspace branch, then archive.
    let path = Path::new(&ws.path);
    std::fs::write(path.join("work.txt"), "hello").unwrap();
    git::commit_all(path, "work").await.unwrap();
    // Uncommitted edits and new files must survive archive + restore.
    std::fs::write(path.join("work.txt"), "hello, edited").unwrap();
    std::fs::write(path.join("draft.txt"), "untracked").unwrap();
    core.archive_workspace(&ws.id).await.unwrap();
    assert!(!path.exists());
    let archived = core.store.workspace(&ws.id).unwrap();
    assert_eq!(archived.status, "archived");
    assert!(archived.archived_at.is_some());
    assert!(core.store.workspaces().unwrap().is_empty());
    assert_eq!(core.store.all_workspaces().unwrap().len(), 1);

    // Restore brings the branch back into a fresh worktree.
    let restored = core.restore_workspace(&ws.id).await.unwrap();
    assert_eq!(restored.status, "creating");
    wait_status(&core, &ws.id, "ready").await;
    assert_eq!(std::fs::read_to_string(path.join("work.txt")).unwrap(), "hello, edited");
    assert_eq!(std::fs::read_to_string(path.join("draft.txt")).unwrap(), "untracked");
    assert!(git::stash_find(&repo, "runner-archive:").await.is_none(), "stash is consumed");
    assert!(core.store.workspace(&ws.id).unwrap().archived_at.is_none());

    // Restoring something that isn't archived is an error.
    assert!(core.restore_workspace(&ws.id).await.is_err());
}
