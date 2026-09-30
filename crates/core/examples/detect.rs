//! Print what Suneiro detects about locally installed agents.
#[tokio::main]
async fn main() {
    for id in ["claude", "codex", "opencode"] {
        println!("{:#?}", suneiro_core::setup::detect(id).await);
    }
}
