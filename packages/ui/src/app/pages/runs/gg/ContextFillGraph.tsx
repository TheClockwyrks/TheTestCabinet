// The context-window panel: how a gg agent's context fills over the run, broken
// down by source. Design intent (see gg/context-visibility.md) is a STACKED
// line/area graph of window composition over time — one band per `GgContextSource`
// in fixed order with a stable categorical palette — plus the fullness signal
// (total vs the window limit) surfaced prominently, since that is what compaction
// (Phase 2) acts on.
//
// gg streams a `context_breakdown` snapshot each turn — context visibility is
// intrinsic, so this is unconditional; `series` is those snapshots in order and `latest` is the most
// recent. We draw the over-time stacked area once there are two turns to connect,
// and always show the current per-source composition as a swatch legend (which
// doubles as the chart's key) beneath the fullness header.
//
// The area reads as a shape; the figures behind it come on hover. Pointing at any
// turn marks it with a rule and gives that turn's whole composition — the window
// total and each band's tokens and share, with the band under the pointer marked —
// so a reader can put numbers on a bulge without leaving the graph.

import { useMemo } from "react";
import {
  Chart,
  stackedAreaChart,
  type ChartPalette,
  type StackedAreaMarker,
  type StackedAreaPoint,
  type StackedSeries,
} from "@test-cabinet/ui";
import type {
  GgCapabilitySet,
  GgContextSource,
} from "@test-cabinet/run-record/gg";
import {
  retainedSummary,
  shortTokens,
  type CompactionBoundary,
  type ContextSnapshot,
} from "./useGgRunState";
import { agentCapabilityOn, LEGACY_FILESYSTEM_CAP_ID } from "./ggCatalog";
import { formatPercent } from "./GgOverviewWidgets";
import styles from "./GgPanels.module.scss";

// The ten context sources in their fixed, stable order (mirrors
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
  "board",
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
  board: "Board",
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
  board: "#ef5350",
  history: "#9aa5b1",
};

// The capabilities each context source is the product of — a source whose
// capabilities are all ablated off cannot fill the window, so listing it is noise.
// Sources with no entry are unconditional: system/user prompt/assistant/tool output
// are what any run is made of, and history accrues in every run (a superseded block
// is retagged as history whether or not compaction ever fires).
const SOURCE_CAPABILITIES: Partial<Record<GgContextSource, readonly string[]>> =
  {
    // The umbrella capability that sets saved before the per-tool filesystem split
    // still name counts as read-file, exactly as gg resolves it.
    file_view: ["read-file", LEGACY_FILESYSTEM_CAP_ID],
    skill: ["skills"],
    memory: ["memories"],
    task_list: ["tasks"],
    board: ["project-management"],
  };

// How much room to leave above the tallest plotted stack, so the fill has somewhere
// to grow into rather than riding the top of the frame.
const Y_HEADROOM = 0.25;

const numberFmt = new Intl.NumberFormat("en-US");

// The top of the graph's y scale: the tallest stack plus [Y_HEADROOM] again, never
// above the window limit and never zero.
//
// Framing the plot to the window instead would draw a run that used 40k of a
// million-token window as a flat line along the axis — the composition the graph
// exists to show, unreadable. The window still caps the frame, so the fullness a
// stack represents is never overstated by the scale.
export function contextYMax(
  series: readonly ContextSnapshot[],
  windowLimit: number | null,
): number {
  const peak = series.reduce((max, s) => Math.max(max, s.totalTokens), 0);
  const capped = Math.max(Math.ceil(peak * (1 + Y_HEADROOM)), 1);
  return windowLimit != null ? Math.min(capped, windowLimit) : capped;
}

// The sources worth drawing and listing: the ones this run's configuration can
// produce, plus any that hold tokens regardless. The second clause is what keeps the
// filter honest — a band with real tokens is never hidden (that would drop it out of
// the stack and misstate the total), so an unexpected source still shows up.
export function visibleSources(
  set: GgCapabilitySet | null,
  series: readonly ContextSnapshot[],
  agent?: string | null,
): readonly GgContextSource[] {
  return CONTEXT_SOURCES.filter((source) => {
    const needed = SOURCE_CAPABILITIES[source];
    if (!needed) return true;
    // Before the capability set is known, show everything rather than guess a run's
    // shape from an empty configuration.
    if (!set) return true;
    // The graph is one agent's window, so the capabilities that decide which bands
    // it can hold are that agent's own — a task list enabled only on an implementer
    // fills that agent's window and nobody else's.
    if (needed.some((id) => agentCapabilityOn(set, agent, id))) return true;
    return series.some((snapshot) => sourceTokens(snapshot, source) > 0);
  });
}

// Tokens held by one source in a snapshot (0 when the band is absent, though gg
// always emits all ten).
function sourceTokens(
  snapshot: ContextSnapshot,
  source: GgContextSource,
): number {
  return snapshot.bySource.find((b) => b.source === source)?.tokens ?? 0;
}

// The tooltip for one band at one turn: that whole turn's composition, with the
// hovered source marked. A band's own height is the one thing the stack already
// shows — what it hides is the figures behind it and how the rest of the window
// compares — so every band at a turn carries the same breakdown, and the marker is
// what tells the reader which band they are pointed at. The rows are the graph's
// fixed source order, so the tip reads against the bands and the legend rather than
// re-sorting itself under the pointer.
export function contextTooltip(
  snapshot: ContextSnapshot,
  sources: readonly GgContextSource[],
  hovered: GgContextSource,
): string {
  const total = snapshot.totalTokens;
  const limit = snapshot.windowLimit;
  // How full the window is, the signal compaction acts on — omitted when the run
  // never reported a limit, since a share of an unknown ceiling is not a figure.
  const fullness =
    limit != null && limit > 0
      ? ` (${formatPercent(total / limit)} of window)`
      : "";
  const rows = sources.map((source) => {
    const tokens = sourceTokens(snapshot, source);
    // A turn holding nothing at all has no shares to report; "NaN%" would be worse
    // than showing none.
    const share = total > 0 ? ` (${formatPercent(tokens / total)})` : "";
    const mark = source === hovered ? "▸ " : "   ";
    return `${mark}${CONTEXT_SOURCE_LABELS[source]}: ${numberFmt.format(tokens)}${share}`;
  });
  return [
    `Turn ${snapshot.turn} — ${numberFmt.format(total)} tokens${fullness}`,
    ...rows,
  ].join("\n");
}

interface ContextFillGraphProps {
  series: ContextSnapshot[];
  latest: ContextSnapshot | null;
  // The run's configuration, which decides which sources are worth listing at all —
  // there is no reason to show a Skills band to an agent with skills disabled. Null
  // until gg announces it, which shows every source.
  capabilitySet?: GgCapabilitySet | null;
  // The profile the agent whose window this is runs under, so the bands are filtered
  // by *its* capabilities rather than the Root's. Absent falls back to the Root.
  agent?: string | null;
  // Compaction boundaries to mark on the graph — each drops the window (the
  // sawtooth's fall). Empty when compaction is off or never tripped.
  compactions?: CompactionBoundary[];
}

export function ContextFillGraph({
  series,
  latest,
  capabilitySet = null,
  agent = null,
  compactions = [],
}: ContextFillGraphProps) {
  // The sources this agent's configuration justifies drawing and listing.
  const sources = useMemo(
    () => visibleSources(capabilitySet, series, agent),
    [capabilitySet, series, agent],
  );

  // The chart's series, in fixed stacking/legend order (baseline = first source).
  const areaSeries = useMemo<readonly StackedSeries[]>(
    () =>
      sources.map((source) => ({
        name: CONTEXT_SOURCE_LABELS[source],
        color: CONTEXT_SOURCE_COLORS[source],
      })),
    [sources],
  );

  // Flatten every snapshot into per-source points for the stacked area, each carrying
  // its turn's full breakdown for the hover tooltip. Memoized so the chart only
  // re-plots when a new snapshot arrives.
  const points = useMemo<StackedAreaPoint[]>(
    () =>
      series.flatMap((snapshot) =>
        sources.map((source) => ({
          x: snapshot.turn,
          series: CONTEXT_SOURCE_LABELS[source],
          value: sourceTokens(snapshot, source),
          title: contextTooltip(snapshot, sources, source),
        })),
      ),
    [series, sources],
  );

  // The window limit to draw as the reference ceiling — the latest known limit.
  const windowLimit = latest?.windowLimit ?? null;

  // Frame the plot to what the run actually used rather than to the window.
  const yMax = useMemo(
    () => contextYMax(series, windowLimit),
    [series, windowLimit],
  );

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
      stackedAreaChart(points, palette, areaSeries, {
        x: "turn",
        y: "tokens",
        yTickFormat: "~s",
        // Only draw the ceiling when the frame reaches it; below that it would be a
        // rule pinned to the top of every plot, saying nothing.
        reference:
          windowLimit != null && windowLimit <= yMax
            ? { value: windowLimit, label: "window limit" }
            : undefined,
        yMax,
        markers,
      }),
    [points, areaSeries, windowLimit, yMax, markers],
  );

  if (!latest) {
    return (
      <p className={styles.empty}>
        No context breakdown yet — gg streams a per-source breakdown of the
        window on every turn.
      </p>
    );
  }

  const total = latest.totalTokens || 1;

  return (
    <div className={styles.stack}>
      {/* The fullness read-out that used to head this panel now lives on the agent's
          Overview as a ring in the identity header (see `ContextUsageRing`) — the
          signal compaction acts on belongs beside the agent's other whole-agent
          figures. This panel keeps the richer story: how the window's composition
          moved over the run. */}

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

      {/* Current per-source composition — also the chart's color legend. Only the
          sources this run can produce; the swatch index is the source's fixed
          position, not its position in the filtered list, so a hue never shifts. */}
      <ul className={styles.sourceList}>
        {sources.map((source) => {
          const tokens = sourceTokens(latest, source);
          const pct = (tokens / total) * 100;
          return (
            <li key={source} className={styles.sourceRow}>
              <span
                className={styles.swatch}
                data-source-index={CONTEXT_SOURCES.indexOf(source)}
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
