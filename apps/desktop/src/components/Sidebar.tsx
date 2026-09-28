import { memo } from "react";
import clsx from "clsx";
import { FolderPlus, GitBranch, Loader2, Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { useResizable } from "../lib/resize";
import { ResizeHandle } from "./ResizeHandle";
import { actions, useStore, workspaceActivity } from "../lib/store";
import type { Repo, Workspace } from "../lib/api";
import { pickRepo } from "../App";

export function Sidebar() {
  const repos = useStore((s) => s.repos);
  const { width, ref, onPointerDown } = useResizable("runner.sidebarWidth", 280, 200, 480, "right");
  return (
    <aside
      ref={ref as React.RefObject<HTMLElement>}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-border bg-panel"
    >
      <ResizeHandle edge="right" onPointerDown={onPointerDown} />
      <div className="flex h-13 shrink-0 items-center justify-end px-2" data-tauri-drag-region>
        <button onClick={pickRepo} title="Add repository (⇧⌘O)" className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg">
          <FolderPlus size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {repos.map((r) => (
          <RepoGroup key={r.id} repo={r} />
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <button
          onClick={() => actions.openSettings(useStore.getState().page !== "settings")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <SettingsIcon size={14} /> Settings
          <span className="ml-auto text-[10px] text-faint">⌘,</span>
        </button>
      </div>
    </aside>
  );
}

function RepoGroup({ repo }: { repo: Repo }) {
  const workspaces = useStore((s) => s.workspaces);
  const list = workspaces.filter((w) => w.repoId === repo.id);
  return (
    <div className="mb-3">
      <div className="group flex h-7 items-center gap-1 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <span className="flex-1 truncate" title={repo.path}>
          {repo.name}
        </span>
        {list.length === 0 && (
          <button
            onClick={() => actions.removeRepo(repo.id)}
            title="Remove repository"
            className="hidden rounded p-1 hover:bg-hover hover:text-fg group-hover:block"
          >
            <Trash2 size={12} />
          </button>
        )}
        <button
          onClick={() => actions.createWorkspace(repo.id)}
          title="New workspace (⌘N)"
          className="rounded p-1 hover:bg-hover hover:text-fg"
        >
          <Plus size={13} />
        </button>
      </div>
      {list.map((w) => (
        <WorkspaceRow key={w.id} ws={w} index={workspaces.indexOf(w)} />
      ))}
    </div>
  );
}

const WorkspaceRow = memo(function WorkspaceRow({ ws, index }: { ws: Workspace; index: number }) {
  const selected = useStore((s) => s.selectedWorkspace === ws.id);
  const activity = useStore((s) => workspaceActivity(s, ws.id));
  const sessionTitle = useStore((s) => (s.sessions[ws.id] ?? []).find((x) => x.title)?.title ?? "");
  const title = ws.title || sessionTitle;
  return (
    <button
      onClick={() => actions.selectWorkspace(ws.id)}
      className={clsx(
        "flex w-full flex-col rounded-md px-2 py-1.5 text-left",
        selected ? "bg-hover" : "hover:bg-hover/60",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <StatusDot activity={activity} setup={ws.status} />
        <span className={clsx("flex-1 truncate", selected ? "font-medium text-fg" : "text-fg/90", !title && "text-muted")}>
          {title || (ws.status === "creating" ? "New workspace" : ws.name)}
        </span>
        {index < 9 && <span className="text-[10px] text-faint">⌘{index + 1}</span>}
      </div>
      <div className="flex items-center gap-1 pl-4 text-[11px] text-muted">
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{ws.status === "creating" ? "Creating worktree…" : ws.branch}</span>
      </div>
    </button>
  );
});

function StatusDot({ activity, setup }: { activity: ReturnType<typeof workspaceActivity>; setup: string }) {
  if (setup === "creating" || (setup === "setting_up" && activity === "idle")) {
    return <Loader2 size={10} className="shrink-0 animate-spin text-muted" />;
  }
  const cls =
    setup === "setup_failed" || setup === "failed"
      ? "bg-del-fg"
      : {
          "needs-input": "bg-warn",
          running: "bg-accent pulse",
          error: "bg-del-fg",
          unread: "bg-add-fg",
          idle: "bg-faint/50",
        }[activity];
  return <span className={clsx("h-2 w-2 shrink-0 rounded-full", cls)} />;
}
