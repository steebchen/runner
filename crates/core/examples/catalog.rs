//! cargo run -p suneiro-core --example catalog: discover each agent's models.
#[tokio::main]
async fn main() {
    for def in suneiro_core::builtin_agents() {
        let t = std::time::Instant::now();
        match suneiro_core::catalog::discover(&def).await {
            Ok(c) => println!(
                "{}: {} models (e.g. {:?}), efforts {:?}, fast={} ({:.1}s)",
                def.id,
                c.models.len(),
                c.models.iter().take(4).map(|m| &m.name).collect::<Vec<_>>(),
                c.efforts.iter().map(|e| &e.value).collect::<Vec<_>>(),
                c.has_fast,
                t.elapsed().as_secs_f32()
            ),
            Err(e) => println!("{}: error {e:#}", def.id),
        }
    }
}
