// instrumentation/reset-seed-differs — two seeds deal two boards.
//
// specs/instrumentation.md seeds all of the game's randomness from `reset`'s
// `options.seed`, and specs/deal.md shuffles the deck "uniformly at random, so
// every ordering of the fifty-two cards is as likely as any other". The two
// sentences together say that the seed is what the shuffle depends on: a build that
// ignored it would deal the same board from every seed, and one that ignored the
// generator entirely would deal from an unseeded source and fail the point beside
// this one.
//
// THIS IS THE OTHER HALF OF `reset-seed-repeats-deal`, and it is its own point
// because the two failures are different builds. A build that seeds nothing and
// reshuffles from a fresh random source each time passes neither; a build whose
// `reset` drops the seed argument and always winds back to `DEFAULT_SEED` passes
// the repeat and fails this one; a build that caches the first deal it ever made
// passes this one only by chance and fails the repeat.
//
// TWO INDEPENDENT SHUFFLES OF FIFTY-TWO CARDS AGREEING is a coincidence with odds
// no run will ever meet, so the comparison needs no tolerance: two different seeds
// must not lay the same board.
//
// THE ARRANGEMENT IS READ AS CARDS, NOT AS IDS, for the reason
// `reset-seed-repeats-deal` states.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE } from "../../src/constants";
import { assertLength, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pileSpecs,
  tableCards,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The two seeds compared. Any two distinct numbers serve. */
const SEED_A = 7;
const SEED_B = 8;

/** The whole board as one string: every pile, bottom card first. */
function arrangement(snapshot: CascadeSnapshot): string {
  return [
    pileSpecs(snapshot.stock).join(","),
    pileSpecs(snapshot.waste).join(","),
    ...snapshot.foundations.map((pile) => pileSpecs(pile).join(",")),
    ...snapshot.tableau.map((pile) => pileSpecs(pile).join(",")),
  ].join(" | ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a different board from a different seed", async () => {
  /** Seed the game and deal, and answer the board that was laid out. */
  const dealFrom = (seed: number): string => {
    h.debug.reset({ seed });
    h.debug.deal();
    const dealt = h.snapshot();
    assertLength(
      tableCards(dealt),
      DECK_SIZE,
      "the cards a deal puts on the table, which is the whole deck " +
        "(specs/deal.md)",
    );
    return arrangement(dealt);
  };

  const first = dealFrom(SEED_A);
  const other = dealFrom(SEED_B);

  // The board the second seed dealt.
  h.debug.setScreen("playing");
  await h.advance(1);
  captureStill(h, "dealt");

  assertNotEqual(
    other,
    first,
    `the deal made after reset({ seed: ${SEED_B} }) must differ from the one ` +
      `made after reset({ seed: ${SEED_A} }) (specs/instrumentation.md)`,
  );
});
