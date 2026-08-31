// Facet — board/opening-plain-and-clean: every gem of an opening board is plain,
// at strain 0, and carries one of the seven kinds.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/rules.md ends "The opening board" with
// the shape of what is on it: "Every gem on it is `plain` at strain `0`, with its
// kind drawn from `GEM_KINDS`". A round therefore starts from nothing: no
// brilliant, no star, no prism, and no gem already part-way to being flawed.
//
// WHY IT MATTERS RATHER THAN BEING COSMETIC. specs/rules.md makes every cut and
// every strain something the player EARNED — R8 creates a `brilliant` from a run
// of four, a `prism` from a run of five, a `star` from a crossing, and R7 raises
// strain around a clear set. A deal that hands out cuts or strain gives away R8's
// payoff and R7's pressure before a move has been made, and a `prism` in
// particular is a free clear of a whole kind under R5. A fresh board is also what
// a new level deals, so this is the state a round returns to each time it climbs.
//
// HOW IT IS READ. Straight off the cells the snapshot reports, field by field
// rather than through the notation, because the three facts are separate: `cut`
// is held to the literal `plain`, `strain` to the number `0`, and `kind` to
// membership of `GEM_KINDS` — which also rules out the `null` a prism reports,
// since a prism carries no kind at all.
//
// WHY SEVERAL SEEDS. Each seed is a different draw off the build's own random
// source, and the property has to hold of every board it deals rather than of a
// lucky one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { GEM_KINDS, GRID_COLS, GRID_ROWS } from "../constants";
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
function deal(seed: number): FacetSnapshot {
  h.debug.reset({ seed });
  return startRound(h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals 64 plain gems at strain 0, of the seven kinds, from every seed", async () => {
  for (const seed of SEEDS) {
    const opened = deal(seed);

    // Every cell has to be reported before "every gem is plain" means anything:
    // a board of forty cells would satisfy the loop below and still be no
    // opening board.
    assertEqual(opened.screen, "playing", `screen dealt from seed ${seed}`);
    assertLength(
      opened.board.cells,
      GRID_COLS * GRID_ROWS,
      `cells dealt from seed ${seed}`,
    );

    for (const cell of opened.board.cells) {
      const where = `(${cell.col},${cell.row}) dealt from seed ${seed}`;
      assertEqual(cell.cut, "plain", `${where}: cut`);
      assertEqual(cell.strain, 0, `${where}: strain`);
      // Membership rather than a comparison, because which of the seven kinds
      // the draw landed on is the build's business and no check may assert it.
      // `null` — what a prism reports — fails here, which is the reading that
      // says the deal put no prism on the board.
      assertContains(GEM_KINDS, cell.kind, `${where}: kind`);
    }

    if (seed === SEEDS[0]) {
      await h.advance(1);
      captureStill(h, "deal");
    }
  }
});
