export type DiffLine = { type: "add" | "del" | "ctx" | "gap"; text: string; oldNo?: number; newNo?: number };

const CONTEXT = 3;

/** Line diff for agent edit previews (old/new text pairs). */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const mid: DiffLine[] = [];
  if (midA.length * midB.length > 4_000_000) {
    midA.forEach((text) => mid.push({ type: "del", text }));
    midB.forEach((text) => mid.push({ type: "add", text }));
  } else {
    // LCS table over the changed middle only.
    const n = midA.length;
    const m = midB.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * (m + 1) + j] = midA[i] === midB[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        mid.push({ type: "ctx", text: midA[i] });
        i++;
        j++;
      } else if (j < m && (i === n || dp[i * (m + 1) + j + 1] >= dp[(i + 1) * (m + 1) + j])) {
        mid.push({ type: "add", text: midB[j++] });
      } else {
        mid.push({ type: "del", text: midA[i++] });
      }
    }
  }

  const all: DiffLine[] = [
    ...a.slice(0, pre).map((text) => ({ type: "ctx" as const, text })),
    ...mid,
    ...a.slice(a.length - suf).map((text) => ({ type: "ctx" as const, text })),
  ];
  return collapse(all);
}

function collapse(lines: DiffLine[]): DiffLine[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.type === "ctx") return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) keep[k] = 1;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: "gap", text: `⋯ ${skipped} unchanged lines` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ type: "gap", text: `⋯ ${skipped} unchanged lines` });
  return out;
}

export type Hunk = { header: string; lines: DiffLine[] };

/** Parse `git diff` output for a single file into hunks with line numbers. */
export function parseUnifiedDiff(patch: string): { binary: boolean; hunks: Hunk[] } {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let binary = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("Binary files")) binary = true;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
    if (m) {
      cur = { header: line, lines: [] };
      hunks.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+")) cur.lines.push({ type: "add", text: line.slice(1), newNo: newNo++ });
    else if (line.startsWith("-")) cur.lines.push({ type: "del", text: line.slice(1), oldNo: oldNo++ });
    else if (line.startsWith(" ")) cur.lines.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return { binary, hunks };
}
