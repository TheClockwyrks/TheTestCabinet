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
// WHY SEVERAL DEALS. A build that never checks its deal still passes when the
// draw happens to come out playable. A round from the title is a `reset`
// followed by the harness's `startRound`, which deals through the build's own
// `dealBoard`, so several rounds are dealt and the property must hold of every
// one of them.

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
 * How many rounds are dealt.
 *
 * One deal proves nothing: a build that never checks its deal still passes when
 * the draw happens to come out right. Each deal here is a fresh draw off the
 * build's own random source, nothing is asserted about any particular one, and
 * the property under test has to hold of all of them.
 */
const DEALS = 8;

let h: Harness;

/** Open a fresh round from the title, which deals a fresh opening board. */
async function deal(): Promise<FacetSnapshot> {
  await h.debug.reset();
  return startRound(h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals an opening board a move can be played on, deal after deal", async () => {
  for (let deal_ = 1; deal_ <= DEALS; deal_ += 1) {
    const opened = await deal();

    // A whole board first: R1 and R3 read over a board reported short would find
    // fewer pairs than the deal actually offers.
    assertEqual(opened.screen, "playing", `screen of deal ${deal_}`);
    assertLength(
      opened.board.cells,
      GRID_COLS * GRID_ROWS,
      `cells of deal ${deal_}`,
    );

    const rows = await h.board();
    const swaps = legalSwaps(rows);
    if (swaps.length === 0) {
      // The whole board is shown, because "no move exists" is a statement about
      // all 112 adjacent pairs at once and a reviewer has to be able to see it.
      fail(
        `at least one legal swap on the board of deal ${deal_}`,
        `none, on ${rows.map((row) => row.trim()).join(" | ")}`,
      );
    }

    // And the game's own derived reading agrees. This is the field the end
    // condition consults, so a deal that is playable while the build believes it
    // is not is still a round that ends on the first settle.
    assertEqual(
      opened.legalSwap,
      true,
      `legalSwap on the board of deal ${deal_}, which carries ` +
        `${swaps.length} legal swap(s)`,
    );

    if (deal_ === 1) {
      await h.advance(1);
      await captureStill(h, "deal");
    }
  }
});
