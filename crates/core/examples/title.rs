//! cargo run -p suneiro-core --example title -- "your prompt"
//! cargo run -p suneiro-core --example title -- --pr <worktree> [base]   # PR text + commit message
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--pr") {
        let wt = std::path::PathBuf::from(args.get(1).expect("worktree path"));
        let base = args.get(2).map(String::as_str).unwrap_or("main");
        let t = std::time::Instant::now();
        let summary = suneiro_core::git::branch_summary(&wt, base).await.expect("branch summary");
        println!("PR: {:#?} ({:.1}s)", suneiro_core::title::pr_text(&summary).await, t.elapsed().as_secs_f32());
        let t = std::time::Instant::now();
        let summary = suneiro_core::git::uncommitted_summary(&wt).await.expect("uncommitted summary");
        println!("commit: {:?} ({:.1}s)", suneiro_core::title::commit_message(&summary).await, t.elapsed().as_secs_f32());
        return;
    }
    let text = args.first().cloned().unwrap_or_else(|| "can you please add dark mode support to the settings page and persist it".into());
    println!("quick: {}", suneiro_core::title::quick_title(&text));
    let t = std::time::Instant::now();
    println!("haiku: {:?} ({:.1}s)", suneiro_core::title::summarize(&text).await, t.elapsed().as_secs_f32());
}
