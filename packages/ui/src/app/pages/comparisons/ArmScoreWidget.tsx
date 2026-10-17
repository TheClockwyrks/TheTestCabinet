import { useState } from "react";
import { SectionWidget } from "@clockwyrks/ui";
import type {
  ComparisonArmResult,
  ScorePoint,
} from "@clockwyrks/run-record/comparison";
import styles from "./ArmScoreWidget.module.scss";

interface ArmScoreWidgetProps {
  /** The comparison's arms, in the config's arm order. */
  arms: readonly ComparisonArmResult[];
  /** Each arm's identity color, by arm id. */
  colorForArm: ReadonlyMap<string, string>;
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * The score & pass-rate widget: every arm's score and pass rate, as a table a
 * comparison of many arms can still be scanned down: one row per arm with its average automated-only
 * score and its passed count, which opens in place onto the arm's pass-rate
 * meter and each run's score.
 *
 * An open row keeps its own figures, so the columns read unbroken down the
 * table whichever rows are open; the detail adds only what the row cannot say.
 */
export function ArmScoreWidget({ arms, colorForArm }: ArmScoreWidgetProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const allOpen = arms.length > 0 && arms.every((a) => open.has(a.arm.id));

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <SectionWidget
      title="Score & pass rate"
      hint="The automated-only score across each configuration's runs, and the pass rate with its Wilson 95% interval. Select a configuration to see its runs."
      actions={
        <button
          type="button"
          className={styles.toggleAll}
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(arms.map((a) => a.arm.id)))
          }
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      }
    >
      <div className={styles.frame}>
        <div className={styles.rows}>
          <div className={styles.headings} aria-hidden>
            <span>Configuration</span>
            <span className={styles.num}>Avg score</span>
            <span className={styles.num}>Passed</span>
            <span />
          </div>
          {arms.map((a) => (
            <ArmScoreRow
              key={a.arm.id}
              arm={a}
              color={colorForArm.get(a.arm.id)}
              open={open.has(a.arm.id)}
              onToggle={() => toggle(a.arm.id)}
            />
          ))}
        </div>
      </div>
    </SectionWidget>
  );
}

interface ArmScoreRowProps {
  arm: ComparisonArmResult;
  color: string | undefined;
  open: boolean;
  onToggle: () => void;
}

function ArmScoreRow({ arm: a, color, open, onToggle }: ArmScoreRowProps) {
  const detailId = `arm-score-${a.arm.id}`;
  // The jobs of the arm's cell it is still waiting on, stated rather than left
  // as a silent gap between the arm's `n` and its desired count. The same figure
  // the top-up counts, so the two never disagree.
  const inFlight = a.inFlight ?? 0;
  // Held runs whose record this build can no longer read: they keep their place
  // and contribute no figure.
  const unreadable = Math.max(0, (a.runIds?.length ?? 0) - a.nObserved);

  return (
    <>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className={styles.name}>
          <span
            className={styles.swatch}
            style={{ background: color }}
            aria-hidden
          />
          <span className={styles.label} title={a.arm.label}>
            {a.arm.label}
          </span>
        </span>
        <span className={`${styles.num} ${styles.score}`}>
          <span className={styles.inlineLabel}>avg </span>
          {a.score ? percent(a.score.meanFraction) : "—"}
        </span>
        <span className={`${styles.num} ${styles.passed}`}>
          <span className={styles.inlineLabel}>passed </span>
          {a.passRate ? (
            <>
              {a.passRate.passed}/{a.passRate.n}{" "}
              <span className={styles.muted}>{percent(a.passRate.rate)}</span>
            </>
          ) : (
            "—"
          )}
        </span>
        <span className={styles.chevron} aria-hidden>
          ›
        </span>
      </button>
      <div
        id={detailId}
        className={styles.detail}
        hidden={!open}
        style={color ? { ["--arm" as string]: color } : undefined}
      >
        <div className={styles.summary}>
          <p className={styles.muted}>
            n={a.nObserved} of {a.nDesired} desired
            {inFlight > 0 && ` · ${inFlight} still in flight`}
            {unreadable > 0 && ` · ${unreadable} unreadable`}
          </p>
          <div>
            <p className={styles.subhead}>Pass rate</p>
            {a.passRate ? (
              <>
                <div className={styles.meter}>
                  <span
                    className={styles.meterFill}
                    style={{ width: `${a.passRate.rate * 100}%` }}
                  />
                  <span
                    className={styles.meterInterval}
                    style={{
                      left: `${a.passRate.wilsonLow * 100}%`,
                      width: `${(a.passRate.wilsonHigh - a.passRate.wilsonLow) * 100}%`,
                    }}
                  />
                </div>
                <p className={styles.meterLabel}>
                  Wilson 95%: {percent(a.passRate.wilsonLow)}–
                  {percent(a.passRate.wilsonHigh)}
                </p>
              </>
            ) : (
              <p className={styles.muted}>No pass-rate data yet.</p>
            )}
          </div>
        </div>
        <div className={styles.runs}>
          <p className={styles.subhead}>Score per run</p>
          {a.score && a.score.points.length > 0 ? (
            <RunScoreColumns
              points={a.score.points}
              mean={a.score.meanFraction}
            />
          ) : (
            <p className={styles.muted}>No scored runs yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Each run's automated-only score as one column against the 0% and 100% levels,
 * with the arm's average dashed across them and labelled on the far side, where
 * it can never collide with the level labels. A run that earned every point is
 * drawn at full strength. The columns share the graph's width whatever the run
 * count.
 */
function RunScoreColumns({
  points,
  mean,
}: {
  points: readonly ScorePoint[];
  mean: number;
}) {
  return (
    <div className={styles.columnsGraph}>
      <div className={styles.levels} aria-hidden>
        <span style={{ top: 0 }}>100%</span>
        <span style={{ top: "100%" }}>0%</span>
      </div>
      <div className={styles.columns}>
        <span className={styles.fullLevel} aria-hidden />
        {points.map((p, i) => {
          const fraction = p.total > 0 ? p.earned / p.total : 0;
          const full = p.total > 0 && p.earned === p.total;
          return (
            <span
              key={i}
              className={
                full ? `${styles.column} ${styles.full}` : styles.column
              }
              style={{ height: `${Math.max(4, fraction * 100)}%` }}
              title={`${p.earned}/${p.total}`}
              aria-label={`run ${i + 1}: ${p.earned} of ${p.total} points`}
            />
          );
        })}
        <span
          className={styles.meanLine}
          style={{ bottom: `${mean * 100}%` }}
          aria-hidden
        />
      </div>
      <div className={styles.meanLabel}>
        <span style={{ top: `${(1 - mean) * 100}%` }}>avg {percent(mean)}</span>
      </div>
      <div className={styles.runSpan} aria-hidden>
        <span>run 1</span>
        <span>run {points.length}</span>
      </div>
    </div>
  );
}
