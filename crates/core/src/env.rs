//! GUI apps on macOS don't inherit the user's shell environment, so PATH lacks
//! things like asdf/nvm/homebrew. Capture the login shell env once and apply it
//! to every process we spawn (agents, git, gh, terminals, scripts).

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

static LOGIN_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

const MARKER: &str = "__SUNEIRO_ENV_START__";

pub fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

pub fn login_env() -> &'static HashMap<String, String> {
    LOGIN_ENV.get_or_init(|| capture().unwrap_or_else(|| std::env::vars().collect()))
}

fn capture() -> Option<HashMap<String, String>> {
    let shell = user_shell();
    let mut child = std::process::Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARKER}'; env -0")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Guard against shell rc files that hang.
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let out = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let body = &text[text.find(MARKER)? + MARKER.len()..];
    let env: HashMap<String, String> = body
        .split('\0')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    env.contains_key("PATH").then_some(env)
}

pub fn tokio_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.env_clear().envs(login_env());
    cmd
}

pub fn std_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    cmd.env_clear().envs(login_env());
    cmd
}
