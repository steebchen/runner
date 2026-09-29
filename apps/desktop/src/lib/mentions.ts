import { api } from "./api";

const cache = new Map<string, { at: number; files: Promise<string[]> }>();

/** Files of a workspace for @-mentions, cached briefly. */
export function workspaceFiles(workspaceId: string): Promise<string[]> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < 30_000) return hit.files;
  const files = api.listFiles(workspaceId).catch(() => [] as string[]);
  cache.set(workspaceId, { at: Date.now(), files });
  return files;
}

/** The "@query" being typed right before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/** Rank paths for a query: basename prefix > basename substring > path substring > subsequence. */
export function rankFiles(files: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return files.slice(0, limit);
  const scored: [number, string][] = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    let score = -1;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else {
      let i = 0;
      for (const c of lower) if (c === q[i]) i++;
      if (i === q.length) score = 3;
    }
    if (score >= 0) scored.push([score * 1000 + f.length, f]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, f]) => f);
}
