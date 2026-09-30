//! cargo run -p suneiro-core --example pr -- <worktree> <branch>
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let d = suneiro_core::forge::pr_details(std::path::Path::new(&a[0]), &a[1]).await?;
    println!("repo={} title={:?} +{} -{} files={} draft={} merged={}", d["repo"], d["pull"]["title"], d["pull"]["additions"], d["pull"]["deletions"], d["pull"]["changed_files"], d["pull"]["draft"], d["pull"]["merged"]);
    println!("body_html: {} chars; comments={} reviews={} review_comments={} checks={}",
        d["pull"]["body_html"].as_str().map(str::len).unwrap_or(0),
        d["comments"].as_array().map(Vec::len).unwrap_or(0), d["reviews"].as_array().map(Vec::len).unwrap_or(0),
        d["reviewComments"].as_array().map(Vec::len).unwrap_or(0), d["checks"].as_array().map(Vec::len).unwrap_or(0));
    if let Some(src) = d["pull"]["body_html"].as_str().and_then(|h| h.split("<img").nth(1)).and_then(|t| t.split("src=\"").nth(1)).and_then(|t| t.split('"').next()) {
        let img = suneiro_core::forge::fetch_image(src).await?;
        println!("first image: {} -> {} ({} chars)", src, &img[..30], img.len());
    }
    Ok(())
}
