/** Thin draggable edge; place inside a `relative` panel. */
export function ResizeHandle({ edge, onPointerDown }: { edge: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={`group absolute top-0 bottom-0 z-20 w-2 cursor-col-resize ${edge === "right" ? "-right-1" : "-left-1"}`}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent/60 group-active:bg-accent" />
    </div>
  );
}
