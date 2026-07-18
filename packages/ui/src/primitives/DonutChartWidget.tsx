import { Panel } from "./Panel";
import styles from "./DonutChartWidget.module.scss";

// SVG geometry for the donut. A 140-unit box with a 56-unit radius leaves room for
// the 16-unit stroke without clipping; every arc is drawn from 12 o'clock by
// rotating the value circle -90° (mirrors ReliabilityRingWidget so the two rings
// read identically).
const BOX = 140;
const CENTER = BOX / 2;
const RADIUS = 56;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** One slice of the donut: its share is `value / total`. */
export interface DonutSegment {
  /** Label shown in the legend. */
  label: string;
  /** How many items fall in this slice. */
  value: number;
  /**
   * The CSS color the arc and legend swatch use — any color string, including a
   * `var(--token)` reference, so a caller can drive it from live theme tokens.
   */
  color: string;
}

interface DonutChartWidgetProps {
  /** Heading naming the widget, e.g. "Test cases". */
  title: string;
  /** The slices, drawn as arcs in order from 12 o'clock. */
  segments: DonutSegment[];
  /**
   * The denominator (and the number shown in the ring's center). When it exceeds
   * the summed slice values, the shortfall shows through as the uncolored track —
   * e.g. reviews the ratings breakdown omits.
   */
  total: number;
  /** The unit shown under the center number, e.g. "reviews". */
  centerLabel: string;
  /** Shown in place of the ring when there is nothing to chart (`total === 0`). */
  emptyMessage: string;
  /**
   * Whether to draw the surrounding neon `Panel`. Defaults to `true` (a standalone
   * widget). Pass `false` to render just the ring, legend, and title — e.g. when
   * several charts share one enclosing panel and their own frames would nest.
   */
  framed?: boolean;
}

// Format a share for the legend: an exact "0%" when there are none, a "<1%" floor so
// a rare-but-present slice never rounds away to zero, and a rounded whole percent
// otherwise.
function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// A generic multi-segment ring gauge: each segment is an arc sized by its share of
// `total`, drawn consecutively from 12 o'clock, with a legend giving each raw tally
// and share. The center shows the total. Unlike ReliabilityRingWidget (whose slices
// are the fixed run-outcome tones), each slice carries its own color, so this suits
// an open-ended set of categories — test cases, models, or rating tiers.
export function DonutChartWidget({
  title,
  segments,
  total,
  centerLabel,
  emptyMessage,
  framed = true,
}: DonutChartWidgetProps) {
  // Lay each segment's arc end-to-end from 12 o'clock, tracking the running start so
  // the next arc begins where the previous one ended.
  let startFraction = 0;
  const arcs = segments.map((segment, index) => {
    const fraction = total > 0 ? segment.value / total : 0;
    const dash = fraction * CIRCUMFERENCE;
    // strokeDashoffset shifts the dash's start clockwise from 12 o'clock by the arcs
    // already laid down.
    const offset = -startFraction * CIRCUMFERENCE;
    startFraction += fraction;
    return { ...segment, key: `${index}-${segment.label}`, fraction, dash, offset };
  });

  const content = (
    <>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      {total === 0 ? (
        <p className={styles.empty}>{emptyMessage}</p>
      ) : (
        <div className={styles.body}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${BOX} ${BOX}`}
            role="img"
            aria-label={ariaLabel(title, arcs, total)}
          >
            {/* The full track (the denominator) sits under the value arcs. */}
            <circle
              className={styles.track}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              strokeWidth={STROKE}
            />
            {/* Each slice's arc, drawn clockwise from 12 o'clock. Rendered only when
                it has a share, so a zero slice adds no invisible stroke. */}
            {arcs.map((arc) =>
              arc.dash > 0 ? (
                <circle
                  key={arc.key}
                  className={styles.value}
                  style={{ stroke: arc.color }}
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
              {total}
            </text>
            <text
              className={styles.totalLabel}
              x={CENTER}
              y={CENTER + 22}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {centerLabel}
            </text>
          </svg>
          <ul className={styles.legend}>
            {arcs.map((arc) => (
              <li key={arc.key} className={styles.legendItem}>
                <span
                  className={styles.swatch}
                  style={{ background: arc.color }}
                />
                <span className={styles.legendLabel} title={arc.label}>
                  {arc.label}
                </span>
                <span className={styles.legendValue}>
                  {arc.value} · {formatPercent(arc.fraction)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // Unframed, the chart drops its own panel so several can share one enclosing card
  // without nesting neon frames.
  if (!framed) return <div className={styles.chart}>{content}</div>;
  return <Panel>{content}</Panel>;
}

// A screen-reader summary of the breakdown: each slice's share and tally.
function ariaLabel(
  title: string,
  arcs: { label: string; value: number; fraction: number }[],
  total: number,
): string {
  const parts = arcs.map(
    (arc) =>
      `${formatPercent(arc.fraction)} ${arc.label.toLowerCase()} (${arc.value})`,
  );
  return `${title}, ${total} total: ${parts.join(", ")}`;
}
