import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDown, GitMerge, Loader2, TriangleAlert } from "lucide-react";
import { api, type SyncStatus, type Workspace } from "../lib/api";
import { actions, toast, useStore } from "../lib/store";
import { Menu } from "./Menu";

/** How far the branch is behind its base, with a one-click merge, and what
 * to do when a merge stopped on conflicts. */
export function SyncBadge({ workspace, sessionId }: { workspace: Workspace; sessionId?: string }) {
  const tick = useStore((s) => s.changesTick[workspace.id] ?? 0);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .syncStatus(workspace.id)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [workspace.id]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh, tick]);

  const askAgent = (files: string[]) => {
    if (!sessionId) return toast("Open a chat to hand the conflicts to an agent");
    const list = files.length ? `:\n${files.map((f) => `- ${f}`).join("\n")}` : ".";
    actions.appendDraft(
      sessionId,
      `Merging \`${workspace.baseBranch}\` into this branch stopped on conflicts${list}\n\nResolve them, keeping the intent of both sides, check that it still builds and the tests pass, then commit the merge.`,
    );
    actions.selectSession(workspace.id, sessionId);
  };

  const merge = async () => {
    setBusy(true);
    try {
      const conflicts = await api.mergeBaseBranch(workspace.id);
      if (conflicts.length) toast(`Merge stopped on conflicts in ${conflicts.length} file${conflicts.length === 1 ? "" : "s"}`, "info");
      else toast(`Merged ${workspace.baseBranch} into ${workspace.branch}`, "info");
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const abort = async () => {
    await api.abortMerge(workspace.id).catch((e) => toast(String(e)));
    refresh();
  };

  if (!status) return null;

  if (status.merging) {
    const n = status.conflicts.length;
    return (
      <Menu
        align="left"
        label={
          <span className={clsx("flex items-center gap-1", n ? "text-warn" : "text-muted")}>
            {n ? <TriangleAlert size={12} /> : <GitMerge size={12} />}
            {n ? `${n} conflict${n === 1 ? "" : "s"}` : "Merge in progress"}
          </span>
        }
        items={[
          { label: n ? "Resolve with agent" : "Ask agent to finish the merge", onSelect: () => askAgent(status.conflicts) },
          { label: "Abort merge", onSelect: () => void abort() },
        ]}
      />
    );
  }

  if (!status.behind) return null;
  return (
    <button
      onClick={() => void merge()}
      disabled={busy}
      title={`${status.behind} new commit${status.behind === 1 ? "" : "s"} on ${workspace.baseBranch}. Click to merge ${workspace.baseBranch} into this branch.`}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-60"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <ArrowDown size={11} />}
      {status.behind} behind
    </button>
  );
}
