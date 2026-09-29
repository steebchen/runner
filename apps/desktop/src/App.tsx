import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { FolderPlus } from "lucide-react";
import { actions, startBadgeSync, toast, useStore } from "./lib/store";
import { CommandPalette } from "./components/CommandPalette";
import { AddRepoMenu } from "./components/AddRepoMenu";
import { api } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { Toast } from "./components/Toast";
import { AgentSetup, Settings } from "./components/Settings";
import { Home } from "./components/Home";
import { Insights } from "./components/Insights";

export async function pickRepo() {
  const path = await open({ directory: true, title: "Choose a git repository" });
  if (typeof path === "string") await actions.addRepo(path);
}

/** Handle a command from the native menu or a keyboard shortcut. */
function runCommand(id: string, setPalette: (open: boolean | ((o: boolean) => boolean)) => void) {
  const s = useStore.getState();
  const ws = s.workspaces.find((w) => w.id === s.selectedWorkspace);
  switch (id) {
    case "settings":
      return actions.openSettings(true);
    case "palette":
      return setPalette((o) => !o);
    case "new-workspace": {
      const repoId = ws?.repoId ?? s.repos[0]?.id;
      if (repoId) void actions.createWorkspace(repoId);
      return;
    }
    case "new-chat": {
      if (!ws || s.page !== "workspace") return;
      const first = s.settings?.loadout[0];
      void actions.createSession(ws.id, first?.agent ?? "claude", first?.model, first?.effort);
      return;
    }
    case "close-chat": {
      const sid = ws && s.selectedSession[ws.id];
      if (ws && sid && s.page === "workspace") void actions.closeSession(ws.id, sid);
      return;
    }
  }
}

/** ⌘⇧[ / ⌘⇧]: previous / next chat in the current workspace. */
function cycleChat(dir: number) {
  const s = useStore.getState();
  const ws = s.selectedWorkspace;
  const list = ws ? (s.sessions[ws] ?? []) : [];
  if (!ws || list.length < 2) return;
  const i = list.findIndex((x) => x.id === s.selectedSession[ws]);
  const next = list[(i + dir + list.length) % list.length];
  actions.selectSession(ws, next.id);
}

export function App() {
  const ready = useStore((s) => s.ready);
  const selected = useStore((s) => s.selectedWorkspace);
  const hasRepos = useStore((s) => s.repos.length > 0);
  const page = useStore((s) => s.page);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    void actions.init();
    startBadgeSync();
    // Native menu items (Settings…, New Chat, Close Chat, …).
    let unlisten: (() => void) | undefined;
    listen<string>("menu", (e) => runCommand(e.payload, setPalette))
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const s = useStore.getState();
      const shortcut: Record<string, string> = { ",": "settings", k: "palette", t: "new-chat", w: "close-chat" };
      if (!e.shiftKey && shortcut[e.key]) {
        e.preventDefault();
        runCommand(shortcut[e.key], setPalette);
      } else if (e.shiftKey && (e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}")) {
        e.preventDefault();
        cycleChat(e.key === "[" || e.key === "{" ? -1 : 1);
      } else if (e.key === "o" && !e.shiftKey) {
        const ws = s.workspaces.find((w) => w.id === s.selectedWorkspace);
        if (ws && s.page === "workspace") {
          e.preventDefault();
          void api.openPath(ws.path, s.settings?.editor || undefined).catch((err) => toast(String(err)));
        }
      } else if (e.key >= "1" && e.key <= "9") {
        const ws = s.workspaces[Number(e.key) - 1];
        if (ws) {
          e.preventDefault();
          actions.selectWorkspace(ws.id);
        }
      } else if (e.key === "n" && !e.shiftKey) {
        const ws = s.workspaces.find((w) => w.id === s.selectedWorkspace);
        const repoId = ws?.repoId ?? s.repos[0]?.id;
        if (repoId) {
          e.preventDefault();
          void actions.createWorkspace(repoId);
        }
      } else if (e.key === "o" && e.shiftKey) {
        e.preventDefault();
        void pickRepo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="h-full" data-tauri-drag-region />;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {page === "settings" ? (
          <Settings />
        ) : page === "home" ? (
          <Home />
        ) : page === "insights" ? (
          <Insights />
        ) : selected ? (
          <WorkspaceView key={selected} workspaceId={selected} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" data-tauri-drag-region>
            <div className="text-lg font-medium">{hasRepos ? "No workspace selected" : "Welcome to Runner"}</div>
            <div className="max-w-sm text-center text-muted">
              Run Claude Code, Codex and OpenCode in parallel, each in its own git worktree.
            </div>
            <AddRepoMenu
              align="center"
              trigger={(open) => (
                <button onClick={open} className="mt-2 flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg">
                  <FolderPlus size={14} /> Add repository
                </button>
              )}
            />
            {!hasRepos && (
              <div className="mt-8 w-full max-w-lg">
                <div className="mb-2 text-xs font-medium text-muted">Your agents</div>
                <AgentSetup compact />
              </div>
            )}
          </div>
        )}
      </main>
      <Toast />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
