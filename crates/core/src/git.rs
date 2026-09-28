//! Thin wrappers over the git CLI. We shell out instead of using libgit2 so
//! worktree semantics, credentials and config match the user's terminal.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Serialize;

use crate::env::tokio_command;

pub async fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = tokio_command("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .context("failed to run git")?;
    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn git_ok(cwd: &Path, args: &[&str]) -> bool {
    git(cwd, args).await.is_ok()
}

pub async fn repo_root(path: &Path) -> Result<String> {
    Ok(git(path, &["rev-parse", "--show-toplevel"]).await?.trim().to_string())
}

pub async fn default_branch(repo: &Path) -> String {
    if let Ok(out) = git(repo, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).await {
        if let Some(b) = out.trim().strip_prefix("origin/") {
            return b.to_string();
        }
    }
    for candidate in ["main", "master"] {
        if git_ok(repo, &["rev-parse", "--verify", "--quiet", candidate]).await {
            return candidate.to_string();
        }
    }
    git(repo, &["branch", "--show-current"])
        .await
        .map(|b| b.trim().to_string())
        .ok()
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "main".into())
}

/// Prefer the remote-tracking ref so new workspaces start from the latest upstream.
pub async fn base_ref(repo: &Path, base_branch: &str) -> String {
    let remote = format!("origin/{base_branch}");
    if git_ok(repo, &["rev-parse", "--verify", "--quiet", &remote]).await {
        remote
    } else {
        base_branch.to_string()
    }
}

pub async fn create_worktree(repo: &Path, path: &Path, branch: &str, base_branch: &str) -> Result<()> {
    let _ = git(repo, &["fetch", "origin", base_branch]).await;
    let base = base_ref(repo, base_branch).await;
    let path = path.to_string_lossy();
    git(repo, &["worktree", "add", "-b", branch, &path, &base]).await?;
    Ok(())
}

pub async fn branch_exists(repo: &Path, branch: &str) -> bool {
    git_ok(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).await
}

/// Check out an existing branch into a new worktree (used to restore archived workspaces).
pub async fn add_worktree(repo: &Path, path: &Path, branch: &str) -> Result<()> {
    let _ = git(repo, &["worktree", "prune"]).await;
    git(repo, &["worktree", "add", &path.to_string_lossy(), branch]).await?;
    Ok(())
}

pub async fn remove_worktree(repo: &Path, path: &Path) -> Result<()> {
    git(repo, &["worktree", "remove", "--force", &path.to_string_lossy()]).await?;
    Ok(())
}

async fn merge_base(wt: &Path, base_branch: &str) -> Result<String> {
    let base = base_ref(wt, base_branch).await;
    Ok(git(wt, &["merge-base", "HEAD", &base]).await?.trim().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// All changes on the workspace branch relative to where it forked from base,
/// including uncommitted and untracked files.
pub async fn changed_files(wt: &Path, base_branch: &str) -> Result<Vec<ChangedFile>> {
    let mb = merge_base(wt, base_branch).await?;
    let status_args = ["diff", "--no-renames", "--name-status", "-z", &mb];
    let numstat_args = ["diff", "--no-renames", "--numstat", "-z", &mb];
    let (status, numstat, untracked) = tokio::join!(
        git(wt, &status_args),
        git(wt, &numstat_args),
        git(wt, &["ls-files", "--others", "--exclude-standard", "-z"]),
    );

    let mut files: Vec<ChangedFile> = Vec::new();
    let status = status?;
    let mut parts = status.split('\0').filter(|s| !s.is_empty());
    while let (Some(code), Some(path)) = (parts.next(), parts.next()) {
        files.push(ChangedFile {
            path: path.to_string(),
            status: code.chars().next().unwrap_or('M').to_string(),
            additions: None,
            deletions: None,
        });
    }
    for entry in numstat?.split('\0').filter(|s| !s.is_empty()) {
        let mut cols = entry.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (cols.next(), cols.next(), cols.next()) else {
            continue;
        };
        if let Some(f) = files.iter_mut().find(|f| f.path == path) {
            f.additions = a.parse().ok();
            f.deletions = d.parse().ok();
        }
    }
    for path in untracked?.split('\0').filter(|s| !s.is_empty()) {
        let lines = tokio::fs::read(wt.join(path))
            .await
            .ok()
            .filter(|b| !b.contains(&0))
            .map(|b| b.iter().filter(|c| **c == b'\n').count() as u32);
        files.push(ChangedFile {
            path: path.to_string(),
            status: "A".into(),
            additions: lines,
            deletions: lines.map(|_| 0),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

pub async fn file_diff(wt: &Path, base_branch: &str, path: &str) -> Result<String> {
    let mb = merge_base(wt, base_branch).await?;
    let tracked = git_ok(wt, &["ls-files", "--error-unmatch", "--", path]).await
        || git_ok(wt, &["cat-file", "-e", &format!("{mb}:{path}")]).await;
    if tracked {
        return git(wt, &["diff", "--no-renames", &mb, "--", path]).await;
    }
    // Untracked: diff against /dev/null. Exit code 1 means "differences found".
    let out = tokio_command("git")
        .args(["diff", "--no-index", "--", "/dev/null", path])
        .current_dir(wt)
        .output()
        .await?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn revert_file(wt: &Path, base_branch: &str, path: &str) -> Result<()> {
    let mb = merge_base(wt, base_branch).await?;
    if git_ok(wt, &["cat-file", "-e", &format!("{mb}:{path}")]).await {
        git(wt, &["checkout", &mb, "--", path]).await?;
    } else {
        let _ = git(wt, &["rm", "-f", "--cached", "--", path]).await;
        let _ = tokio::fs::remove_file(wt.join(path)).await;
    }
    Ok(())
}

pub async fn has_uncommitted(wt: &Path) -> Result<bool> {
    Ok(!git(wt, &["status", "--porcelain"]).await?.trim().is_empty())
}

pub async fn commit_all(wt: &Path, message: &str) -> Result<()> {
    git(wt, &["add", "-A"]).await?;
    git(wt, &["commit", "-m", message]).await?;
    Ok(())
}

pub async fn push(wt: &Path, branch: &str) -> Result<()> {
    git(wt, &["push", "-u", "origin", branch]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_repo(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]).await.unwrap();
        git(dir, &["config", "user.email", "t@t"]).await.unwrap();
        git(dir, &["config", "user.name", "t"]).await.unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(dir, &["add", "."]).await.unwrap();
        git(dir, &["commit", "-qm", "init"]).await.unwrap();
    }

    #[tokio::test]
    async fn worktree_changes_and_revert() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        init_repo(&repo).await;
        assert_eq!(default_branch(&repo).await, "main");

        let wt = tmp.path().join("wt");
        create_worktree(&repo, &wt, "runner/test", "main").await.unwrap();
        std::fs::write(wt.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(wt.join("b.txt"), "new\n").unwrap();

        let files = changed_files(&wt, "main").await.unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].additions, Some(1));
        assert_eq!(files[1].status, "A");

        assert!(file_diff(&wt, "main", "a.txt").await.unwrap().contains("+two"));
        assert!(file_diff(&wt, "main", "b.txt").await.unwrap().contains("+new"));

        revert_file(&wt, "main", "b.txt").await.unwrap();
        revert_file(&wt, "main", "a.txt").await.unwrap();
        assert!(changed_files(&wt, "main").await.unwrap().is_empty());

        remove_worktree(&repo, &wt).await.unwrap();
        assert!(!wt.exists());
    }
}
