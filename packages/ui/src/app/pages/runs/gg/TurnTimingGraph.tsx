// Where each turn's wall-clock went: a stacked bar per turn, split into the three
// phases every gg turn passes through — assembling the prompt, waiting on the model,
// and handling the response (see gg/telemetry/turn-timing.md). A run that feels slow is slow in
// one of the three, and the turn's total says which only by accident; this graph is
// what makes that a reading rather than a guess.
//
// gg derives the response phase as the remainder of the turn, so the three always sum
// to exactly the turn's duration — the stack has no gap and each bar's height IS the
// turn. Hovering a bar shows the turn's raw figures, with the hovered phase marked.
//
// The graph draws at most `MAX_BARS` turns at once. Past that the bars are too narrow
// to compare, which is the whole point of the chart, so instead of shrinking them the
// view windows: a size control picks how many turns are in frame and a range control
// slides that frame over the run. The frame follows the newest turn until the reader
// moves it, so a live run keeps showing its latest work without being dragged.

import { useMemo, useState } from "react";
import {
  Chart,
  stackedBarChart,
  type ChartPalette,
  type StackedBarSegment,
  type StackedSeries,
} from "@clockwyrks/ui";
import { turnTotalMs, type TurnTiming } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

// The most bars the graph will draw at once. Beyond this the columns stop being
// comparable, so the view windows rather than narrowing them further.
export const MAX_BARS = 50;

// The selectable window sizes, smallest first. All are <= MAX_BARS by construction —
// the cap is the largest of them — and a size larger than the run's turn count is
// simply not offered.
export const WINDOW_SIZES: readonly number[] = [10, 25, MAX_BARS];

// One phase of a turn: how to pull it, its fixed color, and the legend/tooltip name.
// The order is the bottom-to-top stacking order, which mirrors the order the phases
// actually happen in — so a bar reads chronologically from the axis up.
export interface Phase {
  key: string;
  label: string;
  color: string;
  ms: (t: TurnTiming) => number;
}

export const PHASES: readonly Phase[] = [
  {
    key: "prompt",
    label: "Prompt construction",
    color: "#6ea8fe",
    ms: (t) => t.promptMs,
  },
  {
    key: "request",
    label: "Request",
    color: "#c77dff",
    ms: (t) => t.requestMs,
  },
  {
    key: "response",
    label: "Response processing",
    color: "#ff924c",
    ms: (t) => t.responseMs,
  },
];

const SERIES: readonly StackedSeries[] = PHASES.map((p) => ({
  name: p.label,
  color: p.color,
}));

// A duration in the largest unit that keeps it readable, with enough precision that
// two adjacent bars can be told apart: sub-second stays in whole milliseconds, seconds
// carry one decimal, and anything past a minute reads as `m:ss`.
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  // 59.6s rounds to 60 and would render as `2m 60s`; carry it into the minute.
  return seconds === 60
    ? `${minutes + 1}m 00s`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// The tooltip for one segment: the whole turn's raw figures, with the hovered phase
// marked. Every segment of a bar carries the same breakdown — the reader is asking
// about the bar, not just the band their pointer happened to land on — and the marker
// is what tells them which band that was.
export function tooltipFor(timing: TurnTiming, hovered: Phase): string {
  const total = turnTotalMs(timing);
  const lines = PHASES.map((phase) => {
    const ms = phase.ms(timing);
    // A turn with no measured time at all (both figures floor to 0ms) has no shares to
    // report; showing "NaN%" would be worse than showing none.
    const share = total > 0 ? ` (${Math.round((ms / total) * 100)}%)` : "";
    const mark = phase.key === hovered.key ? "▸ " : "   ";
    return `${mark}${phase.label}: ${formatMs(ms)}${share}`;
  });
  return [`Turn ${timing.turn}: ${formatMs(total)} total`, ...lines].join("\n");
}

// The turns in frame: `size` of them ending at `start`, clamped so the frame never
// runs off either end of the run. A `start` of null follows the newest turn.
export function windowOf(
  timings: readonly TurnTiming[],
  size: number,
  start: number | null,
): { slice: readonly TurnTiming[]; start: number; maxStart: number } {
  const maxStart = Math.max(0, timings.length - size);
  // Clamping (rather than trusting the stored start) is what keeps a frame parked
  // mid-run valid as the run grows and as the size control changes under it.
  const clamped = Math.min(Math.max(start ?? maxStart, 0), maxStart);
  return {
    slice: timings.slice(clamped, clamped + size),
    start: clamped,
    maxStart,
  };
}

// The most x-axis labels that fit across the graph without running together. A frame
// wider than this labels every Nth bar instead of every bar — the bars themselves stay
// one per turn, only their names thin out.
const MAX_TICKS = 12;

// Which bars get a labeled tick: every one while they fit, then every Nth. The stride
// is chosen so the last bar in frame is always labeled, which is the one a reader
// checking a live run looks for first.
export function axisTicks(labels: readonly string[]): readonly string[] {
  if (labels.length <= MAX_TICKS) return labels;
  const stride = Math.ceil(labels.length / MAX_TICKS);
  return labels.filter((_, i) => (labels.length - 1 - i) % stride === 0);
}

// The window sizes worth offering for a run of `turnCount` turns: the smallest always,
// then each size that shows more than the one below it already did. A 30-turn run is
// offered 50 (which frames all 30) but a 15-turn run is not — 25 already frames it, and
// a second option that draws the identical graph is a control that does nothing.
export function offeredSizes(turnCount: number): readonly number[] {
  return WINDOW_SIZES.filter(
    (_, i) => i === 0 || WINDOW_SIZES[i - 1]! < turnCount,
  );
}

export function TurnTimingGraph({ timings }: { timings: TurnTiming[] }) {
  // How many turns are in frame, and where the frame sits. `null` means "follow the
  // newest turn", which is what a live run wants until the reader looks back.
  const [size, setSize] = useState<number>(MAX_BARS);
  const [start, setStart] = useState<number | null>(null);

  // The frame opens as wide as the run allows and narrows on request. A stored size the
  // run has outgrown — or has not yet grown into, since a live run gains turns under a
  // mounted graph — falls back to the widest still on offer, so the select's value is
  // always one of its options.
  const sizes = offeredSizes(timings.length);
  const framedSize = sizes.includes(size) ? size : sizes[sizes.length - 1]!;

  const {
    slice,
    start: frameStart,
    maxStart,
  } = useMemo(
    () => windowOf(timings, framedSize, start),
    [timings, framedSize, start],
  );

  // One segment per phase per turn in frame. The group is the turn number, which is
  // the same axis the Context graph and the per-request metrics plot against.
  const data = useMemo<StackedBarSegment[]>(
    () =>
      slice.flatMap((timing) =>
        PHASES.map((phase) => ({
          group: String(timing.turn),
          series: phase.label,
          value: phase.ms(timing),
          title: tooltipFor(timing, phase),
        })),
      ),
    [slice],
  );

  // The bar order, stated rather than inferred: the turn axis is numeric, and an
  // ordinal domain Plot sorts for itself puts turn 100 before turn 70.
  const turnLabels = useMemo(
    () => slice.map((timing) => String(timing.turn)),
    [slice],
  );

  const spec = useMemo(
    () => (palette: ChartPalette) =>
      stackedBarChart(data, palette, SERIES, {
        y: "ms",
        yTickFormat: (v: number) => formatMs(v),
        xDomain: turnLabels,
        xTicks: axisTicks(turnLabels),
      }),
    [data, turnLabels],
  );

  if (timings.length === 0) {
    return (
      <p className={styles.metricEmpty}>
        Not recorded for this run. gg reports where a turn&apos;s time went once
        per turn.
      </p>
    );
  }

  // The controls appear only once there is more than one way to frame the run — below
  // that every size draws the same graph and the frame cannot move.
  const windowed = sizes.length > 1;
  const first = slice[0]?.turn ?? 0;
  const last = slice[slice.length - 1]?.turn ?? 0;
  // Page by a whole frame, so moving through a long run takes a handful of clicks
  // rather than one per turn; the slider is there for landing exactly.
  const page = (delta: number) => {
    const next = Math.min(
      Math.max(frameStart + delta * framedSize, 0),
      maxStart,
    );
    // Paging up to the newest turn re-arms following, exactly as the slider does.
    setStart(next >= maxStart ? null : next);
  };

  return (
    <section className={styles.metricCard}>
      <header className={styles.metricCardHead}>
        <span className={styles.metricCardLabel}>Time per turn</span>
        <span className={styles.metricCardLatest}>
          {windowed
            ? `turns ${first}–${last} of ${timings.length}`
            : `${timings.length} turn${timings.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {windowed && (
        <div className={styles.rangeControls}>
          <label className={styles.rangeLabel}>
            Show
            <select
              className={styles.rangeSelect}
              value={framedSize}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              {sizes.map((n) => (
                <option key={n} value={n}>
                  {n} turns
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.rangeStep}
            onClick={() => page(-1)}
            disabled={frameStart === 0}
            aria-label="Show earlier turns"
          >
            ◀
          </button>
          <input
            type="range"
            className={styles.rangeSlider}
            min={0}
            max={maxStart}
            value={frameStart}
            aria-label="First turn shown"
            onChange={(e) => {
              const next = Number(e.target.value);
              // Sliding back to the end re-arms following, so a reader who returns to
              // the newest turn is not left behind as a live run keeps going.
              setStart(next >= maxStart ? null : next);
            }}
          />
          <button
            type="button"
            className={styles.rangeStep}
            onClick={() => page(1)}
            disabled={frameStart >= maxStart}
            aria-label="Show later turns"
          >
            ▶
          </button>
        </div>
      )}

      <Chart
        title={`Where each turn's time went, turns ${first} to ${last}`}
        spec={spec}
      />
    </section>
  );
}
