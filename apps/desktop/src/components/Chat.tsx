import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowUp, Brain, ChevronRight, Circle, CircleCheck, CircleDot, ShieldQuestion, Square } from "lucide-react";
import { actions, useStore, type Permission } from "../lib/store";
import type { Item } from "../lib/transcript";
import type { ConfigOption, SelectOption } from "../lib/api";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";

export function Chat({ sessionId }: { sessionId: string; workspaceId: string }) {
  const items = useStore((s) => s.views[sessionId]?.transcript.items) ?? EMPTY;
  const state = useStore((s) => s.views[sessionId]?.state ?? "disconnected");
  const loaded = useStore((s) => s.views[sessionId]?.loaded ?? false);
  const permissions = useStore((s) => s.views[sessionId]?.permissions) ?? EMPTY_PERMS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

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
  }, [items, virtualizer.getTotalSize(), permissions.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        {state === "running" && permissions.length === 0 && (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 pb-4 text-xs text-muted">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-accent" /> Working…
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-5 pb-4">
        {permissions.map((p) => (
          <PermissionPrompt key={p.requestId} sessionId={sessionId} permission={p} />
        ))}
        <Composer sessionId={sessionId} />
      </div>
    </div>
  );
}

const EMPTY: Item[] = [];
const EMPTY_PERMS: Permission[] = [];

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
        <div className="py-2">
          <Markdown text={item.text} />
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
    case "turnEnd":
      return item.stopReason === "end_turn" ? (
        <div className="h-2" />
      ) : (
        <div className="py-1 text-xs text-muted">Stopped ({item.stopReason.replace(/_/g, " ")})</div>
      );
    case "error":
      return (
        <div className="selectable my-2 rounded-md border border-del-fg/30 bg-del-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap text-del-fg">
          {item.text}
        </div>
      );
  }
});

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

function PermissionPrompt({ sessionId, permission }: { sessionId: string; permission: Permission }) {
  const title = permission.toolCall?.title ?? "The agent wants to run a tool";
  return (
    <div className="mb-2 rounded-lg border border-warn/50 bg-elevated p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <ShieldQuestion size={14} className="shrink-0 text-warn" />
        <span className="font-mono text-[12px]">{title}</span>
      </div>
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

function Composer({ sessionId }: { sessionId: string }) {
  const draft = useStore((s) => s.drafts[sessionId] ?? "");
  const state = useStore((s) => s.views[sessionId]?.state ?? "disconnected");
  const config = useStore((s) => s.views[sessionId]?.config) ?? EMPTY_CONFIG;
  const usage = useStore((s) => s.views[sessionId]?.transcript.usage);
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

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    actions.setDraft(sessionId, "");
    void actions.send(sessionId, text);
  };

  return (
    <div className="rounded-xl border border-border bg-elevated shadow-sm focus-within:border-accent/60">
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => actions.setDraft(sessionId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && running) {
            void actions.cancel(sessionId);
          }
        }}
        rows={1}
        placeholder={running ? "Agent is working… (Esc to stop)" : "Ask the agent to do something"}
        className="selectable block max-h-72 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        {config.map((c) => (
          <ConfigControl key={c.id} sessionId={sessionId} option={c} />
        ))}
        <div className="flex-1" />
        {usage && usage.size > 0 && (
          <span className="mr-1 text-[11px] text-faint" title={`${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens`}>
            {Math.round((usage.used / usage.size) * 100)}%
          </span>
        )}
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

function ConfigControl({ sessionId, option }: { sessionId: string; option: ConfigOption }) {
  if (option.type === "boolean") {
    return (
      <label className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-hover">
        <input type="checkbox" checked={!!option.currentValue} onChange={(e) => actions.setConfig(sessionId, option.id, e.target.checked)} />
        {option.name}
      </label>
    );
  }
  const flat: SelectOption[] = (option.options ?? []).flatMap((o: any) => ("options" in o ? o.options : [o]));
  const current = flat.find((o) => o.value === option.currentValue);
  return (
    <label className="relative rounded px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg" title={option.name}>
      {current?.name ?? String(option.currentValue)}
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
