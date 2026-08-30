// instrumentation/reset-seed-repeats-deal — one seed deals one board.
//
// THE RULE. specs/instrumentation.md rests the whole surface on a deterministic
// core: "Any randomness the game uses runs off a generator seeded from the
// state's generator field ... so reseeding and replaying the same calls
// reproduces the same result exactly. The deal's shuffle ... [is] drawn from
// it." `reset`'s `options.seed` is what seeds it. So `reset({ seed })` followed
// by `deal()`, twice, has to put the same fifty-two cards in the same places.
//
// THE READING IS THE ARRANGEMENT, NOT THE IDS. What the seed fixes is which
// card is dealt where and which way up (specs/deal.md); the id a card is handed
// is the build's own numbering, and specs/instrumentation.md requires only that
// ids are distinct among the entities live at a moment and kept while a card is
// on the table. So the two boards are compared by suit, rank and face, pile by
// pile and row by row — a build that renumbers between deals is not wrong, and a
// build that dealt a different board is.
//
// A WHOLE BOARD, NOT A SAMPLE. Every one of the thirteen piles is compared, in
// order, so a build whose columns reproduce but whose stock does not fails here.
//
// THE FIRST BOARD IS READ AS NON-EMPTY FIRST. An empty board reproduces another
// empty board perfectly, so a build whose `deal` laid out nothing would pass a
// comparison of two of them without any generator at all. That reading is a
// precondition and not the requirement: how many cards a deal lays out is the
// `deal` group's.
//
// WHAT IT DOES NOT DECIDE. That the deal is a full deck dealt into the shape
// specs/deal.md fixes is the `deal` group's; that two DIFFERENT seeds differ is
// `instrumentation/reset-seed-differs`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  everyCard,
  resetTo,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The seed both deals are taken from. Any seed the specification permits. */
const SEED = 20260830;

/**
 * The board as the seed fixes it: where every card lies, and which way up.
 *
 * The pile, the row, the suit, the rank and the face — everything
 * specs/deal.md decides — and deliberately not the id, which the specification
 * leaves to the build.
 */
function arrangement(snapshot: CascadeSnapshot): string[] {
  return everyCard(snapshot).map(
    (site) =>
      `${site.pile}${site.index}:${site.row}=` +
      `${site.card.suit}-${site.card.rank}-${site.card.faceUp ? "up" : "down"}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals the identical arrangement of all fifty-two cards from one seed, twice", async () => {
  resetTo(h, SEED);
  h.debug.deal();
  const first = arrangement(h.snapshot());

  resetTo(h, SEED);
  h.debug.deal();
  const second = arrangement(h.snapshot());

  // The board the seed dealt, drawn on the table it is played on.
  h.debug.setScreen("playing");
  await h.drawFrame();
  captureStill(h, "dealt");

  assertGreaterThan(
    first.length,
    0,
    `cards the first deal from seed ${SEED} put on the table: two empty ` +
      "boards reproduce each other whatever the generator did (specs/deal.md)",
  );

  assertDeepEqual(
    second,
    first,
    `the board dealt from seed ${SEED}, against the board the same seed ` +
      "dealt before it: the shuffle runs off the seeded generator, so " +
      "reseeding and dealing again reproduces it exactly " +
      "(specs/instrumentation.md)",
  );
});
