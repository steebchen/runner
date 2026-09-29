import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { GitBranch, GitPullRequest, Loader2, Search } from "lucide-react";
import { api, type Branch, type OpenPr } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { actions, useStore } from "../lib/store";
import { ago } from "../lib/time";

type Row = { key: string; title: string; detail: string; tag?: string; branch?: string; pr?: number };

/** Start a workspace on an existing branch or a pull request. */
export function NewWorkspaceDialog({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const used = useStore(useShallow((s) => s.workspaces.filter((w) => w.repoId === repoId).map((w) => w.branch)));
  const [tab, setTab] = useState<"branch" | "pr">("branch");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [prs, setPrs] = useState<OpenPr[] | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listBranches(repoId).then(setBranches, () => setBranches([]));
    api.openPrs(repoId).then(setPrs, (e) => {
      setPrs([]);
      setPrError(String(e));
    });
  }, [repoId]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...s: string[]) => !q || s.some((x) => x.toLowerCase().includes(q));
    if (tab === "branch") {
      return (branches ?? [])
        .filter((b) => b.name !== repo?.defaultBranch && !used.includes(b.name) && match(b.name, b.subject))
        .slice(0, 100)
        .map((b) => ({ key: b.name, title: b.name, detail: `${b.subject} · ${ago(b.updatedAt)}`, tag: b.remote ? "origin" : undefined, branch: b.name }));
    }
    return (prs ?? [])
      .filter((p) => match(String(p.number), p.title, p.headRefName, p.author?.login ?? ""))
      .map((p) => ({
        key: String(p.number),
        title: `#${p.number} ${p.title}`,
        detail: `${p.author?.login ?? ""} · ${p.headRefName} · ${ago(Date.parse(p.updatedAt))}`,
        tag: p.isDraft ? "draft" : p.isCrossRepository ? "fork" : undefined,
        pr: p.number,
      }));
  }, [tab, query, branches, prs, repo?.defaultBranch, used]);

  useEffect(() => setActive(0), [tab, query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = async (row: Row | undefined) => {
    if (!row || busy) return;
    setBusy(true);
    const ok = await actions.createWorkspaceFrom(repoId, row.branch ?? null, row.pr ?? null);
    setBusy(false);
    if (ok) onClose();
  };

  const loading = tab === "branch" ? !branches : !prs;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onMouseDown={onClose}>
      <div className="flex max-h-[70vh] w-[600px] flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4 pt-3 pb-2">
          <span className="font-medium">New workspace from…</span>
          <span className="text-xs text-muted">{repo?.name}</span>
          <div className="flex-1" />
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            {(
              [
                ["branch", "Branch", <GitBranch key="b" size={12} />],
                ["pr", "Pull request", <GitPullRequest key="p" size={12} />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx("flex items-center gap-1 rounded px-2.5 py-1", tab === id ? "bg-hover font-medium" : "text-muted hover:text-fg")}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Search size={13} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((i) => Math.min(rows.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter") void choose(rows[active]);
              else if (e.key === "Escape") onClose();
              else if (e.key === "Tab") setTab((t) => (t === "branch" ? "pr" : "branch"));
              else return;
              e.preventDefault();
            }}
            placeholder={tab === "branch" ? "Filter branches" : "Filter pull requests by number, title, branch or author"}
            className="selectable flex-1 bg-transparent py-1 outline-none placeholder:text-faint"
          />
          {busy && <Loader2 size={13} className="animate-spin text-muted" />}
        </div>
        <div ref={listRef} className="min-h-24 flex-1 overflow-y-auto p-1">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-muted">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-3 text-muted">{tab === "pr" && prError ? prError : query ? "Nothing matches." : tab === "pr" ? "No open pull requests." : "No other branches."}</div>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.key}
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => void choose(r)}
                className={clsx("flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left", i === active && "bg-hover")}
              >
                {r.pr ? <GitPullRequest size={13} className="shrink-0 text-muted" /> : <GitBranch size={13} className="shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{r.title}</div>
                  <div className="truncate text-[11px] text-muted">{r.detail}</div>
                </div>
                {r.tag && <span className="shrink-0 rounded border border-border px-1.5 text-[10px] text-muted">{r.tag}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
