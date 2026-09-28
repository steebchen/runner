//! Print what Runner detects about locally installed agents.
#[tokio::main]
async fn main() {
    for id in ["claude", "codex", "opencode"] {
        println!("{:#?}", runner_core::setup::detect(id).await);
    }
}
