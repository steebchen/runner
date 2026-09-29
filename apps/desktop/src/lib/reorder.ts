import { useRef, useState } from "react";

/**
 * Pointer-based drag-to-reorder for lists and grids. (HTML5 drag-and-drop
 * doesn't reach the page in Tauri's macOS webview, which handles drags itself.)
 *
 * Spread `itemProps(i)` on each item. A press that moves more than a few
 * pixels becomes a drag; the click that follows a drag is swallowed so the
 * item isn't also "clicked".
 */
export function useReorder<T>(items: T[], onReorder: (next: T[]) => void) {
  const els = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  const indexAt = (x: number, y: number) => {
    let best = -1;
    let bestDist = Infinity;
    els.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const dist = inside ? 0 : Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  };

  const itemProps = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      if (!Array.isArray(els.current)) els.current = [];
      els.current[index] = el;
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("select,input,[data-no-drag]")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let over = index;

      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        if (!dragging) {
          dragging = true;
          document.body.style.cursor = "grabbing";
        }
        ev.preventDefault();
        const i = indexAt(ev.clientX, ev.clientY);
        if (i >= 0) over = i;
        setDrag({ from: index, over });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        setDrag(null);
        if (!dragging) return;
        // Swallow the click that the browser fires after the drag.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        if (over !== index) {
          const next = items.slice();
          const [moved] = next.splice(index, 1);
          next.splice(over, 0, moved);
          onReorder(next);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  });

  return { itemProps, overIndex: drag && drag.over !== drag.from ? drag.over : null, dragIndex: drag?.from ?? null };
}
