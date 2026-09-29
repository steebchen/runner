import type { PrStatus } from "./api";

export type CheckState = "failure" | "pending" | "success" | "none";

export function checkSummary(pr: PrStatus) {
  let passed = 0;
  const failed: string[] = [];
  let pending = 0;
  for (const c of pr.statusCheckRollup ?? []) {
    const result = (c.conclusion || c.state || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(result)) passed++;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(result))
      failed.push(c.name ?? c.context ?? "check");
    else pending++;
  }
  const state: CheckState = failed.length ? "failure" : pending ? "pending" : passed ? "success" : "none";
  return { passed, failed, pending, state };
}

/** Text color + label for a PR's state, GitHub style. */
export function prAppearance(pr: PrStatus): { color: string; label: string } {
  if (pr.state === "MERGED") return { color: "text-[#8957e5]", label: "Merged" };
  if (pr.state === "CLOSED") return { color: "text-del-fg", label: "Closed" };
  if (pr.isDraft) return { color: "text-muted", label: "Draft" };
  return { color: "text-add-fg", label: "Open" };
}
