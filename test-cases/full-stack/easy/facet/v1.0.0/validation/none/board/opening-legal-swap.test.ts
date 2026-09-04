// Facet — board/opening-legal-swap: the board a round opens on carries at least
// one legal swap, and the snapshot says so.
//
// WHAT THE SPECIFICATION ASKS FOR. This is the second of the two properties
// specs/rules.md gives an opening board: "at least one legal swap exists on it".
// The same file defines the term — "a legal swap is a pair of orthogonally
// adjacent cells whose exchange R1 and R3 both accept" — and makes it the end of
// a round: when a chain settles on a board with no legal swap left, the screen
// becomes `gameover`. A deal with no move on it is therefore a round that is over
// before the player has touched it, and a build that deals one has broken the
// game outright rather than merely dealt an awkward board.
//
// THE TWO READINGS, AND WHY BOTH. The first is the board itself: every
// orthogonally adjacent pair is exchanged here, on this side, and R3 is applied
// to what the exchange produces — a maximal run under R4, or a prism in either of
// the two cells. That is the property the specification states, computed from the
// specification's own rules over the board the build dealt. The second is
// `legalSwap`, which the snapshot shape derives from "R1 and R3 in
// specs/rules.md, over the board as it stands" and which the game's own end
// condition reads: a build whose deal is fine but whose derived field says `false`
// is a build that ends a playable round. The specification requires both to be
// true of an opening board, so both are read.
//
// WHY SEVERAL SEEDS. A build that never checks its deal still passes on a seed
// that happens to draw a playable board. specs/instrumentation.md makes a round
// from a known deal `reset` carrying a seed followed by a `dealBoard`, which is
// what the harness's `startRound` runs, so a dozen seeds are dealt and the property must hold of every one of them.

import { afterEach, beforeEach, it } from "vitest";
import { legalSwaps } from "../board";
import { assertEqual, assertLength, fail } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  startRound,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * The seeds a round is dealt from.
 *
 * Twelve arbitrary positive numbers, each a different draw off the build's own
 * seeded source. Nothing is asserted about any particular one.
 */
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 7777, 99991] as const;

let h: Harness;

/** Seed the game's random source and open a fresh round on it. */
async function deal(seed: number): Promise<FacetSnapshot> {
  await h.debug.reset({ seed });
  return startRound(h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals an opening board a move can be played on, from every seed", async () => {
  for (const seed of SEEDS) {
    const opened = await deal(seed);

    // A whole board first: R1 and R3 read over a board reported short would find
    // fewer pairs than the deal actually offers.
    assertEqual(opened.screen, "playing", `screen dealt from seed ${seed}`);
    assertLength(
      opened.board.cells,
      GRID_COLS * GRID_ROWS,
      `cells dealt from seed ${seed}`,
    );

    const rows = await h.board();
    const swaps = legalSwaps(rows);
    if (swaps.length === 0) {
      // The whole board is shown, because "no move exists" is a statement about
      // all 112 adjacent pairs at once and a reviewer has to be able to see it.
      fail(
        `at least one legal swap on the board dealt from seed ${seed}`,
        `none, on ${rows.map((row) => row.trim()).join(" | ")}`,
      );
    }

    // And the game's own derived reading agrees. This is the field the end
    // condition consults, so a deal that is playable while the build believes it
    // is not is still a round that ends on the first settle.
    assertEqual(
      opened.legalSwap,
      true,
      `legalSwap on the board dealt from seed ${seed}, which carries ` +
        `${swaps.length} legal swap(s)`,
    );

    if (seed === SEEDS[0]) {
      await h.advance(1);
      await captureStill(h, "deal");
    }
  }
});
