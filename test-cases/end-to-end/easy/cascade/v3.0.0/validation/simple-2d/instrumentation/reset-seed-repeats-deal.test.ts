// instrumentation/reset-seed-repeats-deal — one seed deals one board, every time.
//
// specs/instrumentation.md "A deterministic core": any randomness the game uses
// runs off a generator seeded from the state's generator field and keeps its whole
// generator state there, "so reseeding and replaying the same calls reproduces the
// same result exactly", and the deal's shuffle is named as one of the two draws it
// makes. `reset`'s `options.seed` is what seeds it. Given the same seed and the
// same sequence of calls, the game reaches the same state every time.
//
// THE DEAL IS WHAT THIS READS, because it is the largest single draw the game
// makes: specs/deal.md shuffles fifty-two cards uniformly and lays them out
// twenty-eight to the columns and twenty-four to the stock. Two independent
// shuffles agreeing card for card does not happen, so an arrangement repeating
// exactly is a seeded generator and nothing else.
//
// THE ARRANGEMENT IS READ AS CARDS, NOT AS IDS. What has to repeat is which card
// lies where and which way up, so the board is written out as one string per pile
// of rank-and-suit specs, face-down cards marked. The ids a build hands out are its
// own business and are decided by `instrumentation.card-ids-distinct`.
//
// WHAT IT DOES NOT DECIDE. Nothing about the deal itself: how many cards each
// column holds, which of them are face-down and how many are left in the stock are
// the `deal` group's points. This one compares one deal against another.
//
// THE SEED IS NAMED RATHER THAN LEFT TO THE DEFAULT, so the reading is of
// `options.seed` doing its work rather than of two calls that happened to be handed
// the same `DEFAULT_SEED`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  pileSpecs,
  tableCards,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The seed both deals are made from. Any number serves; this one is not the default. */
const SEED = 7;

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

it("deals the identical board twice from one seed", async () => {
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

  const first = dealFrom(SEED);

  // The board the seed dealt.
  h.debug.setScreen("playing");
  await h.advance(1);
  captureStill(h, "dealt");

  const again = dealFrom(SEED);

  assertEqual(
    again,
    first,
    `two deals made after reset({ seed: ${SEED} }) must lay out the identical ` +
      "fifty-two cards (specs/instrumentation.md)",
  );
});
