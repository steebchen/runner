import { useCallback, useRef, useState } from "react";

function load(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Drag-to-resize a panel. During the drag the width is written straight to the
 * element's style (no React re-render per mouse move); it's committed to state
 * and remembered in localStorage on release.
 */
export function useResizable(key: string, initial: number, min: number, max: number, edge: "right" | "left") {
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, load(key, initial))));
  const ref = useRef<HTMLElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const startX = e.clientX;
      const startW = el.getBoundingClientRect().width;
      let next = startW;
      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        next = Math.round(Math.min(max, Math.max(min, startW + (edge === "right" ? dx : -dx))));
        el.style.width = `${next}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        setWidth(next);
        try {
          localStorage.setItem(key, String(next));
        } catch {}
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    },
    [key, min, max, edge],
  );

  return { width, ref, onPointerDown };
}
