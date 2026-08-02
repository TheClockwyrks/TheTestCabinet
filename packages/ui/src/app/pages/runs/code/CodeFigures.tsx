// Every figure the analysis produced, by family.
//
// The sections above answer specific questions; this is the record behind them. It exists
// for two reasons and would be worth keeping for either: it is the table-view twin every
// chart on the page owes (no value is reachable only by hovering a rectangle), and it is
// where a figure that has no chart — the type-discipline ratios, the Rust `unwrap`
// density, the walk's own coverage notes — actually lives.
//
// Nothing here is hand-listed. The rows, their order, their labels, their units and their
// approximate markers all come from the generated catalog, so a metric added to the
// analyzer's summary appears here correctly the day it ships, and a renamed one fails the
// analyzer's own test rather than silently losing its label.

import type { CodeAnalysisSummary } from "@test-cabinet/run-record/code-analysis";
import {
  APPROXIMATE_MARK,
  APPROXIMATE_NOTE,
  codeFigureFamilies,
  familyHeading,
} from "./codeFormat";
import styles from "./CodePanels.module.scss";

export function CodeFigures({ summary }: { summary: CodeAnalysisSummary }) {
  const families = codeFigureFamilies(summary);
  const anyApproximate = families.some((family) =>
    family.figures.some((figure) => figure.approximate),
  );
  return (
    <div className={styles.figures}>
      {families.map((family) => (
        <section key={family.family} className={styles.figureFamily}>
          <h4 className={styles.figureHeading}>
            {familyHeading(family.family)}
          </h4>
          <dl className={styles.figureGrid}>
            {family.figures.map((figure) => (
              <div key={figure.path} className={styles.figureRow}>
                <dt title={`code.${figure.path}`}>
                  {figure.label}
                  {figure.approximate && (
                    <span
                      className={styles.approxMark}
                      title={APPROXIMATE_NOTE}
                    >
                      {APPROXIMATE_MARK}
                    </span>
                  )}
                </dt>
                <dd>{figure.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {anyApproximate && (
        <p className={styles.caveat}>
          {APPROXIMATE_MARK} {APPROXIMATE_NOTE}
        </p>
      )}
    </div>
  );
}
