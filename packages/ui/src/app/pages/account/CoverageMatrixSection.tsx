import type {
  CoverageAxis,
  CoverageCell,
} from "@clockwyrks/backend-api/coverage";
import { useState } from "react";
import { Link } from "react-router";
import { useTestCaseName } from "../../data/useTestCaseName";
import {
  barWidths,
  cellKey,
  cellRunsHref,
  type MatrixGroup,
} from "./coveragePlan";
import { comboLabel } from "./comboLabels";
import { caseLabel } from "./caseLabels";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The label a cell's trigger controls carry: the play glyph followed by how much of
// the cell's shortfall the press buys. One run is the deliberate, one-at-a-time press
// a reviewer makes while judging a cell; the whole shortfall is the press they make
// once they have decided the cell is worth filling.
const TRIGGER_ONE = "▶ x1";
const TRIGGER_ALL = "▶ All";

// Why a cell's trigger controls are unpressable, or null when they are live. Each
// reason is said on the control itself rather than in a badge beside it, because the
// two buttons are the only thing on the row a reviewer can press and "why not" has to
// arrive with the press they attempted.
function triggerBlockedReason(
  cell: CoverageCell,
  canTrigger: boolean,
): string | null {
  if (cell.unlaunchable) return cell.unlaunchable;
  if (cell.remaining === 0) {
    return "Nothing missing: this cell's runs are counted or in flight.";
  }
  if (!canTrigger) {
    return "Connect a worker to launch runs by hand.";
  }
  return null;
}

// One block of the matrix: its header (title, qualifier, a stale-pin hint, and the
// block-wide progress rollup) is always shown; the per-cell rows are revealed only
// when expanded. Starts collapsed so a large plan reads as a scannable list of
// progress bars, mirroring the Inputs/Changelog accordion.
//
// Which axis the block is (a case, or a combination) follows the plan's ordering, so
// each row's label is the *other* axis — hence `axis` here rather than a fixed
// combination row label.
export function MatrixSection({
  group,
  axis,
  busy,
  canTrigger,
  onTrigger,
  onRetry,
}: {
  group: MatrixGroup;
  axis: CoverageAxis;
  busy: boolean;
  canTrigger: boolean;
  onTrigger: (cells: CoverageCell[]) => void;
  /** Retry a cell blocked by repeated infrastructure failures. */
  onRetry: (cell: CoverageCell) => void;
}) {
  const [open, setOpen] = useState(false);
  const testCaseName = useTestCaseName();
  const { cells, done, desired, donePct, flightPct } = group;
  const cell0 = cells[0]!;
  // A case-grouped block shares one pinned version, so its staleness belongs on the
  // header; a combination-grouped block spans every case, so it belongs per row.
  const headerStale = axis === "case" && cell0.stale;

  return (
    <section className={styles.group}>
      <header
        className={`${styles.groupHead} ${
          open ? "" : styles.groupHeadCollapsed
        }`}
      >
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.twisty} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={styles.groupTitle}>
            {group.title}
            {group.subtitle && (
              <span className={styles.groupVersion}>{group.subtitle}</span>
            )}
          </span>
        </button>
        <span className={styles.groupRight}>
          {group.blocked > 0 && (
            <span
              className={styles.blockedBadge}
              title="Cells whose last 3 runs failed on infrastructure. Expand the block to retry them."
            >
              {group.blocked} blocked
            </span>
          )}
          {group.unreviewed > 0 && (
            <span
              className={styles.waitingBadge}
              title="Completed runs here that you have not reviewed. Informational: reviews never launch or hold back runs."
            >
              {group.unreviewed} to review
            </span>
          )}
          {headerStale && (
            <span
              className={styles.staleBadge}
              title={`A newer version (${cell0.latestVersion}) is ingested. Bump the pin from the plan editor.`}
            >
              {cell0.version} → {cell0.latestVersion} ↑
            </span>
          )}
          <span
            className={styles.groupProgress}
            title={`${done} of ${desired} runs across every cell in this block`}
          >
            <span className={styles.groupBar} aria-hidden>
              <span
                className={styles.groupBarDone}
                style={{ width: `${donePct}%` }}
              />
              <span
                className={styles.groupBarFlight}
                style={{ width: `${flightPct}%` }}
              />
            </span>
            <span className={styles.groupCount}>
              {done}/{desired}
            </span>
          </span>
        </span>
      </header>
      {open && (
        <ul className={styles.cellList}>
          {cells.map((cell) => {
            const cellDone = cell.counted + cell.inFlight;
            const satisfied = cell.remaining === 0;
            const unlaunchable = cell.unlaunchable;
            const refused = triggerBlockedReason(cell, canTrigger);
            // What this row is, on whichever axis it varies: the block has already
            // said the other one. Both the visible label and the two accessible names
            // read it, so a screen reader hears what the eye sees rather than the
            // block's own heading repeated once per row.
            const rowName =
              axis === "case"
                ? comboLabel(cell)
                : caseLabel(testCaseName(cell.slug), cell);
            const { donePct: cellDonePct, flightPct: cellFlightPct } =
              barWidths(cell.counted, cell.inFlight, cell.desired);
            return (
              <li
                key={cellKey(cell)}
                className={`${styles.cell} ${satisfied ? styles.cellDone : ""}`}
              >
                <span className={styles.cellLabel}>
                  {rowName}
                  {axis === "combination" && cell.stale && (
                    <span
                      className={styles.staleBadge}
                      title={`A newer version (${cell.latestVersion}) is ingested. Bump the pin from the plan editor.`}
                    >
                      ↑ {cell.latestVersion}
                    </span>
                  )}
                </span>
                <span className={styles.cellBar} aria-hidden>
                  <span
                    className={styles.cellBarDone}
                    style={{ width: `${cellDonePct}%` }}
                  />
                  <span
                    className={styles.cellBarFlight}
                    style={{ width: `${cellFlightPct}%` }}
                  />
                </span>
                <span className={styles.cellCount}>
                  {cellDone}/{cell.desired}
                  {cell.pending > 0 && (
                    <span
                      className={styles.cellNote}
                      title="Held back by the queue, because its harness is at its parallelism cap or a game jam is already running on this model. Not stuck."
                    >
                      {cell.pending} pending
                    </span>
                  )}
                  {cell.unreviewed > 0 && (
                    <span
                      className={styles.cellNote}
                      title="Completed runs you have not reviewed. Informational: reviews never launch or hold back runs."
                    >
                      {cell.unreviewed} to review
                    </span>
                  )}
                  {/* Said in the row rather than only on the disabled buttons: a
                      browser suppresses a tooltip on a disabled control, so a cell
                      that has nothing left to buy would otherwise look identical to
                      one nothing can launch. */}
                  {cell.filled && !unlaunchable && (
                    <span
                      className={styles.cellCovered}
                      title="This cell holds its target of runs that count, so there is nothing left to launch."
                    >
                      filled
                    </span>
                  )}
                </span>
                {/* The run listing cannot be narrowed to the runs this cell holds, so
                    the link says it reaches every run of the cell's combination,
                    including runs beyond the plan's target. */}
                <Link
                  className={styles.cellLink}
                  to={cellRunsHref(cell)}
                  title="Every run of this case and combination, including runs beyond this plan's target. The plan counts only the first runs to land, up to its target."
                >
                  All runs
                </Link>
                {/* Two presses, because a reviewer wants both: one more run of a
                    cell they are still judging, and the cell's whole shortfall once
                    they have decided it is worth filling. Both launch the cell's own
                    pin, so a run bought here counts against the cell it came from. */}
                {/* The refusal rides the wrapper, not the buttons: a browser routes
                    no pointer events to a disabled control, so a `title` on one is
                    unreachable exactly when it has something to say. */}
                <span
                  className={styles.cellTriggers}
                  title={refused ?? undefined}
                >
                  <button
                    className={`${exec.secondary} ${styles.cellButton}`}
                    type="button"
                    disabled={busy || Boolean(refused)}
                    title={
                      refused ? undefined : "Launch one more run of this cell."
                    }
                    aria-label={`Launch one run of ${rowName}`}
                    onClick={() => onTrigger([{ ...cell, remaining: 1 }])}
                  >
                    {TRIGGER_ONE}
                  </button>
                  <button
                    className={`${exec.secondary} ${styles.cellButton}`}
                    type="button"
                    disabled={busy || Boolean(refused)}
                    title={
                      refused
                        ? undefined
                        : `Launch every run this cell is still missing (${cell.remaining}).`
                    }
                    aria-label={`Launch all ${cell.remaining} missing runs of ${rowName}`}
                    onClick={() => onTrigger([cell])}
                  >
                    {TRIGGER_ALL}
                  </button>
                </span>
                {/* The reason gets the full width of a row of its own: it is a
                    sentence naming a configuration and a slot, not a badge, and a
                    reviewer cannot act on it truncated. */}
                {unlaunchable && (
                  <span className={styles.cellBlocked}>{unlaunchable}</span>
                )}
                {/* A cell whose last runs all failed on infrastructure is not
                    relaunched by filling until its owner has fixed the cause and
                    says so; the reason and the fix share the row of their own. */}
                {cell.blocked && !unlaunchable && (
                  <span className={`${styles.cellBlocked} ${styles.cellRetry}`}>
                    <span>
                      Blocked: its last 3 runs failed on infrastructure. Fix the
                      cause, then retry.
                    </span>
                    <button
                      type="button"
                      className={`${exec.secondary} ${styles.cellButton}`}
                      disabled={busy}
                      aria-label={`Retry ${rowName}`}
                      title="Forget the failures so far and launch this cell's missing runs again."
                      onClick={() => onRetry(cell)}
                    >
                      Retry
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
