//! Short titles for sessions and workspaces ("Add rate limiting"). A heuristic
//! title is shown instantly; a Haiku summary via the user's Claude login
//! replaces it a few seconds later when available.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::env::tokio_command;

const FILLER: &[&str] = &[
    "please", "can", "could", "would", "you", "we", "i", "want", "to", "need", "let's", "lets",
    "hey", "hi", "so", "ok", "okay", "the", "a", "an",
];

/// Instant fallback: first few meaningful words of the first line.
pub fn quick_title(text: &str) -> String {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let words: Vec<&str> = line.split_whitespace().collect();
    let start = words
        .iter()
        .position(|w| !FILLER.contains(&w.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric() && c != '\'')))
        .unwrap_or(0);
    let mut picked: Vec<&str> = words[start..].iter().take(5).copied().collect();
    const DANGLING: &[&str] = &["to", "the", "a", "an", "and", "of", "for", "in", "on", "with", "our", "my", "that"];
    while picked.len() > 1 && picked.last().is_some_and(|w| DANGLING.contains(&w.to_lowercase().as_str())) {
        picked.pop();
    }
    let mut title = picked.join(" ");
    title = title.trim_end_matches(|c: char| !c.is_alphanumeric()).to_string();
    capitalize(&title)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Replies that are commentary rather than a title.
fn looks_like_commentary(line: &str) -> bool {
    let l = line.to_lowercase();
    ["this isn't", "this is not", "i can't", "i cannot", "i'm ", "i am ", "sorry", "not a coding", "as an ai", "here is", "here's"]
        .iter()
        .any(|p| l.starts_with(p) || l.contains("coding task"))
        || line.split_whitespace().count() > 6
        || line.contains('—')
}

fn clean(summary: &str) -> Option<String> {
    let line = summary.lines().map(str::trim).find(|l| !l.is_empty())?;
    if looks_like_commentary(line) {
        return None;
    }
    let line = line.trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c == '*' || c == '.');
    let line = line.strip_prefix("Title:").unwrap_or(line).trim();
    let words: Vec<&str> = line.split_whitespace().take(6).collect();
    let title = capitalize(&words.join(" "));
    (!title.is_empty() && title.len() <= 60).then_some(title)
}

/// Ask Claude Haiku for a 2–4 word title. `None` if Claude isn't installed,
/// isn't signed in, or takes too long.
pub async fn summarize(text: &str) -> Option<String> {
    if std::env::var_os("RUNNER_NO_AI_TITLES").is_some() {
        return None;
    }
    let excerpt: String = text.chars().take(2000).collect();
    let prompt = format!(
        "Write a 2-4 word title for this message, for a sidebar list of tasks.\n\
         - A coding task: imperative form, like \"Add dark mode\" or \"Fix login bug\".\n\
         - A question or anything else: name its topic, like \"Question about billing\" or \"Explain auth flow\".\n\
         - If there's nothing to summarize: \"Question\".\n\
         Never comment on or refuse the message. No punctuation. Reply with the title only.\n\nMessage:\n{excerpt}"
    );
    let mut child = tokio_command("claude")
        .args([
            "-p",
            "--model",
            "haiku",
            "--no-session-persistence",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--tools",
            "",
        ])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    stdin.write_all(prompt.as_bytes()).await.ok()?;
    drop(stdin);
    let out = tokio::time::timeout(Duration::from_secs(25), child.wait_with_output()).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    clean(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_titles() {
        assert_eq!(quick_title("can you please add rate limiting to the api endpoints"), "Add rate limiting");
        assert_eq!(quick_title("add dark mode support to the settings page"), "Add dark mode support");
        assert_eq!(quick_title("\n\nfix the bug."), "Fix the bug");
        assert_eq!(quick_title(""), "");
    }

    #[test]
    fn cleans_summaries() {
        assert_eq!(clean("\"Add API rate limiting.\"\n").as_deref(), Some("Add API rate limiting"));
        assert_eq!(clean("Title: fix flaky test").as_deref(), Some("Fix flaky test"));
        assert_eq!(clean("   "), None);
        assert_eq!(clean("This isn't a coding task — it's a question"), None);
        assert_eq!(clean("Sorry, I can't title that"), None);
        assert_eq!(clean("Question about billing").as_deref(), Some("Question about billing"));
    }
}
