import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  Check,
  CircleDashed,
  CircleX,
  FileCode,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { checkSummary } from "../lib/pr";

type Tab = "description" | "activity" | "checks";

/** `selectedSession` value for a workspace's PR tab. */
export const PR_TAB = "pr";

const imageCache = new Map<string, Promise<string>>();
const isGithubHost = (url: string) => {
  try {
    const host = new URL(url).host;
    return host === "github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
};

/** GitHub-rendered HTML (sanitized). Images from GitHub are fetched through
 * the core with the user's token, so private repositories work too. */
const GithubHtml = memo(function GithubHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const clean = useMemo(
    () => DOMPurify.sanitize(html ?? "", { ADD_TAGS: ["video"], ADD_ATTR: ["controls"], FORBID_TAGS: ["style", "form", "iframe"] }),
    [html],
  );

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!isGithubHost(src)) continue;
      img.removeAttribute("src");
      img.style.minHeight = "60px";
      img.style.background = "var(--hover)";
      if (!imageCache.has(src)) imageCache.set(src, api.fetchImage(src));
      imageCache
        .get(src)!
        .then((data) => {
          img.src = data;
          img.style.minHeight = "";
          img.style.background = "";
        })
        .catch(() => {
          imageCache.delete(src);
          img.alt = img.alt || "Image couldn't be loaded";
        });
    }
  }, [clean]);

  return (
    <div
      ref={ref}
      className="md selectable"
      dangerouslySetInnerHTML={{ __html: clean }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a?.href) {
          e.preventDefault();
          if (/^https?:/.test(a.href)) void openUrl(a.href);
        }
      }}
    />
  );
});

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Avatar({ user }: { user: any }) {
  return user?.avatar_url ? (
    <img src={`${user.avatar_url}&s=48`} alt="" className="h-5 w-5 shrink-0 rounded-full" />
  ) : (
    <span className="h-5 w-5 shrink-0 rounded-full bg-hover" />
  );
}

export function PrView({ workspaceId }: { workspaceId: string }) {
  const summary = useStore((s) => s.prs[workspaceId]);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("description");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.prDetails(workspaceId));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const pull = data?.pull;
  const checks = summary ? checkSummary(summary) : null;
  const activity = useMemo(() => (data ? buildActivity(data) : []), [data]);

  if (!pull) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted">
        {error ? <span className="max-w-md text-center text-del-fg">{error}</span> : <Loader2 size={14} className="animate-spin" />}
      </div>
    );
  }

  const state = pull.merged ? "merged" : pull.state === "closed" ? "closed" : pull.draft ? "draft" : "open";
  const StateIcon = { merged: GitMerge, closed: GitPullRequestClosed, draft: GitPullRequestDraft, open: GitPullRequest }[state];
  const stateStyle = {
    merged: "bg-[#8957e5] text-white",
    closed: "bg-del-fg text-white",
    draft: "bg-muted text-bg",
    open: "bg-add-fg text-bg",
  }[state];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-start gap-3">
          <h1 className="selectable min-w-0 flex-1 text-xl leading-snug font-semibold">
            {pull.title} <span className="font-normal text-muted">#{pull.number}</span>
          </h1>
          <button onClick={load} title="Refresh" className="mt-1 rounded p-1.5 text-muted hover:bg-hover hover:text-fg">
            <RefreshCw size={13} className={clsx(loading && "animate-spin")} />
          </button>
          <button
            onClick={() => openUrl(pull.html_url)}
            className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-hover"
          >
            GitHub <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className={clsx("flex items-center gap-1 rounded-full px-2 py-0.5 font-medium capitalize", stateStyle)}>
            <StateIcon size={12} /> {state}
          </span>
          <Avatar user={pull.user} />
          <span>
            <span className="font-medium text-fg">{pull.user?.login}</span> wants to merge into{" "}
            <code className="rounded bg-code px-1">{pull.base?.ref}</code> from <code className="rounded bg-code px-1">{pull.head?.ref}</code>
          </span>
          <span className="flex-1" />
          <span className="font-mono">
            <span className="text-add-fg">+{pull.additions}</span> <span className="text-del-fg">−{pull.deletions}</span>
          </span>
          <span className="flex items-center gap-1">
            <FileCode size={12} /> {pull.changed_files} files
          </span>
        </div>

        <div className="mt-4 mb-4 flex items-center gap-1 border-b border-border">
          {(
            [
              ["description", "Description", null],
              ["activity", "Activity", activity.length || null],
              ["checks", "Checks", checks && checks.passed + checks.failed.length + checks.pending ? `${checks.passed}/${checks.passed + checks.failed.length + checks.pending}` : null],
            ] as [Tab, string, string | number | null][]
          ).map(([t, label, count]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[13px]",
                tab === t ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t === "checks" && checks && (checks.failed.length ? <CircleX size={12} className="text-del-fg" /> : checks.pending ? <CircleDashed size={12} className="text-warn" /> : <Check size={12} className="text-add-fg" />)}
              {label}
              {count !== null && <span className="text-xs text-faint">{count}</span>}
            </button>
          ))}
        </div>

        {tab === "description" &&
          (pull.body_html?.trim() ? <GithubHtml html={pull.body_html} /> : <div className="text-muted italic">No description provided.</div>)}

        {tab === "activity" && (
          <div className="space-y-4">
            {activity.length === 0 && <div className="text-muted">No comments or reviews yet.</div>}
            {activity.map((a) => (
              <div key={a.id} className="rounded-lg border border-border bg-elevated">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
                  <Avatar user={a.user} />
                  <span className="font-medium text-fg">{a.user?.login}</span>
                  <span className={clsx(a.tone)}>{a.verb}</span>
                  <span className="flex-1" />
                  <span title={new Date(a.at).toLocaleString()}>{ago(a.at)}</span>
                  {a.url && (
                    <button onClick={() => a.url && openUrl(a.url)} className="rounded p-0.5 hover:bg-hover hover:text-fg" title="Open on GitHub">
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
                {(a.html || a.inline.length > 0) && (
                  <div className="space-y-3 px-3 py-2.5">
                    {a.html && <GithubHtml html={a.html} />}
                    {a.inline.map((c: any) => (
                      <div key={c.id} className="rounded-md border border-border">
                        <div className="flex items-center gap-1.5 border-b border-border bg-panel px-2.5 py-1 font-mono text-[11px] text-muted">
                          <MessageSquare size={11} /> {c.path}
                          {c.line ? `:${c.line}` : ""}
                        </div>
                        {c.diff_hunk && (
                          <pre className="overflow-x-auto border-b border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted">
                            {c.diff_hunk.split("\n").slice(-4).join("\n")}
                          </pre>
                        )}
                        <div className="px-2.5 py-2">
                          <GithubHtml html={c.body_html} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "checks" && (
          <div className="overflow-hidden rounded-lg border border-border">
            {(data.checks ?? []).length === 0 && <div className="px-3 py-4 text-muted">No checks.</div>}
            {(data.checks ?? []).map((c: any, i: number) => {
              const result = (c.conclusion || c.state || c.status || "").toUpperCase();
              const ok = ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(result);
              const bad = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(result);
              const url = c.detailsUrl || c.targetUrl;
              return (
                <div key={i} className="flex items-center gap-2.5 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
                  {ok ? <Check size={13} className="text-add-fg" /> : bad ? <CircleX size={13} className="text-del-fg" /> : <CircleDashed size={13} className="animate-spin text-warn [animation-duration:3s]" />}
                  <span className="min-w-0 flex-1 truncate">
                    {c.workflowName ? <span className="text-muted">{c.workflowName} / </span> : null}
                    {c.name ?? c.context}
                  </span>
                  <span className="text-xs text-faint lowercase">{result.replace(/_/g, " ")}</span>
                  {url && (
                    <button onClick={() => openUrl(url)} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg" title="Details">
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Comments and reviews (with their inline comments) in time order. */
function buildActivity(data: any) {
  const items: { id: string; user: any; verb: string; tone?: string; at: string; html: string; url?: string; inline: any[] }[] = [];
  for (const c of data.comments ?? []) {
    items.push({ id: `c${c.id}`, user: c.user, verb: "commented", at: c.created_at, html: c.body_html, url: c.html_url, inline: [] });
  }
  const inlineByReview = new Map<number, any[]>();
  for (const c of data.reviewComments ?? []) {
    const list = inlineByReview.get(c.pull_request_review_id) ?? [];
    list.push(c);
    inlineByReview.set(c.pull_request_review_id, list);
  }
  for (const r of data.reviews ?? []) {
    const inline = inlineByReview.get(r.id) ?? [];
    if (!r.body_html?.trim() && inline.length === 0 && r.state === "COMMENTED") continue;
    const verb =
      r.state === "APPROVED" ? "approved" : r.state === "CHANGES_REQUESTED" ? "requested changes" : r.state === "DISMISSED" ? "review dismissed" : "reviewed";
    const tone = r.state === "APPROVED" ? "text-add-fg" : r.state === "CHANGES_REQUESTED" ? "text-del-fg" : undefined;
    items.push({ id: `r${r.id}`, user: r.user, verb, tone, at: r.submitted_at, html: r.body_html, url: r.html_url, inline });
  }
  return items.filter((i) => i.at).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
