import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Archive, ExternalLink, GitBranch, PanelRight, Plus, X } from "lucide-react";
import { actions, enabledAgents, toast, useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { api, type Session } from "../lib/api";
import { Chat } from "./Chat";
import { ChangesPanel } from "./ChangesPanel";
import { TerminalPanel } from "./TerminalPanel";
import { PrActions } from "./PrActions";
import { Menu } from "./Menu";

type Tab = "changes" | "terminal" | "setup";

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const sessionId = useStore((s) => s.selectedSession[workspaceId]);
  const hasSetupLog = useStore((s) => !!s.scriptLog[workspaceId]);
  const editor = useStore((s) => s.settings?.editor);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState<Tab>("changes");

  useEffect(() => {
    if (sessionId) actions.selectSession(workspaceId, sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (!ws) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3" data-tauri-drag-region>
        <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
          <span className="font-medium">{ws.name}</span>
          <span className="flex items-center gap-1 truncate text-xs text-muted" data-tauri-drag-region>
            <GitBranch size={11} /> {ws.branch} → {ws.baseBranch}
          </span>
        </div>
        <div className="flex-1" data-tauri-drag-region />
        <PrActions workspace={ws} sessionId={sessionId} />
        <Menu
          label={
            <span className="flex items-center gap-1">
              <ExternalLink size={13} /> Open
            </span>
          }
          items={[
            ...(editor ? [{ label: `${editor}  ⌘O`, onSelect: () => api.openPath(ws.path, editor).catch((e) => toast(String(e))) }] : []),
            { label: "Finder", onSelect: () => api.openPath(ws.path) },
            { label: "Terminal", onSelect: () => api.openPath(ws.path, "Terminal") },
          ]}
        />
        <button
          title="Archive workspace (removes the worktree, keeps the branch)"
          onClick={() => actions.archiveWorkspace(ws.id)}
          className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <Archive size={14} />
        </button>
        <button
          title="Toggle panel"
          onClick={() => setPanel((p) => !p)}
          className={clsx("rounded p-1.5 hover:bg-hover", panel ? "text-fg" : "text-muted")}
        >
          <PanelRight size={14} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <SessionTabs workspaceId={ws.id} activeId={sessionId} />
          {sessionId ? (
            <Chat key={sessionId} sessionId={sessionId} workspaceId={ws.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted">Start a chat with an agent using +</div>
          )}
        </section>
        {panel && (
          <section className="flex w-[44%] max-w-[760px] min-w-[360px] flex-col border-l border-border bg-panel">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
              {(["changes", "terminal", ...(hasSetupLog ? ["setup"] : [])] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={clsx(
                    "rounded px-2 py-1 text-xs capitalize",
                    tab === t ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className={clsx("min-h-0 flex-1", tab !== "changes" && "hidden")}>
              <ChangesPanel workspaceId={ws.id} sessionId={sessionId} />
            </div>
            {/* Terminals stay mounted so switching tabs never loses scrollback. */}
            <div className={clsx("min-h-0 flex-1", tab !== "terminal" && "hidden")}>
              <TerminalPanel workspaceId={ws.id} visible={tab === "terminal"} />
            </div>
            {tab === "setup" && <SetupLog workspaceId={ws.id} />}
          </section>
        )}
      </div>
    </div>
  );
}

function SessionTabs({ workspaceId, activeId }: { workspaceId: string; activeId?: string }) {
  const sessions = useStore((s) => s.sessions[workspaceId]) ?? [];
  const agents = useStore((s) => s.agents);
  const menuAgents = useStore(useShallow(enabledAgents));
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-2">
      {sessions.map((x) => (
        <SessionTab
          key={x.id}
          session={x}
          agentName={agents.find((a) => a.id === x.agentId)?.name ?? x.agentId}
          active={x.id === activeId}
        />
      ))}
      <Menu
        label={<Plus size={13} />}
        align="left"
        items={menuAgents.map((a) => ({ label: a.name, onSelect: () => actions.createSession(workspaceId, a.id) }))}
      />
    </div>
  );
}

function SessionTab({ session, agentName, active }: { session: Session; agentName: string; active: boolean }) {
  const dot = useStore((s) => {
    const v = s.views[session.id];
    if (v?.permissions.length) return "bg-warn";
    if (v?.state === "running") return "pulse bg-accent";
    if (v?.state === "error") return "bg-del-fg";
    return v?.unread ? "bg-add-fg" : "bg-faint/60";
  });
  return (
    <div
      onClick={() => actions.selectSession(session.workspaceId, session.id)}
      className={clsx(
        "group flex max-w-52 shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs",
        active ? "bg-hover text-fg" : "text-muted hover:text-fg",
      )}
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="shrink-0 font-medium whitespace-nowrap">{agentName}</span>
      {session.title && <span className="truncate text-muted">· {session.title}</span>}
      <button
        onClick={(e) => {
          e.stopPropagation();
          void actions.closeSession(session.workspaceId, session.id);
        }}
        className="invisible rounded p-0.5 hover:bg-bg group-hover:visible"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function SetupLog({ workspaceId }: { workspaceId: string }) {
  const log = useStore((s) => s.scriptLog[workspaceId] ?? "");
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [log]);
  return (
    <pre ref={ref} className="selectable min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
      {log}
    </pre>
  );
}
