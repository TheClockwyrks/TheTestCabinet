// Import cycles, named.
//
// A cycle is the clearest "did not think about layering" signal there is, and it is
// invisible to every other metric on this page: a tree of small, well-annotated,
// low-complexity files can still be a knot. `graph.cycles` counts them; only this names
// them, and a name is what makes one actionable.
//
// It is a callout rather than another table because a cycle is a *finding* — when there
// are none the page says so once, in a line, rather than reserving a table for an empty
// state. And, per the site-wide stance, it is descriptive: nothing here influences the
// run's verdict, its review or whether it publishes.

import type { CodeAnalysisDocument } from "@test-cabinet/run-record/code-analysis";
import { formatCodeNumber } from "./codeFormat";
import styles from "./CodePanels.module.scss";

/** How many members of one cycle to name before summarising the rest. A cycle of four is
 * a design mistake worth reading in full; a cycle of forty is a fact about the tree, and
 * listing all forty buries everything after it. */
const MEMBERS_SHOWN = 6;

/** How many cycles to list. The count above is exact either way. */
const CYCLES_SHOWN = 8;

export function CodeCyclesCallout({
  document: analysis,
}: {
  document: CodeAnalysisDocument;
}) {
  // A finding of none is still the finding, so it is the same card rather than a line of
  // prose where the card would have been.
  if (analysis.cycles.length === 0) {
    return (
      <div className={styles.callout} role="note">
        <p className={styles.calloutTitle}>No import cycles</p>
        <p className={styles.calloutNote}>
          Every module in the graph depends in one direction.
        </p>
      </div>
    );
  }
  // Largest first — the biggest knot is the one to look at, and it is stable because the
  // document's cycles are themselves sorted index lists.
  const cycles = [...analysis.cycles]
    .sort((a, b) => b.length - a.length)
    .slice(0, CYCLES_SHOWN);
  const hidden = analysis.cycles.length - cycles.length;

  return (
    <div className={styles.callout} role="note">
      <p className={styles.calloutTitle}>
        {formatCodeNumber(analysis.cycles.length)} import{" "}
        {analysis.cycles.length === 1 ? "cycle" : "cycles"}
      </p>
      <ul className={styles.cycleList}>
        {cycles.map((cycle) => {
          const named = cycle
            .slice(0, MEMBERS_SHOWN)
            .map((index) => analysis.files[index]?.path ?? "?");
          const more = cycle.length - named.length;
          return (
            <li key={cycle.join(",")}>
              <span className={styles.cycleSize}>{cycle.length}</span>
              <span className={styles.cyclePath}>
                {named.join(" → ")}
                {more > 0 && ` → … (${more} more)`}
              </span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className={styles.caveat}>
          {formatCodeNumber(hidden)} smaller {hidden === 1 ? "cycle" : "cycles"}{" "}
          not listed.
        </p>
      )}
    </div>
  );
}
