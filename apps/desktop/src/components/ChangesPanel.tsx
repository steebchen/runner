import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { MessageSquarePlus, RefreshCw, Undo2, X } from "lucide-react";
import { api, type ChangedFile } from "../lib/api";
import { actions, toast, useStore } from "../lib/store";
import { parseUnifiedDiff, type DiffLine } from "../lib/diff";

type Comment = { path: string; line: number; text: string };

export function ChangesPanel({ workspaceId, sessionId }: { workspaceId: string; sessionId?: string }) {
  const tick = useStore((s) => s.changesTick[workspaceId] ?? 0);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [diffTick, setDiffTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const next = await api.changedFiles(workspaceId);
      setFiles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setDiffTick((t) => t + 1);
    } catch (e) {
      setFiles([]);
      console.warn(e);
    }
  }, [workspaceId]);

  // Agents edit files with their own tools, so poll cheaply while visible.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => document.visibilityState === "visible" && void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh, tick]);

  useEffect(() => {
    if (files && (!selected || !files.some((f) => f.path === selected))) setSelected(files[0]?.path ?? null);
  }, [files, selected]);

  const totals = useMemo(
    () => (files ?? []).reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 }),
    [files],
  );

  const sendComments = () => {
    if (!sessionId) return toast("Open a chat to send comments to an agent");
    const body = comments.map((c) => `- ${c.path}:${c.line} — ${c.text}`).join("\n");
    actions.appendDraft(sessionId, `Please address these review comments:\n${body}`);
    setComments([]);
  };

  if (!files) return <div className="p-4 text-muted">Loading…</div>;
  if (!files.length) return <div className="p-4 text-muted">No changes yet.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} · <span className="text-add-fg">+{totals.add}</span>{" "}
          <span className="text-del-fg">−{totals.del}</span>
        </span>
        <div className="flex-1" />
        <button onClick={refresh} title="Refresh" className="rounded p-1 hover:bg-hover hover:text-fg">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="max-h-[35%] shrink-0 overflow-y-auto border-b border-border py-1">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => setSelected(f.path)}
            className={clsx("flex w-full items-center gap-2 px-3 py-[3px] text-left text-xs", selected === f.path ? "bg-hover" : "hover:bg-hover/60")}
          >
            <span
              className={clsx(
                "w-3 shrink-0 font-mono text-[10px] font-bold",
                f.status === "A" ? "text-add-fg" : f.status === "D" ? "text-del-fg" : "text-warn",
              )}
            >
              {f.status}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" dir="rtl" title={f.path}>
              {f.path}
            </span>
            <span className="shrink-0 font-mono text-[10.5px]">
              {f.additions !== null ? (
                <>
                  <span className="text-add-fg">+{f.additions}</span> <span className="text-del-fg">−{f.deletions}</span>
                </>
              ) : (
                <span className="text-faint">bin</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {comments.length > 0 && (
        <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
          {comments.map((c, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="shrink-0 font-mono text-muted">
                {c.path.split("/").pop()}:{c.line}
              </span>
              <span className="flex-1">{c.text}</span>
              <button onClick={() => setComments(comments.filter((_, j) => j !== i))} className="text-faint hover:text-fg">
                <X size={11} />
              </button>
            </div>
          ))}
          <button onClick={sendComments} className="mt-1.5 rounded-md bg-accent px-2 py-1 font-medium text-accent-fg">
            Add {comments.length} comment{comments.length === 1 ? "" : "s"} to chat
          </button>
        </div>
      )}
      {selected && (
        <FileDiff
          key={selected}
          workspaceId={workspaceId}
          path={selected}
          tick={diffTick}
          onComment={(line, text) => setComments((c) => [...c, { path: selected, line, text }])}
          onRevert={async () => {
            await api.revertFile(workspaceId, selected).catch((e) => toast(String(e)));
            void refresh();
          }}
        />
      )}
    </div>
  );
}

const ROW = 19;

function FileDiff({
  workspaceId,
  path,
  tick,
  onComment,
  onRevert,
}: {
  workspaceId: string;
  path: string;
  tick: number;
  onComment: (line: number, text: string) => void;
  onRevert: () => void;
}) {
  const [patch, setPatch] = useState<string | null>(null);
  const [commentAt, setCommentAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    api
      .fileDiff(workspaceId, path)
      .then((p) => live && setPatch((prev) => (prev === p ? prev : p)))
      .catch((e) => live && setPatch(`error: ${e}`));
    return () => {
      live = false;
    };
  }, [workspaceId, path, tick]);

  const rows = useMemo(() => {
    if (patch === null) return [];
    const { binary, hunks } = parseUnifiedDiff(patch);
    if (binary) return [{ type: "gap", text: "Binary file" } as DiffLine];
    return hunks.flatMap((h) => [{ type: "gap", text: h.header } as DiffLine, ...h.lines]);
  }, [patch]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].newNo === commentAt && commentAt !== null ? ROW + 64 : ROW),
    overscan: 30,
  });

  useEffect(() => virtualizer.measure(), [commentAt, virtualizer]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{path}</span>
        <button onClick={onRevert} title="Discard changes to this file" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg">
          <Undo2 size={12} /> Discard
        </button>
      </div>
      <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-auto bg-bg font-mono text-[11.5px]">
        <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const l = rows[v.index];
            return (
              <div key={v.index} className="absolute left-0 w-full" style={{ transform: `translateY(${v.start}px)` }}>
                <div
                  className={clsx(
                    "group flex whitespace-pre",
                    l.type === "add" && "bg-add-bg",
                    l.type === "del" && "bg-del-bg",
                    l.type === "gap" && "bg-panel text-faint",
                  )}
                  style={{ height: ROW, lineHeight: `${ROW}px` }}
                >
                  <span className="w-10 shrink-0 pr-1 text-right text-faint select-none">{l.oldNo ?? ""}</span>
                  <span className="relative w-10 shrink-0 pr-1 text-right text-faint select-none">
                    {l.newNo ?? ""}
                    {l.newNo !== undefined && (
                      <button
                        onClick={() => setCommentAt(l.newNo!)}
                        title="Comment on this line"
                        className="absolute top-0.5 -right-2 hidden rounded bg-accent p-0.5 text-accent-fg group-hover:block"
                      >
                        <MessageSquarePlus size={10} />
                      </button>
                    )}
                  </span>
                  <span className={clsx("pl-3", l.type === "add" && "text-add-fg", l.type === "del" && "text-del-fg")}>
                    {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                    {l.text}
                  </span>
                </div>
                {commentAt !== null && l.newNo === commentAt && (
                  <CommentBox
                    onCancel={() => setCommentAt(null)}
                    onSubmit={(text) => {
                      onComment(commentAt, text);
                      setCommentAt(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CommentBox({ onSubmit, onCancel }: { onSubmit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex h-16 items-start gap-2 border-y border-border bg-elevated px-3 py-2 font-sans">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && text.trim()) {
            e.preventDefault();
            onSubmit(text.trim());
          } else if (e.key === "Escape") onCancel();
        }}
        placeholder="Comment for the agent (Enter to add)"
        className="h-full flex-1 resize-none bg-transparent text-xs outline-none"
      />
    </div>
  );
}
