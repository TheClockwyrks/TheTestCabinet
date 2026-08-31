// settling/r9-carries-strain-and-cut — a gem R9 drops arrives as the same gem: it
// keeps the strain it carried and the cut it was cut with.
//
// WHAT THE RULE IS. specs/rules.md R9 has a surviving gem fall "keeping the order
// its column held it in and carrying its strain and its cut". Falling is a change
// of address and nothing else. A build that rebuilds a column out of fresh plain
// gems, or that resets strain on the way down, or that drops the cut and leaves a
// brilliant standing as an ordinary gem, is what this reads for.
//
// HOW THE SCENARIO ISOLATES THAT. The marked gems sit at rows 1, 2 and 3 of
// column 4, and the run the swap clears is at rows 5, 6 and 7 of the same column.
// Two rows separate the lowest mark from the top of the gap, so none of the three
// is orthogonally adjacent to a cell in the clear set and R7 adds nothing to any
// of them: whatever strain they arrive with is the strain they set out with. They
// are marked in strain and in cut ONLY — each keeps the kind the run-free filler
// already put there — so the marks cannot make or break a run, and the swap's own
// run stays the only run on the board.
//
// WHY A BRILLIANT IS SAFE TO POSE HERE. R6 grows the clear set through a
// brilliant that is IN the set; this one never enters it, being three rows clear
// of the seed, so it falls as an ordinary survivor and the step clears the same
// three cells it would without it.
//
// WHEN THE READING IS TAKEN. An accepted swap exchanges the two cells at once and
// then holds them in motion: specs/rules.md sets `phase` to `swapping` with
// `chainStep` at 0, and step 1 resolves once `SWAP_SECONDS` (0.18) of game time
// has passed. `swapAndStep` carries the board through exactly that and hands back
// the reading step 1 left behind, R9 included.
//
// WHAT IS READ. Each mark is looked for at the cell three rows below the one it
// was posed at, and its kind, its strain and its cut are read there one at a
// time, so a build that carried the gem but flattened its strain fails on the
// strain and says so.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderCell,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  framesShortOf,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The column that is cleared at its foot and read at its middle. */
const COL = 4;

/** How many cells the step empties out of `COL`, and so how far its gems fall. */
const CLEARED = 3;

/**
 * The three marks, at rows 1, 2 and 3 of column 4.
 *
 * Amethyst, amber and jade are the kinds the run-free filler already holds at
 * those cells, so only the strain digit and the cut letter are the scenario's:
 * a strain below the cap, a second strain below the cap, and a brilliant.
 */
const MARKS: readonly PlacedToken[] = [
  { col: COL, row: 1, token: "M1" },
  { col: COL, row: 2, token: "A2" },
  { col: COL, row: 3, token: "J0b" },
];

/** The run the swap completes at the foot of the same column. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: COL, row: 5, token: "R0" },
  { col: COL, row: 7, token: "R0" },
  { col: COL + 1, row: 6, token: "R0" },
];

/** The swap that completes the run: the parked ruby trades into `(4,6)`. */
const A: CellRef = { col: COL, row: 6 };
const B: CellRef = { col: COL + 1, row: 6 };

/** The three cells the swap's run seeds, top to bottom. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 5 },
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

/**
 * Frames that carry the recording to just short of the end of the step the
 * reading was taken in, so the replay holds the fall rather than stopping on the
 * frame the step resolved.
 *
 * A step's hold is the STEP's OWN figure — `lastWaves * WAVE_SECONDS` plus
 * `lastFall * FALL_SECONDS_PER_ROW` plus `STEP_SECONDS` — which the snapshot
 * reports as `stepHold`, so the frames that fill it are read off the reading
 * rather than written down. `framesShortOf` keeps the drive strictly inside what
 * is left of that hold, so the board is never read a second time and the
 * readings below still describe step 1.
 */
function restOfStep(reading: FacetSnapshot): number {
  return framesShortOf(Math.max(0, reading.stepHold - reading.stepTimer));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands a fallen gem with the strain and the cut it set out with", async () => {
  const posed = quietRowsWith([...MARKS, ...RUN_CELLS]);
  // The arrangement is proved, not assumed: the marks change no kind, so the
  // posed board still carries no run, and the swap seeds exactly the three
  // cells at the foot of the column — none of them beside a mark.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(swapped(posed, A, B)),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  loadBoard(h, posed);
  const settled = await captureReplay(h, "fall", async () => {
    const first = await swapAndStep(h, A, B);
    await h.advance(restOfStep(first));
    return first;
  });
  assertEqual(settled.chainStep, 1, "the chain step the swap opened");

  for (const mark of MARKS) {
    const sent = parseToken(mark.token);
    const landed = parseToken(
      renderCell(settled, mark.col, mark.row + CLEARED),
    );
    const where = `(${mark.col},${mark.row}) -> (${mark.col},${mark.row + CLEARED})`;
    // Kind first, so a build that moved the wrong gem is reported as having
    // moved the wrong gem rather than as having lost a strain.
    assertEqual(landed.kind, sent.kind, `the kind that arrived, ${where}`);
    assertEqual(landed.strain, sent.strain, `the strain it carried, ${where}`);
    assertEqual(landed.cut, sent.cut, `the cut it carried, ${where}`);
  }
});
