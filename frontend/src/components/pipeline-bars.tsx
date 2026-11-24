import type { Pipeline } from "@/lib/types";
import { percent, stageLabel, stages } from "@/lib/format";

export function PipelineBars({ pipeline }: { pipeline: Pipeline }) {
  const max = Math.max(1, ...stages.map((s) => pipeline.counts[s] ?? 0));
  const summary = stages.map((s) => `${pipeline.counts[s] ?? 0} ${stageLabel[s].toLowerCase()}`).join(", ");
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-sm text-muted-foreground">
        Matched to contacted: <strong className="text-foreground">{percent(pipeline.matched_to_contacted_rate)}</strong>
      </p>
      <div role="img" aria-label={`Pipeline: ${summary}`} className="flex flex-col gap-2.5">
        {stages.map((s) => {
          const n = pipeline.counts[s] ?? 0;
          return (
            <div key={s} className="grid grid-cols-[120px_minmax(0,1fr)_24px] items-center gap-3">
              <span>{stageLabel[s]}</span>
              {n > 0 ? (
                <span className="block h-[22px] bg-chart-1" style={{ width: `${(n / max) * 100}%` }} />
              ) : (
                <span className="block h-[22px] border-l-2 border-input" />
              )}
              <span className={n > 0 ? "text-right font-semibold" : "text-right font-semibold text-muted-foreground"}>{n}</span>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">A lead moves to Contacted only after Gmail confirms the test send.</p>
    </div>
  );
}
