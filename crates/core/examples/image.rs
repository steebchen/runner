//! cargo run -p suneiro-core --example image -- <repo> <agent>
//! Attaches a generated image (a solid red square) and asks what color it is.
//! With a third argument `--image-only`, sends the image without any text.
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use parking_lot::Mutex;
use suneiro_core::{Core, Event};

/// A 64x64 solid red PNG, uncompressed (stored deflate blocks).
fn red_png() -> Vec<u8> {
    fn crc(data: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend(data);
        out.extend(&body);
        out.extend(crc(&body).to_be_bytes());
    }
    let (w, h) = (64u32, 64u32);
    // Each row: filter byte 0, then RGB pixels.
    let row: Vec<u8> = std::iter::once(0).chain((0..w).flat_map(|_| [255, 0, 0])).collect();
    let raw = row.repeat(h as usize);
    let (mut a, mut b) = (1u32, 0u32);
    for &x in &raw {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    let mut z = vec![0x78, 0x01];
    for (i, block) in raw.chunks(65535).enumerate() {
        let last = (i + 1) * 65535 >= raw.len();
        z.push(last as u8);
        z.extend((block.len() as u16).to_le_bytes());
        z.extend((!(block.len() as u16)).to_le_bytes());
        z.extend(block);
    }
    z.extend(((b << 16) | a).to_be_bytes());
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend(w.to_be_bytes());
    ihdr.extend(h.to_be_bytes());
    ihdr.extend([8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    chunk(&mut png, b"IDAT", &z);
    chunk(&mut png, b"IEND", &[]);
    png
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    std::env::set_var("SUNEIRO_NO_AI_TITLES", "1");
    let a: Vec<String> = std::env::args().skip(1).collect();
    let data = tempfile::tempdir()?;
    let events: Arc<Mutex<Vec<Event>>> = Arc::default();
    let sink = events.clone();
    let core = Core::new(data.path(), Arc::new(move |e| sink.lock().push(e)))?;
    let mut settings = core.settings();
    settings.workspaces_root = data.path().join("ws").to_string_lossy().into();
    core.save_settings(&settings)?;
    let repo = core.add_repo(&a[0]).await?;
    let ws = core.create_workspace(&repo.id).await?;
    let sid = core.create_session(&ws.id, &a[1], None, None)?.id;
    let image = core.save_attachment("image/png", &base64::engine::general_purpose::STANDARD.encode(red_png()))?;
    let text = if a.get(2).map(String::as_str) == Some("--image-only") {
        String::new()
    } else {
        "What color is the attached image? Reply with one word, without using any tools.".into()
    };
    core.agents.prompt_with(&sid, text, vec![image])?;
    let mut text = String::new();
    for _ in 0..1200 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let batch = std::mem::take(&mut *events.lock());
        for e in batch {
            match e {
                Event::SessionUpdate { update, .. } if update["sessionUpdate"] == "agent_message_chunk" => {
                    text.push_str(update["content"]["text"].as_str().unwrap_or(""));
                }
                Event::SessionState { state, error: Some(err), .. } if state == "error" => anyhow::bail!("agent error: {err}"),
                Event::TurnEnd { stop_reason, .. } => {
                    println!("turn ended ({stop_reason})\nREPLY: {}", text.trim());
                    core.archive_workspace(&ws.id).await?;
                    core.shutdown();
                    return Ok(());
                }
                _ => {}
            }
        }
    }
    anyhow::bail!("timed out")
}
