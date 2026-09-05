// Facet — appearance/swap-animates: partway through an accepted swap the two
// cells are drawn holding neither the gems they started with nor the gems they
// settle into, so the two stones are in transit between their cells.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the swap among the three things in
// motion on the `playing` screen — "An accepted swap — While `state.phase` is
// `swapping`, the two swapped gems travel between their two cells rather than
// appearing in them" — and specs/overview.md holds the same line: "A swap, a
// shattering set, and falling gems are each drawn moving over the spans
// `specs/rules.md` gives them." specs/rules.md gives this one its span: an
// accepted swap "exchanges the two cells at once, sets `phase` to `swapping`
// ... Nothing is cleared yet: the two gems are in motion between their cells for
// `SWAP_SECONDS` (`0.18`) of game time." specs/assets.md names the failure it
// rules out in its closing list, alongside a gem teleported into its cell.
//
// WHY THE READING TAKES TWO COMPARISONS AND NOT ONE. The state has already
// exchanged the two cells by the time the animation runs, so there are exactly
// two ways to draw the swap wrong and each of them survives one of the two
// comparisons on its own:
//
//   - a build that paints the exchanged board from the accepting frame draws the
//     arrangement the swap SETTLES into, and reads apart from the one before it;
//   - a build that leaves both gems where they were until the timer runs out
//     draws the arrangement BEFORE the swap, and reads apart from the one after.
//
// So the mid-flight reading of each cell is held apart from both still
// arrangements at once, each posed outright through `loadBoard` and rendered on a
// board at rest. A gem caught between its two cells is in neither box, and reads
// apart from both.
//
// WHERE THE SAMPLE IS TAKEN. As near the middle of `SWAP_SECONDS` as the suite's
// frame grid reaches: `SWAP_SECONDS` is `11.52` frames of the 64 Hz clock, and
// six frames is `0.09375` s, `52%` of the way through. The middle rather than an
// early frame because specs/rules.md fixes the span and leaves the easing to the
// build, and a build that starts its travel slowly has still carried the gems
// most of the way by the halfway point. The phase is read back as `swapping` at
// the sample, so a reading taken after a build had already resolved the swap
// fails as the animation it is rather than as a pixel comparison.
//
// WHAT IS NOT READ. Where the gems are, how they travel, or whether they pass
// through the midpoint. specs/rules.md fixes the span and nothing about the path,
// so a build that arcs its stones and one that slides them both pass.

import { afterEach, beforeEach, it } from "vitest";
import {
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { SWAP_SECONDS, TICK_S } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  patchDistance,
  readPatch,
  requestSwap,
  type Harness,
  type Patch,
} from "../harness";

/**
 * The cells the swap exchanges: the waiting ruby at `(5,2)` and the filler's own
 * gem at `(5,3)`, which the exchange carries into a run of three rubies across
 * row 3.
 *
 * The pair is orthogonally adjacent and the exchange is productive, so R1, R2 and
 * R3 accept it and the swap really animates rather than being refused.
 */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/** Two rubies waiting in row 3, and the third that the swap carries down to them. */
const CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/**
 * Frames driven into the swap before the mid-flight reading is taken.
 *
 * NOT a specification figure: it is half of `SWAP_SECONDS` rounded onto the
 * suite's own frame grid. Six frames is `0.09375` s of the `0.18` s the swap
 * runs for, so the sample sits just past the middle and well short of the end,
 * whether the build compares its timer with `>=` or `>`.
 */
const MID_FRAMES = Math.round(SWAP_SECONDS / (2 * TICK_S));

/**
 * Real milliseconds the produced art is given before the first reading.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a reading taken before
 * they arrive could hold a placeholder. This spends REAL time only: the
 * simulation stands still through it.
 */
const ART_SETTLE_MS = 250;

/** One render, read at both of the swapped cells. */
interface Reading {
  from: Patch;
  to: Patch;
}

let h: Harness;

/** Both swapped cells, off the frame the canvas is holding. */
function readBoth(): Reading {
  return {
    from: readPatch(h, FROM.col, FROM.row),
    to: readPatch(h, TO.col, TO.row),
  };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the two swapped cells apart from both the board before the swap and the board after it", async () => {
  const rows = quietRowsWithEscape(CELLS);
  const exchangedRows = swapped(rows, FROM, TO);

  // The scenario, established off the written boards before the build is asked
  // anything: nothing on the posed board matches, and the move rules accept the
  // exchange, so what follows really is a swap in motion.
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(rows, FROM, TO), "R1 and R3 accept the swap");

  // The arrangement before the swap, posed outright and at rest.
  loadBoard(h, rows);
  await h.settle(ART_SETTLE_MS);
  await h.advance(1);
  const before = readBoth();

  // The arrangement the swap settles into, posed the same way. A posed board
  // rests as it was written until a swap is accepted on it
  // (specs/instrumentation.md), so the run standing on it clears nothing.
  loadBoard(h, exchangedRows);
  await h.advance(1);
  const after = readBoth();

  // And the swap itself, sampled just past the middle of its span.
  const mid = await captureReplay(h, "swap", async () => {
    loadBoard(h, rows);
    const requested = requestSwap(h, FROM, TO);
    assertEqual(
      requested.phase,
      "swapping",
      "the phase the accepted swap opened",
    );
    await h.advance(MID_FRAMES);
    const flying = h.snapshot();
    assertEqual(
      flying.phase,
      "swapping",
      `the phase ${MID_FRAMES} frames into a swap of ${SWAP_SECONDS} s`,
    );
    return readBoth();
  });

  // Each of the two cells, held apart from both still arrangements at once.
  const comparisons = [
    { cell: FROM, flying: mid.from, still: before.from, when: "before" },
    { cell: FROM, flying: mid.from, still: after.from, when: "after" },
    { cell: TO, flying: mid.to, still: before.to, when: "before" },
    { cell: TO, flying: mid.to, still: after.to, when: "after" },
  ] as const;
  for (const { cell, flying, still, when } of comparisons) {
    assertGreaterThan(
      patchDistance(flying, still),
      0,
      `how far cell (${cell.col},${cell.row}) reads mid-swap from the same ` +
        `cell on the board ${when} the swap`,
    );
  }
});
