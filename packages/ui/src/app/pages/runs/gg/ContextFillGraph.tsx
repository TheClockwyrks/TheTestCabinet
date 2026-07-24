// The context-window panel: how a gg agent's context fills over the run, broken
// down by source. Design intent (see gg/context-visibility.md) is a STACKED
// line/area graph of window composition over time, one band per `GgContextSource`
// in fixed order with a stable categorical palette. This stub renders the latest
// snapshot's composition as a simple stacked meter; the over-time graph lands in a
// later stage, fed by `contextSeries`.

import type { GgContextSource } from "@test-cabinet/run-record/gg";
import type { ContextSnapshot } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

// The nine context sources in their fixed, stable order (mirrors
// `GgContextSource::ALL`). Band order and colors are keyed to this list so the
// graph stays stable across turns; the later stage draws from the same order.
export const CONTEXT_SOURCES: readonly GgContextSource[] = [
  "system",
  "user_prompt",
  "assistant",
  "tool_output",
  "file_view",
  "skill",
  "memory",
  "task_list",
  "history",
] as const;

// Human-facing labels for each source, for legends and axes.
export const CONTEXT_SOURCE_LABELS: Record<GgContextSource, string> = {
  system: "System",
  user_prompt: "User prompt",
  assistant: "Assistant",
  tool_output: "Tool output",
  file_view: "File views",
  skill: "Skills",
  memory: "Memories",
  task_list: "Task list",
  history: "History",
};

interface ContextFillGraphProps {
  series: ContextSnapshot[];
  latest: ContextSnapshot | null;
}

export function ContextFillGraph({ series, latest }: ContextFillGraphProps) {
  if (!latest) {
    return (
      <p className={styles.empty}>
        No context breakdown yet — the context-visibility capability streams a
        snapshot each turn while it is enabled.
      </p>
    );
  }

  const total = latest.totalTokens || 1;
  const numberFmt = new Intl.NumberFormat("en-US");

  return (
    <div className={styles.stack}>
      {latest.fullness != null && latest.windowLimit != null && (
        <p className={styles.caption}>
          {numberFmt.format(latest.totalTokens)} /{" "}
          {numberFmt.format(latest.windowLimit)} tokens —{" "}
          {(latest.fullness * 100).toFixed(0)}% full · {series.length} snapshot
          {series.length === 1 ? "" : "s"}
        </p>
      )}
      <ul className={styles.sourceList}>
        {CONTEXT_SOURCES.map((source, i) => {
          const band = latest.bySource.find((b) => b.source === source);
          const tokens = band?.tokens ?? 0;
          const pct = (tokens / total) * 100;
          return (
            <li key={source} className={styles.sourceRow}>
              <span
                className={styles.swatch}
                data-source-index={i}
                aria-hidden="true"
              />
              <span className={styles.sourceName}>
                {CONTEXT_SOURCE_LABELS[source]}
              </span>
              <span className={styles.sourceTokens}>
                {numberFmt.format(tokens)}
              </span>
              <span className={styles.sourcePct}>{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
