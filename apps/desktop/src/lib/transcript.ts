import type { CoreEvent } from "./api";

export type ToolContent =
  | { type: "content"; content: { type: string; text?: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

export type ToolCall = {
  toolCallId: string;
  title: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  content?: ToolContent[];
  locations?: { path: string; line?: number | null }[];
  rawInput?: any;
};

export type PlanEntry = { content: string; priority: string; status: "pending" | "in_progress" | "completed" };

export type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; messageId?: string; text: string }
  | { kind: "thought"; key: string; messageId?: string; text: string }
  | { kind: "tool"; key: string; call: ToolCall }
  | { kind: "plan"; key: string; entries: PlanEntry[] }
  | { kind: "turnEnd"; key: string; stopReason: string }
  | { kind: "error"; key: string; text: string };

export type Transcript = {
  items: Item[];
  /** toolCallId -> index in items */
  toolIndex: Record<string, number>;
  /** index of the plan item in the current turn, if any */
  planIndex: number | null;
  usage: { used: number; size: number } | null;
  seq: number;
};

export const emptyTranscript = (): Transcript => ({ items: [], toolIndex: {}, planIndex: null, usage: null, seq: 0 });

/**
 * Fold a batch of events into a transcript. Copies the items array once per
 * batch and replaces only the items that changed, so memoized rows for
 * untouched items don't re-render.
 */
export function applyEvents(t: Transcript, events: CoreEvent[]): Transcript {
  const items = t.items.slice();
  let toolIndex = t.toolIndex;
  let { planIndex, usage, seq } = t;
  const key = () => `i${++seq}`;

  for (const e of events) {
    switch (e.type) {
      case "userMessage":
        items.push({ kind: "user", key: key(), text: e.text });
        planIndex = null;
        break;
      case "turnEnd":
        items.push({ kind: "turnEnd", key: key(), stopReason: e.stopReason });
        break;
      case "sessionState":
        if (e.state === "error" && e.error) items.push({ kind: "error", key: key(), text: e.error });
        break;
      case "sessionUpdate": {
        const u = e.update;
        switch (u.sessionUpdate) {
          case "agent_message_chunk":
          case "agent_thought_chunk": {
            if (u.content?.type !== "text") break;
            const kind = u.sessionUpdate === "agent_message_chunk" ? "assistant" : "thought";
            const last = items[items.length - 1];
            if (last && last.kind === kind && (!u.messageId || !last.messageId || last.messageId === u.messageId)) {
              items[items.length - 1] = { ...last, text: last.text + u.content.text };
            } else {
              items.push({ kind, key: key(), messageId: u.messageId ?? undefined, text: u.content.text });
            }
            break;
          }
          case "tool_call": {
            const { sessionUpdate: _, ...call } = u;
            const idx = toolIndex[u.toolCallId];
            if (idx !== undefined) {
              const prev = items[idx] as Extract<Item, { kind: "tool" }>;
              items[idx] = { ...prev, call: { ...prev.call, ...call } as ToolCall };
            } else {
              if (toolIndex === t.toolIndex) toolIndex = { ...toolIndex };
              toolIndex[u.toolCallId] = items.length;
              items.push({ kind: "tool", key: key(), call: call as ToolCall });
            }
            break;
          }
          case "tool_call_update": {
            const idx = toolIndex[u.toolCallId];
            if (idx === undefined) break;
            const prev = items[idx] as Extract<Item, { kind: "tool" }>;
            const patch: Partial<ToolCall> = {};
            for (const k of ["title", "kind", "status", "content", "locations", "rawInput"] as const) {
              if (u[k] !== undefined && u[k] !== null) (patch as any)[k] = u[k];
            }
            items[idx] = { ...prev, call: { ...prev.call, ...patch } };
            break;
          }
          case "plan": {
            const entries = (u.entries ?? []) as PlanEntry[];
            if (planIndex !== null && items[planIndex]?.kind === "plan") {
              items[planIndex] = { ...(items[planIndex] as Extract<Item, { kind: "plan" }>), entries };
            } else {
              planIndex = items.length;
              items.push({ kind: "plan", key: key(), entries });
            }
            break;
          }
          case "usage_update":
            usage = { used: u.used, size: u.size };
            break;
        }
        break;
      }
    }
  }
  return { items, toolIndex, planIndex, usage, seq };
}
