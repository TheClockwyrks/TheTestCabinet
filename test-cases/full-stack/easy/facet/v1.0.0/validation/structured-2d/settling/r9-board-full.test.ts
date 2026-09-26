// settling/r9-board-full — once a chain step has settled, the board is whole
// again: all 64 cells, one gem in each.
//
// WHAT THE RULE IS. specs/board.md, Cells: "Every cell holds exactly one gem
// while the board is settled. A cell stands empty only between the removal of a
// chain step's clear set and the settling that ends that step." A step's removal
// tears holes in the board and R9 closes them, so the board a settled step hands
// back is a full 8 by 8 grid — never a short list, never a cell reported twice,
// never a hole left where the fall ran out of survivors and the refill did not
// make up the difference.
//
// WHAT A CELL HAS TO REPORT. Every cell carries a cut and a strain
// (specs/board.md: "Every gem carries exactly one cut", "Strain is a whole number
// ... Every gem carries one"), and a kind unless it is a prism, which "carries no
// kind at all" and which specs/instrumentation.md reports as `kind: null`. So a
// hole shows up here whichever way a build leaves one: as a missing entry, as a
// duplicate, or as an entry with nothing in it.
//
// WHY A CHAIN AND NOT A SINGLE STEP. The rule is about EVERY step, and the step
// most likely to leave a hole is not the first: a later step clears cells a
// refill dropped in, in columns whose survivors have already moved once. The
// arrangement below drives a chain that is guaranteed at least two steps deep —
// the swap clears the foot of column 4, and the fall that follows carries a beryl
// down into row 4 between two beryls already standing there, which seeds the next
// step from survivors alone rather than from anything random. Every settled
// reading the chain produces is then held to the rule, the last one included.
//
// HOW THE CHAIN IS DRIVEN. An accepted swap exchanges the two cells at once and
// then holds them in motion: specs/rules.md sets `phase` to `swapping` with
// `chainStep` at 0, and step 1 resolves once `SWAP_SECONDS` (0.18) of game time
// has passed. `swapAndStep` carries the board through exactly that and hands
// back step 1's reading; `advanceStep` carries it past one step boundary at a
// time after that, sizing each drive from the hold that step itself reports —
// `lastWaves * WAVE_SECONDS` plus `lastFall * FALL_SECONDS_PER_ROW` plus
// `STEP_SECONDS` — which is why no frame count appears anywhere below.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNull,
  assertTrue,
  fail,
} from "../assert";
import {
  CUTS,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MAX_CHAIN_STEPS,
} from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The column the first step clears the foot of. */
const COL = 4;

/**
 * The arrangement, over the run-free filler.
 *
 * The last three cells make a vertical run of rubies at the foot of column 4 once
 * the parked one trades in. The first two set up the SECOND step: a beryl at
 * `(4,1)` and a beryl at `(5,4)`, either side of the beryl the filler already
 * holds at `(3,4)`. Clearing three cells at the foot of column 4 drops that
 * column by three, which lands the beryl from `(4,1)` at `(4,4)` — between the
 * two — so row 4 carries a run of three beryls the moment step 1 settles, out of
 * survivors alone.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: COL, row: 1, token: "B0" },
  { col: COL + 1, row: 4, token: "B0" },
  { col: COL, row: 5, token: "R0" },
  { col: COL, row: 7, token: "R0" },
  { col: COL + 1, row: 6, token: "R0" },
];

/** The swap that opens the chain: the parked ruby trades into `(4,6)`. */
const A: CellRef = { col: COL, row: 6 };
const B: CellRef = { col: COL + 1, row: 6 };

/** The cells step 1's run seeds. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 5 },
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

let h: Harness;

/**
 * The four cuts and the seven kinds as plain strings, so a value the BUILD
 * reported can be tested for membership without the union claiming it already
 * belongs.
 */
const CUT_NAMES: readonly string[] = CUTS;
const KIND_NAMES: readonly (string | null)[] = GEM_KINDS;

/** Everything specs/board.md requires of a settled board, read at one reading. */
function assertBoardWhole(snapshot: FacetSnapshot, when: string): void {
  const { cols, rows, cells } = snapshot.board;
  assertEqual(cols, GRID_COLS, `${when}: the columns the board reports`);
  assertEqual(rows, GRID_ROWS, `${when}: the rows the board reports`);
  assertLength(cells, GRID_COLS * GRID_ROWS, `${when}: cells reported`);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const at = `${when}: (${col},${row})`;
      const held = cells.filter((cell) => cell.col === col && cell.row === row);
      assertLength(held, 1, `${at}: gems reported there`);
      const gem = held[0];
      if (!CUT_NAMES.includes(gem.cut)) {
        fail(`one of the four cuts (${CUTS.join(", ")}) at ${at}`, gem.cut);
      }
      assertTrue(
        typeof gem.strain === "number" && Number.isFinite(gem.strain),
        `${at}: it reports a strain, and got ${String(gem.strain)}`,
      );
      // A kind of `null` is the prism's alone; every other cut names one of the
      // seven kinds, so an emptied cell cannot hide behind a null.
      if (gem.cut === "prism") {
        assertNull(gem.kind, `${at}: a prism's kind`);
      } else if (!KIND_NAMES.includes(gem.kind)) {
        fail(
          `one of the seven kinds (${GEM_KINDS.join(", ")}) at ${at}`,
          gem.kind,
        );
      }
    }
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hands back all 64 cells, one gem each, every time a step settles", async () => {
  const posed = quietRowsWith(SCENARIO);
  // The arrangement is proved rather than assumed: nothing matches on the posed
  // board, and the swap seeds exactly the three cells at the foot of column 4.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(swapped(posed, A, B)),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  loadBoard(h, posed);
  // Every reading is gathered first and judged after, so the still that stands
  // as this point's evidence is written whether the chain conformed or not.
  const readings: { snapshot: FacetSnapshot; when: string }[] = [];
  let snapshot = await swapAndStep(h, A, B);
  readings.push({ snapshot, when: `step ${snapshot.chainStep}` });
  let deepest = snapshot.chainStep;
  let reads = 0;
  while (snapshot.phase !== "idle" && reads < MAX_CHAIN_STEPS) {
    snapshot = await advanceStep(h);
    reads += 1;
    deepest = Math.max(deepest, snapshot.chainStep);
    readings.push({
      snapshot,
      when:
        snapshot.phase === "idle"
          ? "the settled board"
          : `step ${snapshot.chainStep}`,
    });
  }
  captureStill(h, "settled");

  // The point first, so a hole in the board is reported as a hole.
  for (const reading of readings) {
    assertBoardWhole(reading.snapshot, reading.when);
  }
  assertEqual(snapshot.phase, "idle", "the phase the chain ended in");
  // Then the arrangement: the scenario is only worth reading if it really drove
  // more than one step, and this says so rather than letting a one-step chain
  // pass for the multi-step chain the point is stated over.
  assertGreaterThanOrEqual(deepest, 2, "the deepest chain step driven");
});
