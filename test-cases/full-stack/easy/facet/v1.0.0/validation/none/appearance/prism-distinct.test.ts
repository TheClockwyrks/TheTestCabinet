// Facet — appearance/prism-distinct: a prism is drawn apart from a gem of every
// kind, so it reads as carrying none.
//
// WHAT IS BEING DECIDED. specs/board.md gives a `prism` no kind at all — "A
// `plain`, `brilliant`, or `star` gem carries one of the seven kinds; a `prism`
// carries no kind" — and requires of the look that "a `prism` reads as belonging
// to no kind". specs/overview.md states it as one requirement over all seven at
// once: "A `prism` reads as carrying no kind, distinct at a glance from every gem
// that carries one." It is a requirement about all seven together rather than
// about any one of them, and it decides what a player believes a swap will do:
// under R5 a prism traded against a gem takes every gem of that gem's kind, so a
// prism a player reads as a ruby is a swap a player expects to clear the rubies.
//
// So no palette, no form and no treatment is read here. The one question with a
// yes/no answer is whether the prism is drawn the SAME as any one of the seven
// kinds, and that is what this decides. Nothing here says anything about whether
// the seven read apart from EACH OTHER: that is
// `appearance/kinds-distinguishable`, and this point neither asserts it nor
// depends on it.
//
// HOW ONE CELL DECIDES IT. Every reading is taken at ONE cell of one posed board,
// with the gem under it written through `setGem`, which specs/instrumentation.md
// defines as touching that cell alone. Everything but the gem is therefore held
// fixed — the same neighbors, the same board frame, the same background, the same
// box of device pixels — so a distance between two readings is a distance between
// two gems and nothing else.
//
// WHY THE PRISM IS READ SEVEN TIMES RATHER THAN ONCE. specs/board.md leaves the
// animation to the build, and a prism is the gem a build is most likely to give
// an idle turn to — it is the one gem with no kind to hold it still. A point that
// compared each kind against the prism as it looked at ONE instant would be
// deciding the requirement on whichever face of that turn happened to be showing.
// So the sweep alternates: the prism is written into the cell, read, then the
// kind, read, and so on through all seven. That leaves seven readings of the
// prism spread across the sweep and seven of the kinds, and EVERY pair of them
// must read more than PATCH_DISTINCT_MIN apart. The requirement is that a prism
// never reads as a gem carrying a kind, and forty-nine pairs is that requirement
// rather than a sample of it.
//
// THE CONTROL THAT MAKES THE READINGS MEAN SOMETHING. The distances above are
// only a reading of the two gems if the cell itself holds still between them. The
// sweep therefore ends by writing the first kind back into that same cell and
// reading it once more, a whole sweep after its first reading: that pair is what
// the instrument sees when the gem did not change, and it must stay within
// PATCH_SAME_MAX.
//
// THE CURSOR IS PARKED OFF THE PROBE CELL, since specs/ui.md marks the cell at
// `state.cursor` and a mark standing there would sit over every reading alike.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape, tokenOf, withCells } from "../board";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { GEM_KINDS, PATCH_DISTINCT_MIN, PATCH_SAME_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  patchDistance,
  readPatch,
  type Harness,
  type Patch,
} from "../harness";

/**
 * The cell every reading is taken at.
 *
 * Mid-board, so the box `readPatch` cuts is a whole cell's worth of pixels rather
 * than one clamped at a canvas edge, and clear of the escape swap's corner. The
 * quiet filler holds another kind at each of its four orthogonal neighbors and at
 * both cells beyond them on each axis, so whatever is written here joins no run
 * under R4 and the board simply stands.
 */
const PROBE_COL = 3;
const PROBE_ROW = 3;

/** Where the cursor is sent, so its mark never sits on the probe cell. */
const PARKED_COL = 0;
const PARKED_ROW = 0;

/**
 * A prism at strain `0`.
 *
 * Written with no kind, which is what specs/board.md gives a prism: its `X` in
 * the notation "names its cut", and the kind a token would otherwise carry is
 * absent rather than set to anything.
 */
const PRISM = tokenOf(null, 0, "prism");

/** The board every reading is taken over: the run-free filler, with its escape. */
const BOARD = quietRowsWithEscape([]);

/**
 * Real milliseconds the produced art is given before the first reading.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a sweep begun before they
 * arrive could compare a placeholder against a finished sprite. This spends REAL
 * time only: the simulation stands still through it.
 */
const ART_SETTLE_MS = 250;

/** A prism at the end of a row of all seven kinds, posed for the `prism` output alone. */
const PRISM_ROW = withCells(BOARD, [
  ...GEM_KINDS.map((kind, col) => ({
    col,
    row: PROBE_ROW,
    token: tokenOf(kind, 0),
  })),
  { col: GEM_KINDS.length, row: PROBE_ROW, token: PRISM },
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a prism apart from a plain gem of every one of the seven kinds", async () => {
  await loadBoard(h, BOARD);
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);
  await h.advance(1);

  // The prism and one kind after another into the same cell, a frame each so the
  // build draws what it was handed. Alternating them leaves the prism sampled
  // across the whole sweep rather than at one instant of whatever it does.
  const prisms: Patch[] = [];
  const gems: Patch[] = [];
  for (const kind of GEM_KINDS) {
    await h.debug.setGem(PROBE_COL, PROBE_ROW, PRISM);
    await h.advance(1);
    prisms.push(await readPatch(h, PROBE_COL, PROBE_ROW));

    await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(kind, 0));
    await h.advance(1);
    gems.push(await readPatch(h, PROBE_COL, PROBE_ROW));
  }

  // The control: the first kind written back into the same cell, a full sweep
  // later than its first reading.
  await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(GEM_KINDS[0], 0));
  await h.advance(1);
  const again = await readPatch(h, PROBE_COL, PROBE_ROW);

  // Evidence, and no part of the verdict: the prism beside all seven kinds.
  await loadBoard(h, PRISM_ROW);
  await h.advance(1);
  await captureStill(h, "prism");

  assertLessThanOrEqual(
    patchDistance(gems[0], again),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself with a plain ` +
      `${GEM_KINDS[0]} written into it twice`,
  );

  for (let kindAt = 0; kindAt < GEM_KINDS.length; kindAt += 1) {
    for (let prismAt = 0; prismAt < prisms.length; prismAt += 1) {
      assertGreaterThan(
        patchDistance(prisms[prismAt], gems[kindAt]),
        PATCH_DISTINCT_MIN,
        `how far the prism read at sample ${prismAt + 1} and a plain ` +
          `${GEM_KINDS[kindAt]} read apart at cell (${PROBE_COL},${PROBE_ROW})`,
      );
    }
  }
});
