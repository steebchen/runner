import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Brain, Check, ChevronRight, ChevronsRight, Circle, CircleCheck, CircleDot, Clock, Copy, ListChecks, Pencil, ShieldQuestion, Square, X, Zap } from "lucide-react";
import { actions, useStore, type PendingQuestion, type Permission } from "../lib/store";
import { QuestionCard } from "./QuestionCard";
import type { Item } from "../lib/transcript";
import type { ConfigOption, SelectOption } from "../lib/api";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";
import { ModelPicker, cycleEffort, toggleFast } from "./ModelPicker";
import { effortOption, fastOption, modelOption } from "../lib/models";
import { mentionAt, rankFiles, workspaceFiles } from "../lib/mentions";

export function Chat({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
  const items = useStore((s) => s.views[sessionId]?.transcript.items) ?? EMPTY;
  const state = useStore((s) => s.views[sessionId]?.state ?? "disconnected");
  const loaded = useStore((s) => s.views[sessionId]?.loaded ?? false);
  const permissions = useStore((s) => s.views[sessionId]?.permissions) ?? EMPTY_PERMS;
  const questions = useStore((s) => s.views[sessionId]?.questions) ?? EMPTY_QUESTIONS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 10,
    getItemKey: (i) => items[i].key,
  });

  // Keep pinned to the bottom while streaming unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, virtualizer.getTotalSize(), permissions.length, questions.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (stick.current !== atBottom) setAtBottom(stick.current);
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!atBottom && items.length > 0 && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-40 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-muted shadow-md hover:text-fg"
        >
          <ArrowDown size={12} /> Jump to latest
        </button>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {loaded && items.length === 0 && <EmptyChat state={state} />}
        <div className="relative mx-auto w-full max-w-3xl" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full px-5"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <Row item={items[row.index]} />
            </div>
          ))}
        </div>
        {state === "running" && permissions.length === 0 && questions.length === 0 && (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 pb-4 text-xs text-muted">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-accent" /> Working…
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-5 pb-4">
        {questions[0] && <QuestionCard key={questions[0].requestId} sessionId={sessionId} question={questions[0]} />}
        {permissions.map((p) => (
          <PermissionPrompt key={p.requestId} sessionId={sessionId} permission={p} />
        ))}
        <Composer sessionId={sessionId} workspaceId={workspaceId} />
      </div>
    </div>
  );
}

const EMPTY: Item[] = [];
const EMPTY_PERMS: Permission[] = [];
const EMPTY_QUESTIONS: PendingQuestion[] = [];

function EmptyChat({ state }: { state: string }) {
  return (
    <div className="mx-auto mt-24 max-w-md text-center text-muted">
      {state === "connecting" ? "Starting agent…" : "Describe a task. The agent works in this workspace's worktree."}
    </div>
  );
}

const Row = memo(function Row({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end pt-5 pb-1">
          <div className="selectable max-w-[85%] rounded-xl bg-hover px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="group relative py-2">
          <Markdown text={item.text} />
          <CopyButton text={item.text} />
        </div>
      );
    case "thought":
      return <Thought text={item.text} />;
    case "tool":
      return (
        <div className="py-1">
          <ToolCallCard call={item.call} />
        </div>
      );
    case "plan":
      return (
        <div className="my-2 rounded-md border border-border px-3 py-2">
          {item.entries.map((e, i) => (
            <div key={i} className={clsx("flex items-start gap-2 py-0.5", e.status === "completed" && "text-muted line-through")}>
              {e.status === "completed" ? (
                <CircleCheck size={13} className="mt-0.5 shrink-0 text-add-fg" />
              ) : e.status === "in_progress" ? (
                <CircleDot size={13} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <Circle size={13} className="mt-0.5 shrink-0 text-faint" />
              )}
              <span>{e.content}</span>
            </div>
          ))}
        </div>
      );
    case "turnEnd": {
      const took = item.startedAt ? duration(item.ts - item.startedAt) : null;
      return (
        <div className="flex items-center gap-2 py-2 text-[11px] text-faint">
          <span className="h-px flex-1 bg-border" />
          {item.stopReason === "end_turn"
            ? took && `Worked for ${took}`
            : `Stopped (${item.stopReason.replace(/_/g, " ")})${took ? ` after ${took}` : ""}`}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    }
    case "error":
      return (
        <div className="selectable my-2 rounded-md border border-del-fg/30 bg-del-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap text-del-fg">
          {item.text}
        </div>
      );
  }
});

/** A queued follow-up: dismiss it, or edit it (which holds the queue until saved). */
function QueuedMessage({ sessionId, index, text }: { sessionId: string; index: number; text: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editing;
  // Leaving the chat mid-edit must not leave the queue paused forever.
  useEffect(() => () => void (editingRef.current && actions.holdQueue(sessionId, false)), [sessionId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, editing]);

  const start = () => {
    setValue(text);
    setEditing(true);
    actions.holdQueue(sessionId, true);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(text.length, text.length);
    });
  };
  const finish = (save: boolean) => {
    if (save) actions.editQueued(sessionId, index, value);
    setEditing(false);
    actions.holdQueue(sessionId, false);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-accent/50 bg-bg p-1.5">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finish(false);
            }
          }}
          className="selectable block w-full resize-none bg-transparent px-1 text-xs leading-relaxed outline-none"
        />
        <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-faint">
          <span>Queue paused while editing</span>
          <span className="flex-1" />
          <button onClick={() => finish(false)} className="rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button onClick={() => finish(true)} className="rounded bg-accent px-2 py-0.5 font-medium text-accent-fg">
            Save
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-xs text-muted">
      <Clock size={11} className="mt-0.5 shrink-0" />
      <span className="line-clamp-2 min-w-0 flex-1 cursor-text whitespace-pre-wrap" onClick={start} title="Click to edit">
        {text}
      </span>
      <button onClick={start} className="shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-fg" title="Edit">
        <Pencil size={11} />
      </button>
      <button onClick={() => actions.unqueue(sessionId, index)} className="shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-fg" title="Remove from queue">
        <X size={11} />
      </button>
    </div>
  );
}

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      title="Copy"
      className="absolute -right-7 top-2 rounded p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-fg"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-1 text-muted">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs">
        <Brain size={12} /> Thinking
        <ChevronRight size={12} className={clsx("transition-transform", open && "rotate-90")} />
      </button>
      {open && <div className="selectable mt-1 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

/** Plan text of a plan-approval request (Claude's ExitPlanMode and similar). */
function planText(toolCall: any): string | null {
  if (typeof toolCall?.rawInput?.plan === "string") return toolCall.rawInput.plan;
  const texts = (toolCall?.content ?? [])
    .filter((c: any) => c?.type === "content" && c.content?.type === "text")
    .map((c: any) => c.content.text);
  return texts.length ? texts.join("\n\n") : null;
}

function PermissionPrompt({ sessionId, permission }: { sessionId: string; permission: Permission }) {
  const title = permission.toolCall?.title ?? "The agent wants to run a tool";
  const plan = planText(permission.toolCall);
  return (
    <div className="mb-2 rounded-lg border border-warn/50 bg-elevated p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <ShieldQuestion size={14} className="shrink-0 text-warn" />
        <span className={clsx(plan ? "font-medium" : "font-mono text-[12px]")}>{title}</span>
      </div>
      {plan && (
        <div className="mb-3 max-h-80 overflow-y-auto rounded-md border border-border bg-bg px-3 py-2">
          <Markdown text={plan} />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {permission.options.map((o) => (
          <button
            key={o.optionId}
            onClick={() => actions.respondPermission(sessionId, permission.requestId, o.optionId)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              o.kind.startsWith("allow") ? "bg-accent text-accent-fg" : "border border-border hover:bg-hover",
            )}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
  const agentId = useStore((s) => (s.sessions[workspaceId] ?? []).find((x) => x.id === sessionId)?.agentId ?? "claude");
  const draft = useStore((s) => s.drafts[sessionId] ?? "");
  const state = useStore((s) => s.views[sessionId]?.state ?? "disconnected");
  const config = useStore((s) => s.views[sessionId]?.config) ?? EMPTY_CONFIG;
  const usage = useStore((s) => s.views[sessionId]?.transcript.usage);
  const plan = useStore((s) => s.views[sessionId]?.plan ?? false);
  // Permission modes are replaced by Runner's plan / auto-accept toggle.
  // Model, effort and fast live in the model picker.
  const picked = new Set([modelOption(config), effortOption(config), fastOption(config)].filter(Boolean));
  const visibleConfig = config.filter(
    (c) => c.category !== "mode" && c.id !== "mode" && c.id !== "collaboration_mode" && !picked.has(c),
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const running = state === "running";

  useEffect(() => {
    ref.current?.focus();
  }, [sessionId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [draft]);

  const queued = useStore((s) => s.views[sessionId]?.queued) ?? EMPTY_QUEUE;
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [matches, setMatches] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    actions.setDraft(sessionId, "");
    // While the agent works, follow-ups wait and go out when the turn ends.
    if (running) actions.queue(sessionId, text);
    else void actions.send(sessionId, text);
  };

  const updateMention = (text: string, caret: number) => {
    const m = mentionAt(text, caret);
    setMention(m);
    if (!m) return;
    void workspaceFiles(workspaceId).then((files) => {
      setMatches(rankFiles(files, m.query));
      setMentionIndex(0);
    });
  };

  const insertMention = (path: string) => {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart;
    const next = `${draft.slice(0, mention.start)}@${path} ${draft.slice(caret)}`;
    actions.setDraft(sessionId, next);
    setMention(null);
    const pos = mention.start + path.length + 2;
    requestAnimationFrame(() => el.setSelectionRange(pos, pos));
  };
  const mentionOpen = !!mention && matches.length > 0;

  return (
    <div className="relative rounded-xl border border-border bg-elevated shadow-sm focus-within:border-accent/60">
      {mentionOpen && (
        <div className="absolute bottom-full left-2 z-30 mb-1 w-[min(520px,90%)] overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-xl">
          {matches.map((f, i) => {
            const slash = f.lastIndexOf("/");
            return (
              <button
                key={f}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(f);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                className={clsx("flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs", i === mentionIndex && "bg-hover")}
              >
                <span className="font-medium">{f.slice(slash + 1)}</span>
                <span className="truncate text-muted">{slash > 0 ? f.slice(0, slash) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
      {queued.length > 0 && (
        <div className="space-y-1 border-b border-border px-3 pt-2 pb-2">
          {queued.map((q, i) => (
            <QueuedMessage key={`${i}:${q}`} sessionId={sessionId} index={i} text={q} />
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => {
          actions.setDraft(sessionId, e.target.value);
          updateMention(e.target.value, e.target.selectionStart);
        }}
        onBlur={() => setMention(null)}
        onKeyDown={(e) => {
          if (mentionOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
            e.preventDefault();
            if (e.key === "ArrowDown") setMentionIndex((i) => Math.min(matches.length - 1, i + 1));
            else if (e.key === "ArrowUp") setMentionIndex((i) => Math.max(0, i - 1));
            else if (e.key === "Escape") setMention(null);
            else insertMention(matches[mentionIndex]);
            return;
          }
          if (e.metaKey && e.shiftKey && (e.key === "/" || e.key === "?")) {
            e.preventDefault();
            cycleEffort(sessionId, config);
          } else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "e") {
            e.preventDefault();
            toggleFast(sessionId, config);
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            void actions.togglePlan(sessionId);
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && running) {
            void actions.cancel(sessionId);
          }
        }}
        rows={1}
        placeholder={running ? "Queue a follow-up… (Esc to stop)" : "Ask the agent to do something · @ to mention a file"}
        className="selectable block max-h-72 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2 whitespace-nowrap">
        <button
          onClick={() => actions.togglePlan(sessionId)}
          title={
            plan
              ? "Plan: the agent plans first and asks before making changes. Shift+Tab to switch."
              : "Auto: the agent edits files and runs commands without asking. Shift+Tab to switch."
          }
          className={clsx(
            "flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium",
            plan ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover hover:text-fg",
          )}
        >
          {plan ? <ListChecks size={12} /> : <ChevronsRight size={12} />}
          {plan ? "Plan" : "Auto"}
          <kbd className="ml-0.5 font-sans font-normal text-faint">⇧⇥</kbd>
        </button>
        <span className="mx-0.5 h-3.5 w-px bg-border" />
        <ModelPicker sessionId={sessionId} workspaceId={workspaceId} agentId={agentId} config={config} />
        {visibleConfig.map((c) => (
          <ConfigControl key={c.id} sessionId={sessionId} option={c} />
        ))}
        <div className="flex-1" />
        {usage && usage.size > 0 && <ContextUsage used={usage.used} size={usage.size} />}
        {running ? (
          <button onClick={() => actions.cancel(sessionId)} title="Stop (Esc)" className="rounded-md bg-fg p-1.5 text-bg">
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!draft.trim()}
            title="Send (Enter)"
            className="rounded-md bg-accent p-1.5 text-accent-fg disabled:opacity-40"
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

const EMPTY_CONFIG: ConfigOption[] = [];
const EMPTY_QUEUE: string[] = [];

function compact(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

/** "28.5k / 1M" with a fill ring; turns amber/red as the window fills up. */
function ContextUsage({ used, size }: { used: number; size: number }) {
  const ratio = Math.min(1, used / size);
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const tone = ratio > 0.9 ? "text-del-fg" : ratio > 0.7 ? "text-warn" : "text-muted";
  return (
    <span
      className={clsx("mr-1 flex shrink-0 items-center gap-1.5 text-[11px]", tone)}
      title={`Context window: ${used.toLocaleString()} of ${size.toLocaleString()} tokens used (${Math.round(ratio * 100)}%)`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${ratio * c} ${c}`} strokeLinecap="round" />
      </svg>
      {compact(used)} / {compact(size)}
    </span>
  );
}

const isOnOff = (values: string[]) => values.length === 2 && values.includes("on") && values.includes("off");

/** Labels that make sense on their own: "Opus 5.5", "High effort", "⚡ Fast". */
function ConfigControl({ sessionId, option }: { sessionId: string; option: ConfigOption }) {
  const flat: SelectOption[] = (option.options ?? []).flatMap((o: any) => ("options" in o ? o.options : [o]));
  const tooltip = [option.name, option.description].filter(Boolean).join(" — ");

  // On/off switches render as a toggle chip labelled with the option's name.
  if (option.type === "boolean" || isOnOff(flat.map((o) => o.value))) {
    const on = option.type === "boolean" ? !!option.currentValue : option.currentValue === "on";
    const next = option.type === "boolean" ? !on : on ? "off" : "on";
    const isFast = /fast/i.test(option.id + option.name);
    return (
      <button
        onClick={() => actions.setConfig(sessionId, option.id, next)}
        title={`${tooltip} (${on ? "on" : "off"})`}
        className={clsx(
          "flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs",
          on ? "bg-warn/15 font-medium text-warn" : "text-faint hover:bg-hover hover:text-fg",
        )}
      >
        {isFast && <Zap size={11} fill={on ? "currentColor" : "none"} />}
        {isFast ? "Fast" : option.name}
      </button>
    );
  }

  const current = flat.find((o) => o.value === option.currentValue);
  const currentName = current?.name ?? String(option.currentValue);
  const label =
    option.category === "model"
      ? currentName
      : option.category === "thought_level"
        ? `${currentName} effort`
        : `${option.name}: ${currentName}`;
  return (
    <label className="relative shrink-0 rounded px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg" title={tooltip}>
      {option.category === "thought_level" && <Brain size={11} className="mr-1 inline -translate-y-px" />}
      {label}
      <select
        value={String(option.currentValue)}
        onChange={(e) => actions.setConfig(sessionId, option.id, e.target.value)}
        className="absolute inset-0 opacity-0"
      >
        {flat.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
