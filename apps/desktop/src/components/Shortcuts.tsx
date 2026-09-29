import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const GROUPS: [string, [string, string][]][] = [
  [
    "App",
    [
      ["⌘K", "Command palette"],
      ["⌘N", "New workspace"],
      ["⇧⌘N", "New workspace from a branch or PR"],
      ["⇧⌘O", "Add repository"],
      ["⌘1 – ⌘9", "Go to workspace"],
      ["⌘O", "Open workspace in editor"],
      ["⌘,", "Settings"],
      ["⌘/", "Keyboard shortcuts"],
    ],
  ],
  [
    "Chats",
    [
      ["⌘T", "New chat"],
      ["⌘W", "Close chat"],
      ["⇧⌘[  ⇧⌘]", "Previous / next chat"],
      ["⌘F", "Find in chat"],
    ],
  ],
  [
    "Composer",
    [
      ["↩", "Send (queues while the agent works)"],
      ["⇧↩", "New line"],
      ["Esc", "Stop the agent"],
      ["⇧⇥", "Switch Plan / Auto"],
      ["⇧⌘/", "Cycle effort"],
      ["⇧⌘E", "Toggle fast mode"],
      ["@  /", "Mention a file / run a command"],
      ["↑  ↓", "Earlier prompts"],
      ["⌘V", "Paste an image"],
    ],
  ],
  [
    "Changes",
    [
      ["↑ ↓  j k", "Next / previous file"],
      ["V", "Mark file as viewed"],
    ],
  ],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div className="max-h-[80vh] w-[640px] overflow-y-auto rounded-xl border border-border bg-elevated p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <span className="font-medium">Keyboard shortcuts</span>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map(([title, rows]) => (
            <div key={title}>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</div>
              {rows.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-1 text-[13px]">
                  <span>{label}</span>
                  <kbd className="shrink-0 rounded border border-border bg-bg px-1.5 py-px font-sans text-[11px] whitespace-pre text-muted">{keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
