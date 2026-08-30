// instrumentation/reset-seed-differs — the seed is what decides the deal, so two
// different seeds deal two different boards.
//
// THE RULE. `specs/instrumentation.md`: "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness", and the randomness
// "runs off a generator seeded from the state's generator field". `specs/deal.md`
// puts the shuffle itself beyond doubt: "Every new game deals from a full deck
// shuffled uniformly at random, so every ordering of the fifty-two cards is as
// likely as any other and each new game is dealt afresh."
//
// WHY IT IS ITS OWN POINT, BESIDE `reset-seed-repeats-deal`. A build that ignores
// the seed entirely and deals one fixed board passes repeatability perfectly and
// fails here; a build that ignores the seed and shuffles from a source of its own
// passes here and fails repeatability. The pair pins the generator down from both
// sides, and a failed grade names which half is wrong.
//
// TWO DIFFERENT ARRANGEMENTS IS THE WHOLE OF THE READING. Nothing here asks the
// two boards to differ in any particular way, and nothing asks them to differ by
// much: a build that shuffles from its seed differs everywhere, and one that
// ignores the seed differs nowhere. Two conforming shuffles agreeing card for
// card is one arrangement in fifty-two factorial, which is a number with sixty-
// eight digits in it.
//
// NEITHER SEED IS `DEFAULT_SEED`, so a build that reads the seed only when the
// caller omitted it is exercised on both calls rather than on one.
//
// WHAT THIS DOES NOT DECIDE. That the shuffle is UNIFORM — `deal/shuffle-varies`
// grades how much two fresh deals differ — nor that either board is a legal deal,
// which is `deal/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotEqual } from "../assert";
import { DEFAULT_SEED, SUITS, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  createHarness,
  everyCard,
  pileOf,
  type CardView,
  type CascadeSnapshot,
  type Harness,
  type PileName,
} from "../harness";

/** The two seeds. Both deliberately away from `DEFAULT_SEED`. */
const FIRST_SEED = 20250830;
const SECOND_SEED = 987654321;

/** The thirteen piles, under the names `specs/instrumentation.md` addresses them by. */
const PILES: readonly { key: string; pile: PileName; index: number }[] = [
  { key: "the stock", pile: "stock", index: 0 },
  { key: "the waste", pile: "waste", index: 0 },
  ...SUITS.map((_, index) => ({
    key: `foundation ${index}`,
    pile: "foundation" as PileName,
    index,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, index) => ({
    key: `column ${index}`,
    pile: "tableau" as PileName,
    index,
  })),
];

/** One pile as suits, ranks and faces, bottom card first. Ids are deliberately out. */
function printPile(cards: readonly CardView[]): string {
  return cards.length === 0
    ? "(empty)"
    : cards.map((c) => `${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`).join(" ");
}

/** The whole board as one comparable string. */
function board(s: CascadeSnapshot): string {
  return PILES.map(
    (place) => `${place.key}: ${printPile(pileOf(s, place.pile, place.index))}`,
  ).join(" | ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals a different arrangement from a different seed", async () => {
  await h.debug.reset({ seed: FIRST_SEED });
  await h.debug.deal();
  const first = await h.snapshot();

  await h.debug.reset({ seed: SECOND_SEED });
  await h.debug.deal();
  const second = await h.snapshot();

  // The screen is posed so the picture is of the table rather than of the title
  // `reset` leaves behind. `setScreen` changes no other field.
  await h.debug.setScreen("playing");
  await h.advance(1);
  // Before the assertions, so two identical boards still leave the picture of
  // the second one.
  await captureStill(h, "dealt");

  assertGreaterThan(
    everyCard(first).length,
    0,
    `the cards seed ${FIRST_SEED} put on the table — two empty boards would ` +
      `be identical whatever the seed did`,
  );

  assertNotEqual(
    board(second),
    board(first),
    `the board seed ${SECOND_SEED} dealt, against the one seed ${FIRST_SEED} ` +
      `dealt — the seed seeds all of the game's randomness ` +
      `(specs/instrumentation.md), and a build ignoring it deals one fixed ` +
      `board whatever it is given. Neither seed is DEFAULT_SEED ` +
      `(${DEFAULT_SEED})`,
  );
});
