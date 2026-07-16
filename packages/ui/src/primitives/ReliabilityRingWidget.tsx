import { Panel } from "./Panel";
import styles from "./ReliabilityRingWidget.module.scss";

// SVG geometry for the donut. A 140-unit box with a 56-unit radius leaves room
// for the 16-unit stroke without clipping; every arc is drawn from 12 o'clock by
// rotating the value circle -90°.
const BOX = 140;
const CENTER = BOX / 2;
const RADIUS = 56;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The visual tone of a segment, mapped to a palette color in the stylesheet. */
export type ReliabilityTone = "success" | "harnessError" | "timeout";

/** One outcome slice of the ring: its share is `value / totalRuns`. */
export interface ReliabilitySegment {
  /** Label shown in the legend, e.g. "Timeouts". */
  label: string;
  /** How many of the model's runs ended in this outcome. */
  value: number;
  /** Which palette color the arc and legend swatch use. */
  tone: ReliabilityTone;
}

interface ReliabilityRingWidgetProps {
  /** Heading naming the widget, e.g. "Reliability". */
  title: string;
  /** The outcome slices, drawn as arcs in order from 12 o'clock. */
  segments: ReliabilitySegment[];
  /** The model's total runs (the denominator, and the ring's full track). */
  totalRuns: number;
}

// Format a share for the legend: an exact "0%" when there are none, a "<1%" floor
// so a rare-but-present outcome never rounds away to zero, and a rounded whole
// percent otherwise.
function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// A multi-segment ring gauge of a model's run outcomes: each segment (completed,
// harness error, timeout) is an arc sized by its share of the model's runs, drawn
// consecutively from 12 o'clock, with a legend giving each raw tally. The center
// shows the total. Only *published* runs count — the same set the model page shows
// — so this reads as the model's published reliability breakdown. Any run whose
// state is not one of the segments (e.g. a catastrophic build) is the uncolored
// remainder of the track.
export function ReliabilityRingWidget({
  title,
  segments,
  totalRuns,
}: ReliabilityRingWidgetProps) {
  // Lay each segment's arc end-to-end from 12 o'clock, tracking the running start
  // so the next arc begins where the previous one ended.
  let startFraction = 0;
  const arcs = segments.map((segment) => {
    const fraction = totalRuns > 0 ? segment.value / totalRuns : 0;
    const dash = fraction * CIRCUMFERENCE;
    // strokeDashoffset shifts the dash's start clockwise from 12 o'clock by the
    // arcs already laid down.
    const offset = -startFraction * CIRCUMFERENCE;
    startFraction += fraction;
    return { ...segment, fraction, dash, offset };
  });

  return (
    <Panel>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      {totalRuns === 0 ? (
        <p className={styles.empty}>
          No runs yet — the reliability breakdown appears once this model has
          runs.
        </p>
      ) : (
        <div className={styles.body}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${BOX} ${BOX}`}
            role="img"
            aria-label={ariaLabel(arcs, totalRuns)}
          >
            {/* The full track (every run) sits under the value arcs. */}
            <circle
              className={styles.track}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              strokeWidth={STROKE}
            />
            {/* Each outcome arc, drawn clockwise from 12 o'clock. Rendered only
                when it has a share, so a zero segment adds no invisible stroke. */}
            {arcs.map((arc) =>
              arc.dash > 0 ? (
                <circle
                  key={arc.tone}
                  className={`${styles.value} ${styles[arc.tone]}`}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  strokeWidth={STROKE}
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={arc.offset}
                  transform={`rotate(-90 ${CENTER} ${CENTER})`}
                />
              ) : null,
            )}
            <text
              className={styles.total}
              x={CENTER}
              y={CENTER}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {totalRuns}
            </text>
            <text
              className={styles.totalLabel}
              x={CENTER}
              y={CENTER + 22}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {totalRuns === 1 ? "run" : "runs"}
            </text>
          </svg>
          <ul className={styles.legend}>
            {arcs.map((arc) => (
              <li key={arc.tone} className={styles.legendItem}>
                <span className={`${styles.swatch} ${styles[arc.tone]}`} />
                <span className={styles.legendLabel}>{arc.label}</span>
                <span className={styles.legendValue}>
                  {arc.value} · {formatPercent(arc.fraction)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// A screen-reader summary of the breakdown: each segment's share and tally.
function ariaLabel(
  arcs: { label: string; value: number; fraction: number }[],
  totalRuns: number,
): string {
  const parts = arcs.map(
    (arc) =>
      `${formatPercent(arc.fraction)} ${arc.label.toLowerCase()} (${arc.value})`,
  );
  return `Of this model's ${totalRuns} runs: ${parts.join(", ")}`;
}
