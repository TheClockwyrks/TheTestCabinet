import type { InProgressRun } from "../../client/types";
import styles from "./RunLog.module.scss";

// What the marker is called for each live phase. A validating run is told apart
// from a running one because the marker is often all a view shows of the phase —
// the status column can be hidden, and the selectable log's checkbox overlays it —
// and a model still at work is a different thing to wait on than a build being
// validated after the model has finished.
const MARKER_NAME: Readonly<Record<InProgressRun["state"], string>> = {
  queued: "Queued",
  pending: "Pending",
  starting: "Starting",
  running: "Running",
  validating: "Validating",
  storing: "Storing",
  failed: "Failed",
};

/**
 * The in-progress marker an active run log row shows in its caret gutter (and in
 * a phone card's corner): a spinning arc while the run is in flight, a checklist
 * whose lines fill in turn once the model has finished and its build is being
 * validated, and a frozen ring in the negative color once the run is observed to
 * have failed.
 *
 * `decorative` hides it from assistive technology, for the selectable log, where
 * it sits inside a checkbox whose own label names the control; it keeps its
 * tooltip either way.
 */
export function RunActiveMarker({
  state,
  decorative = false,
}: {
  state: InProgressRun["state"];
  decorative?: boolean;
}) {
  const name = MARKER_NAME[state];
  const validating = state === "validating";
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": name };
  return (
    <span
      className={validating ? styles.checklist : styles.spinner}
      data-state={state}
      title={name}
      {...a11y}
    >
      {validating && (
        <>
          <span className={styles.checklistLine} />
          <span className={styles.checklistLine} />
          <span className={styles.checklistLine} />
        </>
      )}
    </span>
  );
}
