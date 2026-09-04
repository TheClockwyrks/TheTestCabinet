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
// HOW THE TWO ARE MADE COMPARABLE. Both drives pose the same run-free filler and
// ask for the same exchange of the same two cells; both open chain step 1, so
// both sound the same rung of the chain ladder specs/assets.md gives `clear`; and
// both clear EXACTLY FOUR CELLS, which is what stops a build's per-step audio
// from differing for a reason other than the cut:
//
//   subject — a maximal run of four rubies. R8's first row creates a
//             `brilliant`; the clear set is the run's own four cells.
//   control — a maximal run of three rubies with one flawed gem beside it. R8
//             creates nothing from a run of three, and R6's third addition
//             draws the flawed neighbor in, so the clear set is four cells
//             again. The flawed gem is posed already at MAX_STRAIN, so R7
//             raises nothing to it and no `flaw` cue belongs to either frame.
//
// WHICH FRAME IS READ, AND WHY THE SWAP IS POSED. The event is raised by the
// frame the STEP resolves on, which specs/rules.md puts `SWAP_SECONDS` after the
// swap was accepted: the exchange enters `swapping` and "Nothing is cleared yet".
// That frame belongs to the simulation rather than to an input edge, so how the
// move was asked for cannot move it, and `requestSwap` — which
// specs/instrumentation.md sends "through the same acceptance path a player's
// release takes, so R1, R2, and R3 in `specs/rules.md` decide it and nothing is
// bypassed" — reaches it without putting the pointer's own surface between this
// point and the thing it decides. Each drive is then walked ONE FRAME AT A TIME,
// so the frame the step resolved on is the frame the cues are read against.
//
// WHAT THIS ENGINE CAN SEE. Nothing outside an engineless build publishes a cue's
// name: specs/ui.md fixes the nine names inside the build's own code, so the
// harness reports that a one-shot went out and which frame made it, and no more.
// Which is exactly enough for a DIFFERENCE. The two frames are the same frame but
// for the cut gem, so the sounds they make are the same sounds but for the one
// the creation owes — and the creating frame therefore has to make MORE of them
// than its control did. The engine-backed counterpart reads the same difference
// by name; that asymmetry is expected and the two scripts pose the identical
// scenario.
//
// The premise is asserted too — the subject's frame really did create one cut
// gem — so a build that creates none fails here saying so rather than failing
// on an unexplained count.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
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
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

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

/**
 * Frames allowed beyond the drive the swap animation needs.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry a swapping board past `SWAP_SECONDS` into the step that
 * follows, sized so a build comparing `>=` and one comparing `>` both read alike;
 * two frames beyond it is room for a build that resolves on the next frame.
 */
const SEARCH_MARGIN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every gem a reading reports that is not `plain`: here, exactly what R8 made. */
function cutCells(snapshot: FacetSnapshot): FacetSnapshot["board"]["cells"] {
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
 * Pose one scenario, ask for its swap, and walk one frame at a time to the frame
 * step 1 resolves on, handing back that frame and the state it left.
 */
async function drive(
  cells: readonly PlacedToken[],
): Promise<{ at: number; after: FacetSnapshot }> {
  await loadBoard(h, quietRowsWithEscape(cells));
  await requestSwap(h, FROM, TO);
  const cap = stepDriveFrames(await h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    const after = await h.snapshot();
    if (after.chainStep >= 1) return { at: h.frame(), after };
  }
  return fail(
    `step 1 to resolve within ${cap} frames of the accepted swap`,
    `phase ${(await h.snapshot()).phase} at chain step ${(await h.snapshot()).chainStep}`,
  );
}

it("plays a cue the control frame does not on the frame a cut gem is created", async () => {
  const control = quietRowsWithEscape(CONTROL_CELLS);
  const subject = quietRowsWithEscape(SUBJECT_CELLS);
  assertScenario(control, 3);
  assertScenario(subject, 4);

  // The build has to have opened its audio and decoded its produced `.wav`s
  // before any frame of either drive can be read for a cue.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");
  const cues = watchCues(h);

  // The control first: a step that clears four cells and creates nothing.
  const clearOnly = await drive(CONTROL_CELLS);
  assertEqual(
    clearOnly.after.chainStep,
    1,
    "the chain step the control opened",
  );
  assertEqual(
    clearOnly.after.lastCleared,
    CLEARED,
    "cells the control cleared",
  );
  assertLength(cutCells(clearOnly.after), 0, "cut gems the control created");
  const withoutCut = cuesOnFrame(cues, clearOnly.at);
  assertGreaterThan(
    withoutCut.length,
    0,
    "cues on the control's clearing frame",
  );

  // Then the subject: the same exchange, clearing the same four cells, and
  // creating one cut gem as it does.
  const creating = await captureReplay(h, "cut", () => drive(SUBJECT_CELLS));
  assertEqual(creating.after.chainStep, 1, "the chain step the subject opened");
  assertEqual(creating.after.lastCleared, CLEARED, "cells the subject cleared");
  assertLength(cutCells(creating.after), 1, "cut gems the subject created");
  const withCut = cuesOnFrame(cues, creating.at);

  // The cue itself, as the difference between the two frames: the creating frame
  // sounded everything its control sounded and the cut over and above it. A
  // build that plays no cut cue makes the two frames sound alike and fails here;
  // one that plays it on every clearing frame fails the same way.
  assertGreaterThan(
    withCut.length,
    withoutCut.length,
    "one-shot cues on the frame a cut gem was created, against the frame that " +
      "cleared as much and created none",
  );
});
