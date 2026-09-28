//! GitHub integration through the `gh` CLI, reusing the user's existing login.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::Value;

use crate::env::tokio_command;

async fn gh(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = tokio_command("gh")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .context("failed to run gh (is the GitHub CLI installed?)")?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// PR for the branch, or `None` if there isn't one yet.
pub async fn pr_status(wt: &Path, branch: &str) -> Result<Option<Value>> {
    let fields = "number,url,state,title,isDraft,mergeable,mergeStateStatus,statusCheckRollup";
    match gh(wt, &["pr", "view", branch, "--json", fields]).await {
        Ok(out) => Ok(Some(serde_json::from_str(&out)?)),
        Err(e) if e.to_string().contains("no pull requests found") => Ok(None),
        Err(e) => Err(e),
    }
}

pub async fn create_pr(wt: &Path, base: &str, title: &str, body: &str) -> Result<String> {
    let out = gh(wt, &["pr", "create", "--base", base, "--title", title, "--body", body]).await?;
    Ok(out.lines().last().unwrap_or("").trim().to_string())
}

pub async fn merge_pr(wt: &Path, branch: &str) -> Result<()> {
    gh(wt, &["pr", "merge", branch, "--squash"]).await?;
    Ok(())
}
