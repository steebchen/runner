import { useRef, useState } from "react";

/**
 * HTML5 drag-and-drop reordering for a list. Spread `itemProps(i)` on each
 * draggable element; `onReorder` receives the new order when dropped.
 */
export function useReorder<T>(items: T[], onReorder: (next: T[]) => void) {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const itemProps = (index: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      from.current = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (e: React.DragEvent) => {
      if (from.current === null) return;
      e.preventDefault();
      if (over !== index) setOver(index);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const start = from.current;
      from.current = null;
      setOver(null);
      if (start === null || start === index) return;
      const next = items.slice();
      const [moved] = next.splice(start, 1);
      next.splice(index, 0, moved);
      onReorder(next);
    },
    onDragEnd: () => {
      from.current = null;
      setOver(null);
    },
  });

  return { itemProps, overIndex: over };
}
