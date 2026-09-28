//! cargo run -p runner-core --example title -- "your prompt"
#[tokio::main]
async fn main() {
    let text = std::env::args().nth(1).unwrap_or_else(|| "can you please add dark mode support to the settings page and persist it".into());
    println!("quick: {}", runner_core::title::quick_title(&text));
    let t = std::time::Instant::now();
    println!("haiku: {:?} ({:.1}s)", runner_core::title::summarize(&text).await, t.elapsed().as_secs_f32());
}
