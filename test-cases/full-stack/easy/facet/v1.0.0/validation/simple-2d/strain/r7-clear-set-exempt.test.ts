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
// three with the same swap from the keyboard, and every gem on both stands at
// strain 0 but for one: on the stressed board the run's left cell, which the
// step CLEARS, is posed at MAX_STRAIN - 1. Nothing outside either clear set is
// within reach of MAX_STRAIN, so a conforming step flaws nothing on either
// board and the two frames sound alike; a step that raises the strain of what
// it clears flaws the posed cell on the stressed board alone, and that frame
// sounds the cue its control did not.
//
// WHY THE STRAIN DIGIT DISTURBS NOTHING ELSE. MAX_STRAIN - 1 is not flawed, so
// R6 draws no extra cell in and both steps clear the same three cells; and
// specs/rules.md pays BASE_SCORE for every cleared gem from strain 0 to strain
// 2 alike, so both steps are worth the same and no readout moves between them.
// The check asserts the clear sizes match rather than assuming it.
//
// HOW THE FRAME IS READ. The engine reports each cue it plays by name, so the
// reading is direct: the frame that cleared the stressed gem raised no `flaw`.
// The control board is driven all the same, so this scenario and the engineless
// build's are one scenario.
//
// WHY THE KEYBOARD IS THE ROUTE. specs/ui.md says "A cue is played by a frame,
// never by a pose of the debug surface", so a swap posed through `requestSwap`
// is entitled to raise nothing. specs/controls.md fixes `confirm` to `Enter` and
// `Space` for a build of every engine, so one press puts the step inside a frame
// under all three.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
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
import { CUES, MAX_STRAIN } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The selected cell: the jade the swap carries down into row 3. */
const SELECTED: CellRef = { col: 3, row: 2 };

/** The cursor's cell, orthogonally adjacent to it and one row below. */
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

afterEach(() => {
  h?.dispose();
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

  /** Pose one of the two boards and make the swap from the keyboard. */
  const play = async (rows: BoardRows, outputId: string) => {
    loadBoard(h, rows);
    h.debug.setSelection(SELECTED.col, SELECTED.row);
    h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);
    return captureReplay(h, outputId, async () => {
      await h.tapAction("confirm");
      return { frame: h.frame(), snapshot: h.snapshot(), board: h.board() };
    });
  };

  const cues = watchCues(h);
  const quiet = await play(control, "exempt-control");
  const spared = await play(stressed, "strain");

  // The two steps really were the same step but for the one strain digit: both
  // were step 1 of a chain, and both cleared the same number of cells.
  assertEqual(quiet.snapshot.chainStep, 1, "the control chain's step");
  assertEqual(spared.snapshot.chainStep, 1, "the stressed chain's step");
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

  // So the stressed frame raised no `flaw`: a build that had raised the strain
  // of what it was clearing would have carried the posed cell to MAX_STRAIN and
  // sounded the cue for it.
  assertLength(
    cuesOnFrame(cues, spared.frame).filter((cue) => cue.cue === CUES.flaw),
    0,
    "flaw cues on the frame that cleared a gem at MAX_STRAIN - 1",
  );

  // And the control frame, identical but for that digit, raised none either.
  assertLength(
    cuesOnFrame(cues, quiet.frame).filter((cue) => cue.cue === CUES.flaw),
    0,
    "flaw cues on the frame that cleared the same gem at strain 0",
  );
});
