import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Play, Plus, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api } from "../lib/api";
import { toast } from "../lib/store";
import { followTheme, xtermTheme } from "../lib/xtermTheme";

type Entry = {
  id: string;
  workspaceId: string;
  title: string;
  command: string | null;
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  started: boolean;
  exited: boolean;
  unfollow: () => void;
};

// Terminals live outside React so switching workspaces or tabs only moves a
// DOM node instead of recreating xterm and losing scrollback.
const registry = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function createEntry(workspaceId: string, title: string, command: string | null): Entry {
  const id = `${workspaceId}:${crypto.randomUUID()}`;
  const term = new Terminal({
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    theme: xtermTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const unfollow = followTheme(term);
  const el = document.createElement("div");
  el.style.height = "100%";
  const entry: Entry = { id, workspaceId, title, command, term, fit, el, started: false, exited: false, unfollow };
  term.onData((d) => void api.terminalWrite(id, d).catch(() => {}));
  term.onResize(({ cols, rows }) => entry.started && void api.terminalResize(id, cols, rows).catch(() => {}));
  registry.set(id, entry);
  notify();
  return entry;
}

function start(entry: Entry) {
  if (entry.started) return;
  entry.term.open(entry.el);
  entry.fit.fit();
  entry.started = true;
  api
    .terminalOpen(
      entry.workspaceId,
      entry.id,
      entry.term.cols,
      entry.term.rows,
      entry.command,
      (data) => entry.term.write(data),
      () => {
        entry.exited = true;
        entry.term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
        notify();
      },
    )
    .catch((e) => entry.term.write(`\x1b[31m${e}\x1b[0m\r\n`));
}

function close(entry: Entry) {
  void api.terminalKill(entry.id).catch(() => {});
  entry.unfollow();
  entry.term.dispose();
  registry.delete(entry.id);
  notify();
}

export function TerminalPanel({ workspaceId, visible }: { workspaceId: string; visible: boolean }) {
  useSyncExternalStore(subscribe, () => version);
  const entries = [...registry.values()].filter((e) => e.workspaceId === workspaceId);
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);
  const active = entries.find((e) => e.id === activeId) ?? entries[entries.length - 1];
  const hostRef = useRef<HTMLDivElement>(null);
  const [runScript, setRunScript] = useState<string | null>(null);

  useEffect(() => {
    api
      .repoConfig(workspaceId)
      .then((c) => setRunScript(c.scripts.run ?? null))
      .catch(() => {});
  }, [workspaceId]);

  // Open a first shell lazily when the terminal tab is first shown.
  useEffect(() => {
    if (visible && entries.length === 0) setActiveId(createEntry(workspaceId, "zsh", null).id);
  }, [visible, entries.length, workspaceId]);

  // Attach the active terminal's element to the host and keep it fitted.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active || !visible) return;
    host.replaceChildren(active.el);
    start(active);
    const fit = () => {
      try {
        active.fit.fit();
      } catch {}
    };
    requestAnimationFrame(fit);
    active.term.focus();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [active, visible]);

  const run = () => {
    if (!runScript) return toast("Set a run script in Settings → Repositories (or runner.json) to use Run", "info");
    setActiveId(createEntry(workspaceId, "run", runScript).id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        {entries.map((e) => (
          <div
            key={e.id}
            onClick={() => setActiveId(e.id)}
            className={clsx(
              "group flex items-center gap-1 rounded px-2 py-0.5 text-xs",
              e === active ? "bg-hover text-fg" : "text-muted hover:text-fg",
              e.exited && "opacity-60",
            )}
          >
            {e.title}
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                close(e);
              }}
              className="invisible rounded hover:bg-bg group-hover:visible"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button onClick={() => setActiveId(createEntry(workspaceId, "zsh", null).id)} title="New terminal" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
          <Plus size={12} />
        </button>
        <div className="flex-1" />
        <button
          onClick={run}
          title={runScript ?? "No run script configured"}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
        >
          <Play size={11} /> Run
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-bg pt-2 pl-2.5" />
    </div>
  );
}
