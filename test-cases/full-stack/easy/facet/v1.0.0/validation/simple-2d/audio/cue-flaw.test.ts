// audio/cue-flaw — the `flaw` cue sounds on the frame a gem reaches MAX_STRAIN,
// over and above the `clear` cue that frame also raises.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`flaw` | `CUES.flaw` | A gem
// reaches `MAX_STRAIN`", under a sentence that fixes the timing — "Each is
// played on the frame its event happens ... and at most once on that frame; a
// frame that raises more than one of them plays each of those once, and a frame
// on which four gems reach `MAX_STRAIN` plays `flaw` once."
//
// WHAT MAKES A GEM REACH MAX_STRAIN. specs/rules.md's R7: "Every gem outside the
// clear set that is orthogonally adjacent to at least one cell in the clear set
// gains `1` strain, capped at `MAX_STRAIN`", and specs/board.md: "a gem at
// `MAX_STRAIN` is flawed." So a gem already at `MAX_STRAIN - 1` beside a
// clearing set reaches it in that step, and one at `0` does not.
//
// WHY TWO SCENARIOS RATHER THAN ONE. A flaw never happens alone: R7 runs inside
// a chain step, so the flawing frame is also a clearing frame and would sound
// `clear` whatever the build did about `flaw`. The pair isolates it. The two
// boards are the SAME board but for one strain digit at one cell, so the swap,
// the run, the clear set, the multiplier and every other cue the frame raises
// are identical, and the one thing that differs between the two frames is
// whether a gem reached `MAX_STRAIN`. The check asserts that difference and
// nothing else.
//
// R6 IS NOT DISTURBED BY THE STRESSED CELL. R6 pulls in "every flawed gem
// orthogonally adjacent to a cell in the set", and the stressed gem is at
// `MAX_STRAIN - 1` when the step reads it — it is not flawed until R7 has run,
// which is after R6 and after the scoring. So both scenarios clear the same set,
// and the check asserts that too rather than assuming it.
//
// WHICH FRAME IS READ, AND WHY THE SWAP IS POSED. The event is raised by the
// frame the STEP resolves on, which specs/rules.md puts `SWAP_SECONDS` after the
// swap was accepted: "Nothing is cleared yet ... When `swapTimer` reaches
// `SWAP_SECONDS` ... `chainStep` becomes `1`, and step `1` resolves." That frame
// is a frame of the simulation rather than an input edge, so how the move was
// asked for cannot change it, and `requestSwap` — which
// specs/instrumentation.md sends "through the same acceptance path a player's
// release takes" — puts no pointer surface between this point and the thing it
// decides. The chain is then walked ONE FRAME AT A TIME so the frame the step
// resolved on is the frame the cues are read against.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  areAdjacent,
  clearSetFromRuns,
  isFlawed,
  maximalRuns,
  parseRows,
  parseToken,
  quietRowsWithEscape,
  strainAt,
  swapIsLegal,
  swapped,
  tokenAt,
  tokenOf,
  withCells,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import { CUES, MAX_STRAIN } from "../constants";
import {
  captureReplay,
  createHarness,
  cueNames,
  cuesOnFrame,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The cell the swap carries the jade down from. */
const FROM: CellRef = { col: 3, row: 2 };

/** The cell it carries the jade into, one row below and orthogonally adjacent. */
const TO: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, so that exchanging {@link FROM} with
 * {@link TO} completes a horizontal run of jade across `(2,3)`, `(3,3)`,
 * `(4,3)` and R3 accepts the swap.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: 2, row: 3, token: "J0" },
  { col: 4, row: 3, token: "J0" },
  { col: 3, row: 2, token: "J0" },
];

/**
 * The one cell the two boards differ at: a neighbor of the run, above its right
 * end, and outside the run itself.
 */
const STRESSED: CellRef = { col: 4, row: 2 };

/**
 * Frames allowed beyond the drive the swap animation needs.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry a swapping board past `SWAP_SECONDS` into the step that
 * follows, sized so a build comparing `>=` and one comparing `>` both read alike;
 * two frames beyond it is room for a build that resolves on the next frame.
 */
const SEARCH_MARGIN = 2;

/** How many gems on a written board are flawed, which specs/board.md is MAX_STRAIN. */
function flawedGems(rows: BoardRows): number {
  return parseRows(rows)
    .flat()
    .filter((gem) => isFlawed(gem.strain)).length;
}

let h: Harness;

/** Walk the swap one frame at a time to the frame step 1 resolves on. */
async function stepOneFrame(): Promise<{
  frame: number;
  snapshot: FacetSnapshot;
}> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    if (snapshot.chainStep >= 1) return { frame: h.frame(), snapshot };
  }
  return fail(
    `step 1 to resolve within ${cap} frames of the accepted swap`,
    `phase ${h.snapshot().phase} at chain step ${h.snapshot().chainStep}`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the flaw cue on the frame a gem reaches MAX_STRAIN and not otherwise", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The control: every gem around the run at strain 0, so R7 raises them to 1
  // and nothing is flawed.
  const control = quietRowsWithEscape(SCENARIO);
  // The same board with one strain digit changed, at one cell, keeping the kind
  // the filler put there so no run anywhere on the board moves.
  const stressed = withCells(control, [
    {
      col: STRESSED.col,
      row: STRESSED.row,
      token: tokenOf(
        parseToken(tokenAt(control, STRESSED.col, STRESSED.row)).kind,
        MAX_STRAIN - 1,
      ),
    },
  ]);

  // The fixture's own guarantees, read off the written boards. Both are quiet,
  // both accept the same swap, and they differ at exactly one cell — restoring
  // that one token turns one into the other.
  for (const [name, rows] of [
    ["control", control],
    ["stressed", stressed],
  ] as const) {
    assertLength(maximalRuns(rows), 0, `maximal runs on the ${name} board`);
    assertTrue(
      swapIsLegal(rows, FROM, TO),
      `R1 and R3 accept the swap on the ${name} board`,
    );
  }
  assertDeepEqual(
    withCells(stressed, [
      {
        col: STRESSED.col,
        row: STRESSED.row,
        token: tokenAt(control, STRESSED.col, STRESSED.row),
      },
    ]),
    [...control],
    "the stressed board with its one changed token put back",
  );
  assertEqual(
    strainAt(control, STRESSED.col, STRESSED.row),
    0,
    "the strain the control board carries at the stressed cell",
  );
  assertEqual(
    strainAt(stressed, STRESSED.col, STRESSED.row),
    MAX_STRAIN - 1,
    "the strain the stressed board carries at the stressed cell",
  );

  // And the stressed cell is where R7 will reach it: outside the clear set the
  // swap seeds, and orthogonally adjacent to a cell inside it.
  const cleared = clearSetFromRuns(swapped(control, FROM, TO));
  assertTrue(
    !cleared.some((c) => c.col === STRESSED.col && c.row === STRESSED.row),
    "the stressed cell is outside the clear set",
  );
  assertTrue(
    cleared.some((c) => areAdjacent(c, STRESSED)),
    "the stressed cell borders the clear set",
  );

  /** Pose one of the two boards, ask for the swap, and walk to step 1's frame. */
  const play = async (rows: BoardRows, outputId: string) => {
    loadBoard(h, rows);
    requestSwap(h, FROM, TO);
    return captureReplay(h, outputId, async () => {
      const resolved = await stepOneFrame();
      return { ...resolved, board: h.board() };
    });
  };

  const cues = watchCues(h);
  const quiet = await play(control, "flaw-control");
  const flawing = await play(stressed, "flaw");

  // The two steps really were the same step but for the flaw: both were step 1
  // of a chain, and both cleared the same number of cells.
  assertEqual(quiet.snapshot.chainStep, 1, "the control chain's step");
  assertEqual(flawing.snapshot.chainStep, 1, "the stressed chain's step");
  assertEqual(
    flawing.snapshot.lastCleared,
    quiet.snapshot.lastCleared,
    "cells the stressed step cleared, against the control's",
  );

  // And the event the cue is about happened in one of them only: R7 left exactly
  // one gem at MAX_STRAIN on the stressed board and none on the control's.
  assertEqual(flawedGems(quiet.board), 0, "flawed gems after the control step");
  assertEqual(
    flawedGems(flawing.board),
    1,
    "flawed gems after the stressed step",
  );

  // The flawing frame sounded the cue, beside the `clear` it also raised.
  assertContains(
    cueNames(cuesOnFrame(cues, flawing.frame)),
    CUES.flaw,
    "cues on the frame a gem reached MAX_STRAIN",
  );

  // And the control frame, identical but for that, did not.
  assertLength(
    cuesOnFrame(cues, quiet.frame).filter((cue) => cue.cue === CUES.flaw),
    0,
    "flaw cues on the frame no gem reached MAX_STRAIN",
  );
});
