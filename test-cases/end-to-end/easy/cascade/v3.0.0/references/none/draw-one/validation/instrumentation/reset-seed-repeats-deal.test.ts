// instrumentation/reset-seed-repeats-deal — one seed deals one board: reseeding
// and replaying the same call reproduces the same fifty-two cards exactly.
//
// THE RULE. `specs/instrumentation.md`, A deterministic core: "Any randomness the
// game uses runs off a generator seeded from the state's generator field, and it
// keeps its whole generator state in that field, so reseeding and replaying the
// same calls reproduces the same result exactly. The deal's shuffle and the
// cascade's launch velocities are both drawn from it." `reset`'s own row fixes
// where the seed comes from: "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness."
//
// WHY IT IS CAPPED AT `passable` AND NOT `broken`. A build whose seeded deal does
// not reproduce is a completely playable game of Klondike: the player loses
// nothing. What is lost is the ability to replay a board, which is the case's
// business rather than the player's.
//
// THE COMPARISON IS OF THE ARRANGEMENT, NOT OF THE IDS. What the specification
// makes reproducible is the shuffle: which card lies where, and which way up. Ids
// are the build's own bookkeeping and nothing requires a second deal to hand out
// the same numbers, so the board is printed as suits, ranks and faces, pile by
// pile, and the ids are left out of it.
//
// THE SEED IS NOT `DEFAULT_SEED`, so a build that accepted `options` and ignored
// the seed inside it is exercised rather than flattered by the default it would
// have used anyway.
//
// WHAT THIS DOES NOT DECIDE. That the deal is a legal Klondike deal — twenty-eight
// cards to seven columns, one face-up each, twenty-four to the stock — which is
// `deal/*`'s, nor that different seeds differ, which is
// `instrumentation/reset-seed-differs`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

/** The seed both deals are made from. Deliberately not `DEFAULT_SEED`. */
const SEED = 20250830;

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

/** Every pile of a board, keyed by the name a failure should name. */
function board(s: CascadeSnapshot): Record<string, string> {
  const printed: Record<string, string> = {};
  for (const place of PILES) {
    printed[place.key] = printPile(pileOf(s, place.pile, place.index));
  }
  return printed;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals the same arrangement from the same seed twice", async () => {
  await h.debug.reset({ seed: SEED });
  await h.debug.deal();
  const first = await h.snapshot();

  await h.debug.reset({ seed: SEED });
  await h.debug.deal();
  const second = await h.snapshot();

  // The screen is posed so the picture is of the table rather than of the title
  // `reset` leaves behind. `setScreen` changes no other field
  // (`specs/instrumentation.md`), so nothing read below moves.
  await h.debug.setScreen("playing");
  await h.advance(1);
  // Before the assertions, so a board that did not reproduce still leaves the
  // picture of the second deal.
  await captureStill(h, "dealt");

  assertGreaterThan(
    everyCard(first).length,
    0,
    `the cards the first deal put on the table — an empty board would ` +
      `reproduce trivially and say nothing about the seed`,
  );

  const a = board(first);
  const b = board(second);
  for (const place of PILES) {
    assertEqual(
      b[place.key],
      a[place.key],
      `${place.key} after reset({ seed: ${SEED} }) and deal() a second time, ` +
        `against what the same seed dealt the first time — reseeding and ` +
        `replaying the same calls reproduces the same result exactly ` +
        `(specs/instrumentation.md), and the default seed this scenario does ` +
        `NOT use is ${DEFAULT_SEED}`,
    );
  }
});
