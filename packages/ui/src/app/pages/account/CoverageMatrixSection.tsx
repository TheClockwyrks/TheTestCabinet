import { useState } from "react";
import { Link } from "react-router";
import type {
  CoverageAxis,
  CoverageCell,
} from "@clockwyrks/run-record/coverage";
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
    return "Covered: this cell is already at its target.";
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
}: {
  group: MatrixGroup;
  axis: CoverageAxis;
  busy: boolean;
  canTrigger: boolean;
  onTrigger: (cells: CoverageCell[]) => void;
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
          {group.unreviewed > 0 && (
            <span
              className={styles.waitingBadge}
              title="Completed runs here that you have not reviewed. They count toward the plan's target and occupy your review buffer."
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
            const cellDone = cell.completed + cell.inFlight;
            const satisfied = cell.remaining === 0;
            const blocked = cell.unlaunchable;
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
              barWidths(cell.completed, cell.inFlight, cell.desired);
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
                      title="Completed runs you have not reviewed. They count toward the target and occupy your review buffer."
                    >
                      {cell.unreviewed} to review
                    </span>
                  )}
                  {/* Said in the row rather than only on the disabled buttons: a
                      browser suppresses a tooltip on a disabled control, so a cell
                      that has nothing left to buy would otherwise look identical to
                      one nothing can launch. */}
                  {satisfied && !blocked && (
                    <span
                      className={styles.cellCovered}
                      title="This cell is at its target, so there is nothing left to launch."
                    >
                      covered
                    </span>
                  )}
                </span>
                <Link className={styles.cellLink} to={cellRunsHref(cell)}>
                  Runs
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
                {blocked && (
                  <span className={styles.cellBlocked}>{blocked}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
