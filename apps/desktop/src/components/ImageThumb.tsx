import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { api } from "../lib/api";

const cache = new Map<string, Promise<string>>();

function dataUrl(path: string) {
  let hit = cache.get(path);
  if (!hit) {
    hit = api.attachmentDataUrl(path);
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit;
}

/** An attached image: a thumbnail that opens full size on click. */
export function ImageThumb({ path, size = 64, onRemove }: { path: string; size?: number; onRemove?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    dataUrl(path)
      .then((u) => live && setSrc(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="group relative shrink-0" style={{ width: size, height: size }}>
      <button
        onClick={() => src && setOpen(true)}
        className={clsx("h-full w-full overflow-hidden rounded-md border border-border bg-bg", !src && "animate-pulse")}
        title="Open image"
      >
        {src && <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Remove"
          className="absolute -top-1.5 -right-1.5 hidden rounded-full border border-border bg-elevated p-0.5 text-muted shadow-sm group-hover:block hover:text-fg"
        >
          <X size={10} />
        </button>
      )}
      {open &&
        src &&
        createPortal(
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
            <img src={src} alt="" className="max-h-full max-w-full rounded-md shadow-2xl" />
          </div>,
          document.body,
        )}
    </div>
  );
}
