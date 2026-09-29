import { useEffect, useState } from "react";
import clsx from "clsx";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Archive, ArrowUpRight, Check, GitMerge, GitPullRequest, Loader2, Sparkles, Upload, Wrench, X } from "lucide-react";
import { PR_TAB } from "./PrView";
import { api, type Workspace } from "../lib/api";
import { checkSummary, prAppearance } from "../lib/pr";
import { actions, toast, useStore } from "../lib/store";

export function PrActions({ workspace, sessionId }: { workspace: Workspace; sessionId?: string }) {
  const pr = useStore((s) => s.prs[workspace.id]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);

  // The core polls every minute; ask for a fresh read when the view opens.
  useEffect(() => {
    void api.refreshPrs().catch(() => {});
  }, [workspace.id]);
  const refresh = () => void api.refreshPrs().catch(() => {});

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done, "info");
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (pr === undefined) return null;

  if (!pr) {
    return (
      <>
        <button
          onClick={() => setDialog(true)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />} Create PR
        </button>
        {dialog && (
          <CreatePrDialog
            workspace={workspace}
            onClose={() => setDialog(false)}
            onSubmit={(title, body) => {
              setDialog(false);
              void run(async () => {
                const url = await api.createPr(workspace.id, title, body);
                if (url.startsWith("http")) void openUrl(url);
              }, "Pull request created");
            }}
          />
        )}
      </>
    );
  }

  const { passed, failed, pending } = checkSummary(pr);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="flex items-center overflow-hidden rounded-md border border-border">
        <button
          onClick={() => actions.selectSession(workspace.id, PR_TAB)}
          className="flex items-center gap-1 px-1.5 py-1 hover:bg-hover"
          title={`${pr.title} — open here`}
        >
          <GitPullRequest size={12} className={prAppearance(pr).color} />#{pr.number}
          <span className={clsx("text-[11px]", prAppearance(pr).color)}>{prAppearance(pr).label}</span>
        </button>
        <button onClick={() => openUrl(pr.url)} className="border-l border-border px-1 py-1 text-muted hover:bg-hover hover:text-fg" title="Open on GitHub">
          <ArrowUpRight size={12} />
        </button>
      </span>
      {pr.state === "OPEN" && (passed + failed.length + pending > 0) && (
        <span className="flex items-center gap-1.5 text-muted" title={failed.length ? `Failing: ${failed.join(", ")}` : undefined}>
          {passed > 0 && (
            <span className="flex items-center text-add-fg">
              <Check size={11} />
              {passed}
            </span>
          )}
          {failed.length > 0 && (
            <span className="flex items-center text-del-fg">
              <X size={11} />
              {failed.length}
            </span>
          )}
          {pending > 0 && (
            <span className="flex items-center">
              <Loader2 size={11} className="animate-spin" />
              {pending}
            </span>
          )}
        </span>
      )}
      {pr.state === "OPEN" && failed.length > 0 && sessionId && (
        <button
          onClick={() =>
            actions.appendDraft(
              sessionId,
              `CI checks are failing on PR #${pr.number}: ${failed.join(", ")}. Use \`gh pr checks\` and \`gh run view --log-failed\` to investigate, fix the problems, then commit and push.`,
            )
          }
          className="flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-fg"
        >
          <Wrench size={12} /> Fix checks
        </button>
      )}
      {pr.state !== "OPEN" && (
        <button
          onClick={() => void actions.archiveWorkspace(workspace.id)}
          title="Remove the worktree (the branch is kept, and the workspace can be restored from Home)"
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg"
        >
          <Archive size={12} /> Archive
        </button>
      )}
      {pr.state === "OPEN" && (
        <>
          <button
            onClick={() => run(() => api.commitAndPush(workspace.id), "Pushed")}
            disabled={busy}
            title="Commit pending changes (with a written message) and push"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-fg"
          >
            <Upload size={12} /> Push
          </button>
          <button
            onClick={() => run(() => api.mergePr(workspace.id), "Merged")}
            disabled={busy || pr.isDraft}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium disabled:opacity-50",
              failed.length ? "border border-border" : "bg-add-fg text-bg",
            )}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />} Merge
          </button>
        </>
      )}
    </div>
  );
}

function CreatePrDialog({
  workspace,
  onClose,
  onSubmit,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSubmit: (title: string, body: string) => void;
}) {
  const sessionTitle = useStore((s) => (s.sessions[workspace.id] ?? []).find((x) => x.title)?.title ?? "");
  const [title, setTitle] = useState(sessionTitle);
  const [body, setBody] = useState("");
  const [writing, setWriting] = useState(false);
  const write = async () => {
    setWriting(true);
    try {
      const [t, b] = await api.draftPr(workspace.id);
      setTitle(t);
      setBody(b);
    } catch (e) {
      toast(String(e));
    } finally {
      setWriting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-32" onMouseDown={onClose}>
      <div className="w-[520px] rounded-xl border border-border bg-elevated p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 font-medium">
          Create pull request <span className="font-normal text-muted">{workspace.branch} → {workspace.baseBranch}</span>
        </div>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="selectable mb-2 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Description (optional)"
          rows={6}
          className="selectable w-full resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
        />
        <div className="mt-1 text-xs text-muted">Uncommitted changes are committed with the title as message, then pushed.</div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => void write()}
            disabled={writing}
            title="Write the title and description from the branch's changes (uses Claude Haiku with your Claude login)"
            className="mr-auto flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-hover disabled:opacity-60"
          >
            {writing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {writing ? "Writing…" : "Write with AI"}
          </button>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 hover:bg-hover">
            Cancel
          </button>
          <button
            disabled={!title.trim() || writing}
            onClick={() => onSubmit(title.trim(), body)}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg disabled:opacity-50"
          >
            Create PR
          </button>
        </div>
      </div>
    </div>
  );
}
