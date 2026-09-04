// instrumentation/reset-seed-differs — two seeds deal two boards.
//
// THE RULE. specs/deal.md has every new game dealt "from a full deck shuffled
// uniformly at random, so every ordering of the fifty-two cards is as likely as
// any other and each new game is dealt afresh", and
// specs/instrumentation.md runs that shuffle off the generator `reset`'s
// `options.seed` seeds. A build whose deal ignores the generator — a fixed
// arrangement, or a shuffle that always draws the same numbers — reproduces
// perfectly from any seed and passes `instrumentation/reset-seed-repeats-deal`.
// This is the reading that separates a seeded shuffle from no shuffle at all.
//
// THE READING IS THE ARRANGEMENT, NOT THE IDS, for the same reason as the point
// beside it: which card lies where and which way up is what specs/deal.md
// decides, and the numbering is the build's.
//
// TWO SEEDS, AND ONLY A DIFFERENCE IS DEMANDED. Nothing here says HOW two
// boards must differ or by how much; a shuffle uniform over 52! orderings
// repeats a board with a probability no reader can write down, so any
// difference at all is the honest bound, and a build that returns one board for
// every seed is the only thing that fails.
//
// WHAT IT DOES NOT DECIDE. That a deal is a full deck in the shape specs/deal.md
// fixes is the `deal` group's, and `deal.reshuffled` reads two seeds' COLUMNS
// for the same reason from the rules side. This point is the surface's: the seed
// `reset` takes really reaches the shuffle.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  everyCard,
  resetTo,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The two seeds, which differ. Nothing else about them matters. */
const FIRST_SEED = 11;
const SECOND_SEED = 12;

/** Where every card lies and which way up, as specs/deal.md decides it. */
function arrangement(snapshot: CascadeSnapshot): string[] {
  return everyCard(snapshot).map(
    (site) =>
      `${site.pile}${site.index}:${site.row}=` +
      `${site.card.suit}-${site.card.rank}-${site.card.faceUp ? "up" : "down"}`,
  );
}

/** How many places the two boards disagree in, counting a length gap as one. */
function differences(first: string[], second: string[]): number {
  const shared = Math.min(first.length, second.length);
  let apart = Math.abs(first.length - second.length);
  for (let i = 0; i < shared; i += 1) {
    if (first[i] !== second[i]) apart += 1;
  }
  return apart;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals different boards from two different seeds", async () => {
  resetTo(h, FIRST_SEED);
  h.debug.deal();
  const first = arrangement(h.snapshot());

  resetTo(h, SECOND_SEED);
  h.debug.deal();
  const second = arrangement(h.snapshot());

  // The second seed's board, drawn on the table it is played on.
  h.debug.setScreen("playing");
  await h.drawFrame();
  captureStill(h, "dealt");

  assertGreaterThan(
    differences(first, second),
    0,
    `places the board dealt from seed ${SECOND_SEED} differs from the board ` +
      `dealt from seed ${FIRST_SEED} in: the shuffle is drawn from the ` +
      "generator the seed sets, so two seeds deal two boards " +
      "(specs/instrumentation.md, specs/deal.md)",
  );
});
