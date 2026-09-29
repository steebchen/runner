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

pub const PR_FIELDS: &str =
    "number,url,state,title,isDraft,mergeable,mergeStateStatus,statusCheckRollup,headRefName";

/// Recent PRs of a repo (all states), newest first. One call covers every
/// workspace branch of the repo.
pub async fn list_prs(repo: &Path) -> Result<Vec<Value>> {
    let out = gh(repo, &["pr", "list", "--state", "all", "--limit", "200", "--json", PR_FIELDS]).await?;
    Ok(serde_json::from_str(&out)?)
}

/// PR for the branch, or `None` if there isn't one yet.
pub async fn pr_status(wt: &Path, branch: &str) -> Result<Option<Value>> {
    match gh(wt, &["pr", "view", branch, "--json", PR_FIELDS]).await {
        Ok(out) => Ok(Some(serde_json::from_str(&out)?)),
        Err(e) if e.to_string().contains("no pull requests found") => Ok(None),
        Err(e) => Err(e),
    }
}

/// `owner/repo` and number from a PR URL like https://github.com/o/r/pull/12.
fn parse_pr_url(url: &str) -> Option<(String, u64)> {
    let rest = url.split("github.com/").nth(1)?;
    let parts: Vec<&str> = rest.split('/').collect();
    let number = parts.get(3)?.parse().ok()?;
    Some((format!("{}/{}", parts.first()?, parts.get(1)?), number))
}

async fn api(cwd: &Path, path: &str) -> Result<Value> {
    // "full" media type: bodies come pre-rendered as body_html, with images
    // on private repos rewritten to short-lived signed URLs.
    let out = gh(cwd, &["api", path, "-H", "Accept: application/vnd.github.full+json"]).await?;
    Ok(serde_json::from_str(&out)?)
}

/// Everything the PR view needs: the PR (with rendered description), its
/// conversation (comments, reviews, inline review comments) and checks.
pub async fn pr_details(wt: &Path, branch: &str) -> Result<Value> {
    let summary = pr_status(wt, branch).await?.ok_or_else(|| anyhow::anyhow!("no pull request for this branch"))?;
    let url = summary["url"].as_str().unwrap_or_default();
    let (repo, n) = parse_pr_url(url).ok_or_else(|| anyhow::anyhow!("unexpected PR URL {url}"))?;
    let paths = [
        format!("repos/{repo}/pulls/{n}"),
        format!("repos/{repo}/issues/{n}/comments?per_page=100"),
        format!("repos/{repo}/pulls/{n}/reviews?per_page=100"),
        format!("repos/{repo}/pulls/{n}/comments?per_page=100"),
    ];
    let (pull, comments, reviews, review_comments) =
        tokio::join!(api(wt, &paths[0]), api(wt, &paths[1]), api(wt, &paths[2]), api(wt, &paths[3]));
    Ok(serde_json::json!({
        "repo": repo,
        "pull": pull?,
        "comments": comments.unwrap_or_default(),
        "reviews": reviews.unwrap_or_default(),
        "reviewComments": review_comments.unwrap_or_default(),
        "checks": summary["statusCheckRollup"],
    }))
}

/// Fetch an image as a data URL, authenticated with the user's GitHub token
/// for GitHub hosts (needed for images in private repositories).
pub async fn fetch_image(url: &str) -> Result<String> {
    use base64::Engine;
    let host = url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or("");
    let github = host == "github.com" || host.ends_with(".githubusercontent.com");
    let mut cmd = tokio_command("curl");
    cmd.args(["-sSfL", "--max-time", "30", "-w", "\n%{content_type}"]);
    if github {
        let token = tokio_command("gh").args(["auth", "token"]).output().await?;
        let token = String::from_utf8_lossy(&token.stdout).trim().to_string();
        if !token.is_empty() {
            cmd.args(["-H", &format!("Authorization: token {token}")]);
        }
    }
    let out = cmd.arg(url).output().await?;
    if !out.status.success() {
        bail!("couldn't load image ({})", String::from_utf8_lossy(&out.stderr).trim());
    }
    // Body, then "\n<content-type>" appended by -w.
    let split = out.stdout.iter().rposition(|b| *b == b'\n').unwrap_or(out.stdout.len());
    let (body, ctype) = out.stdout.split_at(split);
    let ctype = String::from_utf8_lossy(ctype).trim().split(';').next().unwrap_or("").to_string();
    let ctype = if ctype.starts_with("image/") { ctype } else { "image/png".into() };
    Ok(format!("data:{ctype};base64,{}", base64::engine::general_purpose::STANDARD.encode(body)))
}

pub async fn create_pr(wt: &Path, base: &str, title: &str, body: &str) -> Result<String> {
    let out = gh(wt, &["pr", "create", "--base", base, "--title", title, "--body", body]).await?;
    Ok(out.lines().last().unwrap_or("").trim().to_string())
}

pub async fn merge_pr(wt: &Path, branch: &str) -> Result<()> {
    gh(wt, &["pr", "merge", branch, "--squash"]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pr_urls() {
        assert_eq!(parse_pr_url("https://github.com/o/r/pull/12"), Some(("o/r".into(), 12)));
        assert_eq!(parse_pr_url("https://example.com/x"), None);
    }
}
