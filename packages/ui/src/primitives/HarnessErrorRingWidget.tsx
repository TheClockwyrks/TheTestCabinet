import { Panel } from "./Panel";
import styles from "./HarnessErrorRingWidget.module.scss";

// SVG geometry for the donut. A 140-unit box with a 56-unit radius leaves room
// for the 16-unit stroke without clipping; the arc is drawn from 12 o'clock by
// rotating the value circle -90°.
const BOX = 140;
const CENTER = BOX / 2;
const RADIUS = 56;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface HarnessErrorRingWidgetProps {
  /** Heading naming the widget, e.g. "Harness errors". */
  title: string;
  /** How many of the model's runs ended in a harness error. */
  harnessErrors: number;
  /** The model's total runs (the denominator). */
  totalRuns: number;
}

// Format the harness-error share for the center of the ring: an exact "0%" when
// there are none, a "<1%" floor so a rare-but-present error never rounds away to
// zero, and a rounded whole percent otherwise.
function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// A single-value ring gauge: the share of a model's runs that ended in a harness
// error (the model drove the agent harness to exit non-zero). The filled arc and
// the big center percentage are the harness-error fraction; the caption gives the
// raw tally. Only *published* runs count — the same set the model page shows — so
// this reads as "% of published harness errors out of all of the model's runs".
export function HarnessErrorRingWidget({
  title,
  harnessErrors,
  totalRuns,
}: HarnessErrorRingWidgetProps) {
  const fraction = totalRuns > 0 ? harnessErrors / totalRuns : 0;
  // The arc length of the filled portion; the rest of the circumference is the gap.
  const dash = fraction * CIRCUMFERENCE;

  return (
    <Panel>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      {totalRuns === 0 ? (
        <p className={styles.empty}>
          No runs yet — the harness-error rate appears once this model has runs.
        </p>
      ) : (
        <div className={styles.body}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${BOX} ${BOX}`}
            role="img"
            aria-label={`${formatPercent(fraction)} of this model's ${totalRuns} runs ended in a harness error`}
          >
            {/* The full track (every run) sits under the value arc. */}
            <circle
              className={styles.track}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              strokeWidth={STROKE}
            />
            {/* The harness-error arc, drawn clockwise from 12 o'clock. Rendered
                only when there is a share to show, so a 0% ring is a clean track. */}
            {dash > 0 && (
              <circle
                className={styles.value}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
              />
            )}
            <text
              className={styles.percent}
              x={CENTER}
              y={CENTER}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {formatPercent(fraction)}
            </text>
            <text
              className={styles.percentLabel}
              x={CENTER}
              y={CENTER + 22}
              textAnchor="middle"
              dominantBaseline="central"
            >
              harness errors
            </text>
          </svg>
          <p className={styles.caption}>
            {harnessErrors} of {totalRuns} {totalRuns === 1 ? "run" : "runs"}
          </p>
        </div>
      )}
    </Panel>
  );
}
