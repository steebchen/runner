//! Per-repo configuration (`runner.json`) and workspace naming.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Scripts {
    /// Runs once in a new worktree (install deps, etc.).
    pub setup: Option<String>,
    /// Started from the "Run" button in a terminal (dev server, etc.).
    pub run: Option<String>,
    /// Runs before a worktree is removed.
    pub archive: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct RepoConfig {
    pub scripts: Scripts,
    /// Gitignored files to copy from the main checkout into new worktrees (e.g. `.env`).
    pub copy: Vec<String>,
}

pub fn load_config(repo_path: &Path) -> RepoConfig {
    std::fs::read_to_string(repo_path.join("runner.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

const NAMES: &[&str] = &[
    "amsterdam", "athens", "austin", "bangkok", "barcelona", "berlin", "bogota", "boston",
    "cairo", "chicago", "copenhagen", "dakar", "denver", "dublin", "florence", "geneva",
    "hanoi", "havana", "helsinki", "istanbul", "jakarta", "kyoto", "lagos", "lima", "lisbon",
    "london", "madrid", "manila", "marseille", "melbourne", "miami", "milan", "montreal",
    "mumbai", "munich", "nairobi", "naples", "oslo", "paris", "porto", "prague", "quito",
    "reykjavik", "riga", "rome", "santiago", "seoul", "seville", "sofia", "stockholm",
    "sydney", "taipei", "tallinn", "tokyo", "toronto", "tunis", "valencia", "vienna",
    "vilnius", "warsaw", "zagreb", "zurich",
];

/// A branch-name-friendly slug of a task title: "Fix login bug" -> "fix-login-bug".
/// `None` for titles too vague to name a branch after (a single word).
pub fn branch_slug(title: &str) -> Option<String> {
    let words: Vec<String> = title
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_ascii_lowercase())
        .collect();
    if words.len() < 2 {
        return None;
    }
    let mut slug = String::new();
    for w in words {
        if !slug.is_empty() && slug.len() + 1 + w.len() > 40 {
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&w);
    }
    Some(slug)
}

/// Pick a city name not used by this repo yet, adding a suffix once all are taken.
pub fn pick_name(taken: &[String], seed: u64) -> String {
    let start = (seed as usize) % NAMES.len();
    for round in 0.. {
        for i in 0..NAMES.len() {
            let base = NAMES[(start + i) % NAMES.len()];
            let name = if round == 0 { base.to_string() } else { format!("{base}-{}", round + 1) };
            if !taken.contains(&name) {
                return name;
            }
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_unused_names() {
        let taken: Vec<String> = NAMES.iter().map(|s| s.to_string()).collect();
        assert!(pick_name(&taken, 0).ends_with("-2"));
        assert_eq!(pick_name(&[], 0), NAMES[0]);
    }

    #[test]
    fn slugs_titles_for_branches() {
        assert_eq!(branch_slug("Fix login bug").as_deref(), Some("fix-login-bug"));
        assert_eq!(branch_slug("Add café/dark-mode (v2)!").as_deref(), Some("add-caf-dark-mode-v2"));
        assert_eq!(branch_slug("Question"), None);
        let long = branch_slug("Refactor the authentication middleware to support multiple providers").unwrap();
        assert!(long.len() <= 40 && !long.ends_with('-'), "{long}");
    }

    #[test]
    fn parses_config() {
        let c: RepoConfig =
            serde_json::from_str(r#"{"scripts":{"setup":"pnpm i"},"copy":[".env"]}"#).unwrap();
        assert_eq!(c.scripts.setup.as_deref(), Some("pnpm i"));
        assert_eq!(c.copy, vec![".env"]);
    }
}
