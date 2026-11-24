"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function GraphCanvas({ children, className, fill = false }: { children: React.ReactNode; className?: string; fill?: boolean }) {
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, drawingHeight: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  const fit = size.drawingHeight ? Math.min(1, size.height / size.drawingHeight) : 1;
  const zoom = manualZoom ?? fit;

  useLayoutEffect(() => {
    const frame = viewport.current, content = drawing.current;
    if (!frame || !content) return;
    function measure() {
      if (!frame || !content) return;
      const width = frame.clientWidth, height = frame.clientHeight, drawingHeight = content.offsetHeight;
      setSize((old) => old.width === width && old.height === height && old.drawingHeight === drawingHeight ? old : { width, height, drawingHeight });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    function pinch(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setManualZoom((value) => Math.max(Math.min(fit, 0.5), Math.min(2.5, (value ?? fit) * Math.exp(-event.deltaY * 0.01))));
    }
    frame.addEventListener("wheel", pinch, { passive: false });
    return () => frame.removeEventListener("wheel", pinch);
  }, [fit]);

  return <div className={cn("relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-subtle", fill ? "min-h-32 flex-1" : "h-[min(48dvh,29rem)] min-h-52", className)}>
    <div ref={viewport} className="min-h-0 flex-1 overflow-auto">
      <div className="relative mx-auto flex min-h-full items-center justify-center overflow-clip" style={{ width: size.width ? Math.max(size.width, size.width * zoom) : "100%", height: size.drawingHeight * zoom }}>
        <div ref={drawing} className="absolute shrink-0" style={{ width: size.width || "100%", transform: `scale(${zoom})` }}>{children}</div>
      </div>
    </div>
    <div role="group" aria-label="Graph zoom" className="flex shrink-0 items-center justify-start gap-1 px-2 pb-2">
      <Button size="icon-xs" variant="outline" aria-label="Zoom out" disabled={zoom <= Math.min(fit, 0.5)} onClick={() => setManualZoom(Math.max(Math.min(fit, 0.5), zoom - 0.25))}><Minus aria-hidden /></Button>
      <output aria-label="Zoom level" className="min-w-9 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</output>
      <Button size="icon-xs" variant="outline" aria-label="Zoom in" disabled={zoom >= 2.5} onClick={() => setManualZoom(Math.min(2.5, zoom + 0.25))}><Plus aria-hidden /></Button>
      <Button size="xs" variant="outline" aria-label="Fit graph to page" title="Fit graph to page" onClick={() => setManualZoom(null)}><Maximize aria-hidden /> Fit</Button>
    </div>
  </div>;
}
