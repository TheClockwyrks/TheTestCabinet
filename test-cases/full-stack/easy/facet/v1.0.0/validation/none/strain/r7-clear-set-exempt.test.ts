// Facet — strain/r7-clear-set-exempt: R7 raises the strain of the gems AROUND a
// clear, and takes nothing from the gems in it.
//
// R7 of specs/rules.md opens on the set it acts over: "Every gem OUTSIDE the
// clear set that is orthogonally adjacent to at least one cell in the clear set
// gains 1 strain." Two words of that sentence pick out two different sets, and
// this point is the first of them. The obvious implementation walks the clear
// set and bumps the four neighbors of each cleared cell, and every cell of a run
// is a neighbor of the next, so such a build strains the very gems it is about
// to remove.
//
// WHAT THE STEP ORDER LEAVES OF THAT. specs/rules.md resolves a step in a fixed
// order: the clear set scores at step 3, R7 raises strain at step 4, and the
// removal follows at step 5. A gem in the clear set is therefore scored before
// R7 could touch it and gone before the board is read again, so its strain is
// worth no reading on the board and no figure in the score. What the raise does
// leave behind is an event: specs/ui.md's cue table plays `flaw` when "A gem
// reaches MAX_STRAIN", and a cleared gem carried from MAX_STRAIN - 1 to
// MAX_STRAIN by a raise it should never have had is a gem that reached it.
//
// THE SCENARIO, THEREFORE, IS A PAIR. Both boards complete the same jade run of
// three with the same pointer gesture, and every gem on both stands at strain 0
// but for one: on the stressed board the run's left cell, which the step CLEARS,
// is posed at MAX_STRAIN - 1. Nothing OUTSIDE either clear set stands within one
// raise of MAX_STRAIN, so a conforming step flaws nothing on either board and
// the two frames sound alike; a step that raises the strain of what it clears
// flaws the posed cell on the stressed board alone, and that frame sounds the
// cue its control did not.
//
// WHY THE STRAIN DIGIT DISTURBS NOTHING ELSE. MAX_STRAIN - 1 is not flawed, so
// R6 draws no extra cell in and both steps clear the same three cells; and
// specs/rules.md pays BASE_SCORE for every cleared gem from strain 0 to strain
// 2 alike, so both steps are worth the same and no readout moves between them.
// The check asserts the clear sizes match rather than assuming it.
//
// WHY THE POINTER IS THE ROUTE. specs/controls.md plays the board with the
// pointer alone: a press takes hold of the gem at the cell it targets, a move
// while held offers that gem into an orthogonal neighbor, and "the release with
// an offer standing is what requests the swap". `dragGem` is exactly those three
// operations and nothing else, so what reaches the acceptance path is the
// build's own press, move and release rules.
//
// WHICH FRAME IS READ, AND WHY IT IS NOT THE RELEASE'S. specs/ui.md says "A cue
// is played by a frame, never by a pose of the debug surface", and the three
// pointer operations take effect at their calls without a frame running — so the
// gesture itself sounds nothing. The release only requests the swap: an accepted
// swap enters `swapping` with `chainStep` at 0 and clears nothing until
// SWAP_SECONDS (0.18) of game time has passed, so no frame in that span can
// raise a strain at all. R7 runs inside the step that resolves when it is spent,
// which makes the frame the step resolved on the one and only frame a wrongly
// raised gem could reach MAX_STRAIN and sound `flaw` on. That is the frame this
// reads, found by driving until `chainStep` rises and taking the frame counter
// there. The drive is capped at `framesPast(SWAP_SECONDS)` — 13 frames of the
// suite's clock, 0.203125 s — which is a whole frame beyond the boundary
// whether a build compares `>=` or `>`, so a build that never resolves the swap
// fails saying so rather than running on.
//
// HOW THE FRAME IS READ. This build stands on no engine, so specs/ui.md fixes
// the cue NAMES inside its own code and the harness can report only that
// one-shots went out and on which frame. The pair is what makes that enough: the
// two frames are the same frame but for the one strain digit, so a stressed
// frame that sounds no more than its control's did is a build that left the gems
// it cleared alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { MAX_STRAIN, SWAP_SECONDS } from "../constants";
import {
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
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  dragGem,
  framesPast,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The cell the press takes hold of: the jade the gesture carries down a row. */
const SELECTED: CellRef = { col: 3, row: 2 };

/** The cell it is offered into, orthogonally adjacent and one row below. */
const NEIGHBOR: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, so that exchanging {@link SELECTED} with
 * {@link NEIGHBOR} completes a horizontal run of jade across `(2,3)`, `(3,3)`,
 * `(4,3)` and R3 accepts the swap.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: 2, row: 3, token: "J0" },
  { col: 4, row: 3, token: "J0" },
  { col: 3, row: 2, token: "J0" },
];

/**
 * The one cell the two boards differ at: the run's left end, which is INSIDE the
 * clear set the swap seeds and is therefore a cell R7 must leave alone.
 */
const STRESSED: CellRef = { col: 2, row: 3 };

/** How many gems on a written board are flawed, which specs/board.md is MAX_STRAIN. */
function flawedGems(rows: BoardRows): number {
  return parseRows(rows)
    .flat()
    .filter((gem) => isFlawed(gem.strain)).length;
}

/** How many gems on a written board stand one raise short of flawed. */
function stressedGems(rows: BoardRows): number {
  return parseRows(rows)
    .flat()
    .filter((gem) => gem.strain === MAX_STRAIN - 1).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no strain from the gems the step is clearing", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The control: every gem on the board at strain 0, inside the clear set and
  // out.
  const control = quietRowsWithEscape(SCENARIO);
  // The same board with one strain digit changed, at one cell, keeping the kind
  // the run needs there so no run anywhere on the board moves.
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
      swapIsLegal(rows, SELECTED, NEIGHBOR),
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

  // The stressed cell is a cell the step CLEARS, which is what makes it R7's
  // exclusion rather than R7's subject.
  const cleared = clearSetFromRuns(swapped(control, SELECTED, NEIGHBOR));
  assertTrue(
    cleared.some((c) => c.col === STRESSED.col && c.row === STRESSED.row),
    "the stressed cell is inside the clear set",
  );

  // And it is the ONLY gem either board holds within one raise of MAX_STRAIN, so
  // a flaw sounded on either frame can have come from nowhere else.
  assertEqual(
    stressedGems(control),
    0,
    "gems one raise short of flawed on the control board",
  );
  assertEqual(
    stressedGems(stressed),
    1,
    "gems one raise short of flawed on the stressed board",
  );

  /**
   * Pose one of the two boards, play the move with the pointer, and stop on the
   * frame step 1 resolves on.
   *
   * `dragGem` is the press, the carry and the release, each of which takes
   * effect at its call, so no frame has run when the swap is requested. The
   * drive that follows is what carries the game across SWAP_SECONDS into step 1,
   * and it stops on the first frame that reports a chain step — which is the
   * frame R7 ran on.
   */
  const play = async (rows: BoardRows) => {
    await loadBoard(h, rows);
    const released = await dragGem(h, SELECTED, NEIGHBOR);
    const resolved = await h.until((state) => state.chainStep >= 1, {
      maxFrames: framesPast(SWAP_SECONDS),
    });
    return {
      released,
      hit: resolved.hit,
      frame: h.frame(),
      snapshot: resolved.snapshot,
      board: await h.board(),
    };
  };

  const cues = watchCues(h);
  const quiet = await play(control);
  const spared = await captureReplay(h, "strain", () => play(stressed));

  // The gesture reached the acceptance path on both boards, and the drive found
  // the step it opened, so both readings really are of a resolved step 1.
  for (const [name, played] of [
    ["control", quiet],
    ["stressed", spared],
  ] as const) {
    assertEqual(
      played.released.phase,
      "swapping",
      `the phase the release left on the ${name} board`,
    );
    assertTrue(
      played.hit,
      `the ${name} board's swap resolved within SWAP_SECONDS`,
    );
    assertEqual(
      played.snapshot.chainStep,
      1,
      `the chain step the ${name} board's swap opened`,
    );
  }

  // The two steps really were the same step but for the one strain digit: both
  // cleared the same number of cells.
  assertEqual(
    spared.snapshot.lastCleared,
    quiet.snapshot.lastCleared,
    "cells the stressed step cleared, against the control's",
  );

  // Neither step left a flawed gem standing, because the only gem in reach of
  // MAX_STRAIN was one the step removed.
  assertEqual(flawedGems(quiet.board), 0, "flawed gems after the control step");
  assertEqual(
    flawedGems(spared.board),
    0,
    "flawed gems after the stressed step",
  );

  // The control frame, on which every gem in the clear set stood at strain 0, is
  // what the stressed frame is measured against: nothing outside either clear
  // set is within a raise of MAX_STRAIN, so whatever the control sounded is what
  // a step that flaws nothing sounds.
  const quietCues = cuesOnFrame(cues, quiet.frame);

  // And the stressed frame, identical but for that one digit at a cell the step
  // CLEARS, sounded no more than its control did. A build that had raised the
  // strain of what it was clearing would have carried the posed cell to
  // MAX_STRAIN and sounded the cue for it, over and above everything the control
  // frame sounded.
  assertLessThanOrEqual(
    cuesOnFrame(cues, spared.frame).length,
    quietCues.length,
    "one-shot cues on the frame that cleared a gem at MAX_STRAIN - 1, against " +
      "the frame that cleared the same gem at strain 0",
  );
});
