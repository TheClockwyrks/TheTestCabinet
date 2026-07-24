// The context-window panel: how a gg agent's context fills over the run, broken
// down by source. Design intent (see gg/context-visibility.md) is a STACKED
// line/area graph of window composition over time — one band per `GgContextSource`
// in fixed order with a stable categorical palette — plus the fullness signal
// (total vs the window limit) surfaced prominently, since that is what compaction
// (Phase 2) acts on.
//
// gg streams a `context_breakdown` snapshot each turn while the context-visibility
// capability is on; `series` is those snapshots in order and `latest` is the most
// recent. We draw the over-time stacked area once there are two turns to connect,
// and always show the current per-source composition as a swatch legend (which
// doubles as the chart's key) beneath the fullness header.

import { useMemo } from "react";
import {
  Chart,
  stackedAreaChart,
  type ChartPalette,
  type StackedAreaMarker,
  type StackedAreaPoint,
  type StackedSeries,
} from "@test-cabinet/ui";
import type { GgContextSource } from "@test-cabinet/run-record/gg";
import {
  retainedSummary,
  shortTokens,
  type CompactionBoundary,
  type ContextSnapshot,
} from "./useGgRunState";
import styles from "./GgPanels.module.scss";

// The nine context sources in their fixed, stable order (mirrors
// `GgContextSource::ALL`). Band order and colors are keyed to this list so the
// graph stays stable across turns — a source is the same band, the same hue,
// everywhere.
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

// The stable categorical color per source, keyed to `CONTEXT_SOURCES` order.
// These MUST mirror `$context-palette` in GgPanels.module.scss (indexed by the
// same position) so a source reads as the same hue in the SVG bands, the legend
// swatches, and anywhere else it appears. They are fixed hues chosen to stay
// legible and distinguishable in both the light and dark console themes; the
// chart's axes/grid/reference still track the live theme via the Plot palette.
export const CONTEXT_SOURCE_COLORS: Record<GgContextSource, string> = {
  system: "#6ea8fe",
  user_prompt: "#ffca3a",
  assistant: "#8ac926",
  tool_output: "#ff924c",
  file_view: "#4cc9c0",
  skill: "#c77dff",
  memory: "#ff6b9d",
  task_list: "#b5e48c",
  history: "#9aa5b1",
};

// The chart's series, in fixed stacking/legend order (baseline = first source).
const AREA_SERIES: readonly StackedSeries[] = CONTEXT_SOURCES.map((source) => ({
  name: CONTEXT_SOURCE_LABELS[source],
  color: CONTEXT_SOURCE_COLORS[source],
}));

const numberFmt = new Intl.NumberFormat("en-US");

// Tokens held by one source in a snapshot (0 when the band is absent, though gg
// always emits all nine).
function sourceTokens(snapshot: ContextSnapshot, source: GgContextSource): number {
  return snapshot.bySource.find((b) => b.source === source)?.tokens ?? 0;
}

// The fullness fraction of a snapshot: the reported `fullness`, or total/limit
// when only the raw figures are present. Null when there is no window limit to
// measure against.
function snapshotFullness(snapshot: ContextSnapshot): number | null {
  if (snapshot.fullness != null) return snapshot.fullness;
  if (snapshot.windowLimit) return snapshot.totalTokens / snapshot.windowLimit;
  return null;
}

interface ContextFillGraphProps {
  series: ContextSnapshot[];
  latest: ContextSnapshot | null;
  // Compaction boundaries to mark on the graph — each drops the window (the
  // sawtooth's fall). Empty when compaction is off or never tripped.
  compactions?: CompactionBoundary[];
}

export function ContextFillGraph({
  series,
  latest,
  compactions = [],
}: ContextFillGraphProps) {
  // Flatten every snapshot into per-source points for the stacked area. Memoized
  // so the chart only re-plots when a new snapshot arrives.
  const points = useMemo<StackedAreaPoint[]>(
    () =>
      series.flatMap((snapshot) =>
        CONTEXT_SOURCES.map((source) => ({
          x: snapshot.turn,
          series: CONTEXT_SOURCE_LABELS[source],
          value: sourceTokens(snapshot, source),
        })),
      ),
    [series],
  );

  // The window limit to draw as the reference ceiling — the latest known limit.
  const windowLimit = latest?.windowLimit ?? null;

  // Compaction boundaries as vertical markers at their post-compaction turn, so the
  // fill-then-drop sawtooth is legible. Only those within the plotted turn range.
  const maxTurn = series.length ? series[series.length - 1]!.turn : 0;
  const markers = useMemo<StackedAreaMarker[]>(
    () =>
      compactions
        .filter((c) => c.turn <= maxTurn)
        .map((c) => ({ x: c.turn, label: "compacted" })),
    [compactions, maxTurn],
  );

  const spec = useMemo(
    () => (palette: ChartPalette) =>
      stackedAreaChart(points, palette, AREA_SERIES, {
        x: "turn",
        y: "tokens",
        yTickFormat: "~s",
        reference:
          windowLimit != null
            ? { value: windowLimit, label: "window limit" }
            : undefined,
        markers,
      }),
    [points, windowLimit, markers],
  );

  if (!latest) {
    return (
      <p className={styles.empty}>
        Context visibility not enabled — turn on the context-visibility capability
        to stream a per-source breakdown of the window each turn.
      </p>
    );
  }

  const total = latest.totalTokens || 1;
  const fullness = snapshotFullness(latest);

  return (
    <div className={styles.stack}>
      {/* Fullness header: the signal compaction acts on, surfaced prominently. */}
      <div className={styles.fullnessHead}>
        <div className={styles.fullnessFigure}>
          {fullness != null ? (
            <span className={styles.fullnessPct}>
              {(fullness * 100).toFixed(0)}%
            </span>
          ) : (
            <span className={styles.fullnessPct}>
              {numberFmt.format(latest.totalTokens)}
            </span>
          )}
          <span className={styles.fullnessTokens}>
            {numberFmt.format(latest.totalTokens)}
            {latest.windowLimit != null &&
              ` / ${numberFmt.format(latest.windowLimit)}`}{" "}
            tokens
            {" · turn "}
            {latest.turn}
          </span>
        </div>
        {fullness != null && (
          <div
            className={styles.fullnessBar}
            role="meter"
            aria-valuenow={Math.round(fullness * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Context window fullness"
          >
            <div
              className={styles.fullnessBarFill}
              data-level={
                fullness >= 0.9 ? "high" : fullness >= 0.7 ? "mid" : "low"
              }
              style={{ width: `${Math.min(fullness, 1) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* The over-time stacked area, once two turns exist to connect. */}
      {series.length >= 2 ? (
        <Chart
          title="Context window composition by source over the run"
          spec={spec}
        />
      ) : (
        <p className={styles.caption}>
          The composition graph appears once a second turn is recorded.
        </p>
      )}

      {/* Compaction boundaries: what each summarize-and-drop reclaimed and, per the
          retention contract, the pinned state it carried across verbatim. */}
      {compactions.length > 0 && (
        <ul className={styles.boundaryList}>
          {compactions.map((c) => (
            <li key={c.key} className={styles.boundaryRow}>
              <span className={styles.boundaryTick} aria-hidden="true" />
              <span className={styles.boundaryText}>
                <span className={styles.boundaryHead}>
                  Compacted at turn {c.turn}: {shortTokens(c.beforeTokens)} →{" "}
                  {shortTokens(c.afterTokens)} tokens
                </span>
                <span className={styles.boundaryRetained}>
                  retained {retainedSummary(c.retained)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Current per-source composition — also the chart's color legend. */}
      <ul className={styles.sourceList}>
        {CONTEXT_SOURCES.map((source, i) => {
          const tokens = sourceTokens(latest, source);
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
