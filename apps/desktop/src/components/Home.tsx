import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Archive, ArchiveRestore, GitBranch, Loader2, Search } from "lucide-react";
import { api, type Workspace } from "../lib/api";
import { actions, useStore } from "../lib/store";
import { ago } from "../lib/time";

type Filter = "active" | "archived" | "all";


/** Every workspace, including archived ones, with archive / restore. */
export function Home() {
  const repos = useStore((s) => s.repos);
  const active = useStore((s) => s.workspaces);
  const [all, setAll] = useState<Workspace[] | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .listAllWorkspaces()
      .then(setAll)
      .catch(() => setAll([]));
  }, []);

  // Live statuses and titles for active workspaces come from the store.
  useEffect(refresh, [refresh, active.length]);
  const merged = useMemo(() => {
    const live = new Map(active.map((w) => [w.id, w]));
    return (all ?? []).map((w) => live.get(w.id) ?? w);
  }, [all, active]);

  const counts = {
    active: merged.filter((w) => w.status !== "archived").length,
    archived: merged.filter((w) => w.status === "archived").length,
  };

  const q = query.trim().toLowerCase();
  const visible = merged.filter(
    (w) =>
      (filter === "all" || (filter === "archived") === (w.status === "archived")) &&
      (!q || [w.title, w.name, w.branch].some((f) => f.toLowerCase().includes(q))),
  );

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    await fn();
    setBusy(null);
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border px-5" data-tauri-drag-region>
        <span className="font-medium">Workspaces</span>
        <div className="flex-1" data-tauri-drag-region />
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="selectable w-52 rounded-md border border-border bg-bg py-1 pr-2 pl-6.5 text-xs outline-none focus:border-accent"
          />
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(
            [
              ["active", `Active ${counts.active}`],
              ["archived", `Archived ${counts.archived}`],
              ["all", "All"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx("rounded px-2.5 py-0.5 text-xs", filter === f ? "bg-hover font-medium" : "text-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {all === null ? (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-muted">
              {q ? "No workspaces match your search." : filter === "archived" ? "Nothing archived yet." : "No workspaces yet."}
            </div>
          ) : (
            repos
              .filter((r) => visible.some((w) => w.repoId === r.id))
              .map((r) => (
                <section key={r.id} className="mb-8">
                  <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{r.name}</h2>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {visible
                      .filter((w) => w.repoId === r.id)
                      .map((w) => (
                        <Row key={w.id} ws={w} busy={busy === w.id} onRun={(fn) => run(w.id, fn)} />
                      ))}
                  </div>
                </section>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ ws, busy, onRun }: { ws: Workspace; busy: boolean; onRun: (fn: () => Promise<unknown>) => void }) {
  const archived = ws.status === "archived";
  const sessionTitle = useStore((s) => (s.sessions[ws.id] ?? []).find((x) => x.title)?.title ?? "");
  const open = () => !archived && actions.selectWorkspace(ws.id);
  return (
    <div
      onClick={open}
      className={clsx(
        "group flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0",
        archived ? "bg-transparent" : "bg-elevated hover:bg-hover/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate", archived ? "text-muted" : "font-medium")}>{ws.title || sessionTitle || ws.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
          <GitBranch size={10} className="shrink-0" />
          <span className="truncate">{ws.branch}</span>
          <span className="text-faint">·</span>
          <span className="shrink-0">
            {archived && ws.archivedAt ? `archived ${ago(ws.archivedAt)}` : `created ${ago(ws.createdAt)}`}
          </span>
        </div>
      </div>
      {busy ? (
        <Loader2 size={13} className="animate-spin text-muted" />
      ) : archived ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRun(async () => {
              const restored = await actions.restoreWorkspace(ws.id);
              if (restored) actions.selectWorkspace(restored.id);
            });
          }}
          title="Check the branch out into a new worktree and continue where you left off"
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-hover"
        >
          <ArchiveRestore size={12} /> Restore
        </button>
      ) : (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRun(() => actions.archiveWorkspace(ws.id));
            }}
            title="Remove the worktree (the branch is kept, so it can be restored)"
            className="invisible flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted group-hover:visible hover:bg-bg hover:text-fg"
          >
            <Archive size={12} /> Archive
          </button>
          <button onClick={open} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg">
            Open
          </button>
        </>
      )}
    </div>
  );
}
