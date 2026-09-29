//! Images attached to prompts. They're copied into the app's data folder so
//! the transcript can still show them after the original file is gone.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Result};
use base64::Engine;

const MAX_BYTES: usize = 20 * 1024 * 1024;

pub fn mime_type(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn extension(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return None,
    })
}

fn new_path(dir: &Path, ext: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    Ok(dir.join(format!("{}.{ext}", uuid::Uuid::new_v4())))
}

/// Store base64 image data (e.g. pasted from the clipboard). Returns its path.
pub fn save(dir: &Path, mime: &str, data: &str) -> Result<String> {
    let ext = extension(mime).ok_or_else(|| anyhow!("only PNG, JPEG, GIF and WebP images can be attached"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim())?;
    if bytes.len() > MAX_BYTES {
        bail!("image is larger than 20 MB");
    }
    let path = new_path(dir, ext)?;
    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Copy an image file into the attachments folder. Returns the copy's path.
pub fn import(dir: &Path, src: &str) -> Result<String> {
    let ext = extension(mime_type(src)).ok_or_else(|| anyhow!("only PNG, JPEG, GIF and WebP images can be attached"))?;
    if std::fs::metadata(src)?.len() as usize > MAX_BYTES {
        bail!("image is larger than 20 MB");
    }
    let path = new_path(dir, ext)?;
    std::fs::copy(src, &path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// A stored attachment as a data URL, for display. Only files inside the
/// attachments folder can be read this way.
pub fn data_url(dir: &Path, path: &str) -> Result<String> {
    let file = std::fs::canonicalize(path)?;
    if !file.starts_with(std::fs::canonicalize(dir)?) {
        bail!("not an attachment");
    }
    let bytes = std::fs::read(&file)?;
    Ok(format!("data:{};base64,{}", mime_type(path), base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_imports_and_reads_back() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("attachments");
        let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG fake");
        let saved = save(&dir, "image/png", &png).unwrap();
        assert!(saved.ends_with(".png"));
        assert_eq!(data_url(&dir, &saved).unwrap(), format!("data:image/png;base64,{png}"));
        assert!(save(&dir, "text/plain", &png).is_err());

        let outside = tmp.path().join("shot.JPG");
        std::fs::write(&outside, b"jpeg").unwrap();
        assert!(data_url(&dir, &outside.to_string_lossy()).is_err(), "only attachments are readable");
        let copy = import(&dir, &outside.to_string_lossy()).unwrap();
        assert!(copy.ends_with(".jpg") && data_url(&dir, &copy).unwrap().starts_with("data:image/jpeg;base64,"));
    }
}
