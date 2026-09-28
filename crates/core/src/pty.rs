use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::env::{login_env, user_shell};

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    map: Mutex<HashMap<String, Terminal>>,
}

impl Terminals {
    /// Spawn a login shell (or `command` inside one) in `cwd`. Output is pushed
    /// to `on_output` from a reader thread; `on_exit` fires once the pty closes.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        command: Option<&str>,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<()> {
        let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        let shell = user_shell();
        let mut cmd = CommandBuilder::new(&shell);
        match command {
            Some(c) => cmd.args(["-lic", c]),
            None => cmd.arg("-l"),
        }
        cmd.cwd(cwd);
        cmd.env_clear();
        for (k, v) in login_env() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        std::thread::Builder::new().name(format!("pty-{id}")).spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                }
            }
            on_exit();
        })?;

        self.map.lock().insert(id.to_string(), Terminal { master: pair.master, writer, child });
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let mut map = self.map.lock();
        let t = map.get_mut(id).ok_or_else(|| anyhow!("terminal not found"))?;
        t.writer.write_all(data)?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let map = self.map.lock();
        let t = map.get(id).ok_or_else(|| anyhow!("terminal not found"))?;
        t.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        Ok(())
    }

    pub fn kill(&self, id: &str) {
        if let Some(mut t) = self.map.lock().remove(id) {
            let _ = t.child.kill();
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self.map.lock().keys().cloned().collect();
        for id in ids {
            self.kill(&id);
        }
    }
}
