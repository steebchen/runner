//! cargo run -p suneiro-core --example recent: what "Recents" would show.
fn main() {
    let t = std::time::Instant::now();
    for p in suneiro_core::recent::recent_projects(&[], 8) {
        println!("{} ({})", p.path, p.name);
    }
    println!("({:.0} ms)", t.elapsed().as_secs_f64() * 1000.0);
}
