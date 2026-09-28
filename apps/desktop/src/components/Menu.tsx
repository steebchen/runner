import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = { label: string; onSelect: () => void };

/** Minimal dropdown: click to open, click outside or Escape to close. */
export function Menu({ label, items, align = "right" }: { label: ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} className="rounded px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
        {label}
      </button>
      {open && (
        <div
          className={`absolute top-full z-40 mt-1 min-w-40 rounded-md border border-border bg-elevated p-1 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
