// Facet — audio/cue-cut: the `cut` cue sounds on the frame R8 creates a cut gem,
// over and above the `clear` cue that same frame already raises.
//
// specs/ui.md's CUES table: "`cut` — `CUES.cut` — A cut gem is created", read
// with the sentence under it — "Each is played on the frame its event happens
// … at most once on that frame; a frame that raises more than one of them plays
// each of those once."
//
// WHY THE POINT NEEDS TWO DRIVES RATHER THAN ONE. R8 creates a cut gem only
// inside a chain step, and a chain step that creates one also clears the set
// that seeded it — so the creating frame ALWAYS raises `clear` too, and no
// arrangement exists in which `cut` sounds alone. The reading is therefore a
// DIFFERENCE between two frames: one that clears and creates a cut gem, and a
// control that clears and creates none. What the control holds fixed is
// everything else a frame's audio could turn on.
//
// HOW THE TWO ARE MADE COMPARABLE. Both drives pose the same run-free filler,
// put the cursor on the same cell, select it with the same `confirm`, and
// exchange the same two cells; both open chain step 1, so both sound the same
// rung of the chain ladder specs/assets.md gives `clear`; and both clear
// EXACTLY FOUR CELLS, which is what stops a build's per-step audio from
// differing for a reason other than the cut:
//
//   subject — a maximal run of four rubies. R8's first row creates a
//             `brilliant`; the clear set is the run's own four cells.
//   control — a maximal run of three rubies with one flawed gem beside it. R8
//             creates nothing from a run of three, and R6's third addition
//             draws the flawed neighbor in, so the clear set is four cells
//             again. The flawed gem is posed already at MAX_STRAIN, so R7
//             raises nothing to it and no `flaw` cue belongs to either frame.
//
// The swap is driven from the KEYBOARD rather than through `requestSwap`,
// because specs/ui.md says "A cue is played by a frame, never by a pose of the
// debug surface": a build is entitled to raise nothing for a posed swap, and a
// check that posed one would be reading that entitlement.
//
// WHAT THIS ENGINE CAN SEE, AND WHAT IT CANNOT. specs/ui.md fixes the eight cue
// NAMES inside an engineless build's own code and says nothing about how a build
// makes a sound, so there is no bus outside the build to ask which cue played
// and no `none` check may assert a name. What the harness observes is that a
// sound went out and which frame produced it. So the difference the two drives
// were built to isolate is read as a COUNT: the frame that created a cut gem
// emitted strictly more sound than the frame that cleared as many cells and
// created none. A build that plays nothing for a created cut gem emits the same
// on both, and fails.
//
// The premise is asserted too — the subject's frame really did create one cut
// gem — so a build that creates none fails here saying so rather than failing on
// an unexplained count.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  clearSetFromRuns,
  hasAnyRun,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** The cell the waiting ruby sits on, and the cell the swap drops it into. */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * The SUBJECT: three rubies in row 3 at columns 3, 4 and 6, and a fourth
 * waiting above the gap at column 5.
 *
 * The exchange completes a maximal run of four across columns 3-6, bounded at
 * both ends by the filler's own other kinds — the length R8's first row turns
 * into a `brilliant`.
 */
const SUBJECT_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 6, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/**
 * The CONTROL: the same exchange completing a run of three, with one flawed gem
 * directly below the run.
 *
 * `S3` is the sapphire the filler already holds at (4,4), rewritten at
 * MAX_STRAIN, so the board's kinds are untouched and no new run appears. R6
 * draws it into the clear set as "every flawed gem orthogonally adjacent to a
 * cell in the set", which brings the cells cleared to four — the subject's
 * count — while R8 still creates nothing.
 */
const CONTROL_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
  { col: 4, row: 4, token: "S3" },
];

/** How many cells each of the two drives clears. */
const CLEARED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every gem a reading reports that is not `plain`: here, exactly what R8 made. */
function cutCells(snapshot: FacetSnapshot): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut !== "plain");
}

/**
 * Establish that a scenario's cells really do pose what the check claims, before
 * the build is asked anything: a board at rest under R4, one legal exchange, one
 * maximal run of the stated length, and a clear set of {@link CLEARED} cells.
 */
function assertScenario(rows: readonly string[], runLength: number): void {
  assertEqual(hasAnyRun(rows), false, "a maximal run on the posed board");
  assertEqual(
    swapIsLegal(rows, FROM, TO),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  const produced = maximalRuns(swapped(rows, FROM, TO));
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, runLength, "cells in the run it produces");
  assertLength(
    clearSetFromRuns(swapped(rows, FROM, TO)),
    CLEARED,
    "cells in the clear set the step reads",
  );
}

/**
 * Play the scenario out from the keyboard and hand back the frame the swap was
 * accepted on, with the state that frame left.
 *
 * The two `confirm`s land on frames of their own, with an idle frame between
 * them, so the `select` the first raises cannot be attributed to the frame the
 * second one's swap resolves on.
 */
async function drive(
  cells: readonly PlacedToken[],
): Promise<{ at: number; after: FacetSnapshot }> {
  await loadBoard(h, quietRowsWithEscape(cells));
  await h.debug.setCursor(FROM.col, FROM.row);
  await h.advance(1);
  await h.tapAction("confirm");
  assertDeepEqual(
    (await h.snapshot()).selection,
    FROM,
    "the cell `confirm` selected",
  );

  await h.debug.setCursor(TO.col, TO.row);
  await h.advance(1);
  await h.tapAction("confirm");
  return { at: h.frame(), after: await h.snapshot() };
}

it("plays the cut cue on the frame a cut gem is created", async () => {
  const control = quietRowsWithEscape(CONTROL_CELLS);
  const subject = quietRowsWithEscape(SUBJECT_CELLS);
  assertScenario(control, 3);
  assertScenario(subject, 4);

  // The build has to have opened its audio and decoded its produced `.wav`s
  // before any frame of either drive can be read for a cue.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  const cues = watchCues(h);

  // The control first: a step that clears four cells and creates nothing.
  const clearOnly = await drive(CONTROL_CELLS);
  assertEqual(clearOnly.after.chainStep, 1, "the chain step the control opened");
  assertEqual(clearOnly.after.lastCleared, CLEARED, "cells the control cleared");
  assertLength(cutCells(clearOnly.after), 0, "cut gems the control created");
  const withoutCut = cuesOnFrame(cues, clearOnly.at);
  assertGreaterThan(
    withoutCut.length,
    0,
    "sounds on the control's clearing frame",
  );

  // Then the subject: the same exchange, clearing the same four cells, and
  // creating one cut gem as it does.
  const creating = await captureReplay(h, "cut", () => drive(SUBJECT_CELLS));
  assertEqual(creating.after.chainStep, 1, "the chain step the subject opened");
  assertEqual(creating.after.lastCleared, CLEARED, "cells the subject cleared");
  assertLength(cutCells(creating.after), 1, "cut gems the subject created");

  // The cue itself, read as the one thing this engine reports: the creating
  // frame emitted more sound than the frame that did everything it did but
  // create a cut gem.
  assertGreaterThan(
    cuesOnFrame(cues, creating.at).length,
    withoutCut.length,
    "sounds on the frame a cut gem was created, against the frame that " +
      "cleared as many cells and created none",
  );
});
