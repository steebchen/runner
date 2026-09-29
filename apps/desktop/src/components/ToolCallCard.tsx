import { memo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, CircleDashed, FileEdit, FileText, Globe, Loader2, Search, Terminal, Trash2, Wrench, X } from "lucide-react";
import type { ToolCall, ToolContent } from "../lib/transcript";
import { lineDiff } from "../lib/diff";
import { highlightLine, languageFor } from "../lib/highlight";

const kindIcon: Record<string, typeof Wrench> = {
  read: FileText,
  edit: FileEdit,
  delete: Trash2,
  search: Search,
  execute: Terminal,
  fetch: Globe,
};

export const ToolCallCard = memo(function ToolCallCard({ call }: { call: ToolCall }) {
  const hasDiff = call.content?.some((c) => c.type === "diff");
  const [open, setOpen] = useState(false);
  const Icon = kindIcon[call.kind ?? ""] ?? Wrench;
  const expandable = !!call.content?.length || call.rawInput !== undefined;
  const showBody = open;

  return (
    <div className="rounded-md border border-border bg-elevated/60">
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px]"
      >
        <StatusIcon status={call.status} />
        <Icon size={13} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{call.title || call.kind || "Tool call"}</span>
        {hasDiff && <DiffStat content={call.content!} />}
        {expandable && <ChevronRight size={13} className={clsx("shrink-0 text-faint transition-transform", open && "rotate-90")} />}
      </button>
      {showBody && (
        <div className="selectable max-h-96 overflow-auto border-t border-border">
          {call.content?.length ? (
            call.content.map((c, i) => <ToolContentView key={i} content={c} />)
          ) : (
            <pre className="p-2.5 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{JSON.stringify(call.rawInput, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
});

function StatusIcon({ status }: { status?: string }) {
  if (status === "completed") return <Check size={13} className="shrink-0 text-add-fg" />;
  if (status === "failed") return <X size={13} className="shrink-0 text-del-fg" />;
  if (status === "in_progress") return <Loader2 size={13} className="shrink-0 animate-spin text-accent" />;
  return <CircleDashed size={13} className="shrink-0 text-faint" />;
}

function DiffStat({ content }: { content: ToolContent[] }) {
  let add = 0;
  let del = 0;
  for (const c of content) {
    if (c.type !== "diff") continue;
    for (const l of lineDiff(c.oldText ?? "", c.newText)) {
      if (l.type === "add") add++;
      else if (l.type === "del") del++;
    }
  }
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className="text-add-fg">+{add}</span> <span className="text-del-fg">−{del}</span>
    </span>
  );
}

function Code({ text, language }: { text: string; language: string | null }) {
  const html = highlightLine(text, language);
  return html === null ? <span className="min-w-0">{text}</span> : <span className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ToolContentView({ content }: { content: ToolContent }) {
  if (content.type === "diff") {
    const lines = lineDiff(content.oldText ?? "", content.newText);
    const language = languageFor(content.path);
    return (
      <div className="font-mono text-[11.5px] leading-[1.55]">
        <div className="sticky top-0 bg-elevated px-2.5 py-1 text-[11px] text-muted">{content.path}</div>
        {lines.map((l, i) => (
          <div
            key={i}
            className={clsx(
              "flex px-2.5 whitespace-pre-wrap",
              l.type === "add" && "bg-add-bg",
              l.type === "del" && "bg-del-bg",
              l.type === "gap" && "text-faint",
            )}
          >
            <span className={clsx("w-3.5 shrink-0 select-none", l.type === "add" && "text-add-fg", l.type === "del" && "text-del-fg")}>
              {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
            </span>
            <Code text={l.text} language={l.type === "gap" ? null : language} />
          </div>
        ))}
      </div>
    );
  }
  if (content.type === "content" && content.content.type === "text") {
    return <pre className="p-2.5 font-mono text-[11.5px] whitespace-pre-wrap">{content.content.text}</pre>;
  }
  return <div className="p-2.5 text-xs text-muted">[{content.type}]</div>;
}
