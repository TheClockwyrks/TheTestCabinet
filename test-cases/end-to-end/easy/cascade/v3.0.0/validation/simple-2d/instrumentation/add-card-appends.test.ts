// instrumentation/add-card-appends — `addCard` puts its card on the pile's top.
//
// specs/instrumentation.md: `addCard` "adds one card of `suit` and `rank` to the
// top of the named pile", and "the card is appended, so it is the pile's last
// entry". A pile is reported bottom card first, so the last entry is the card on
// top, and in a column it is the card drawn lowest on the table, which is the one a
// run is stacked onto.
//
// WHY THE WHOLE SUITE RESTS ON IT. `posePile` in `harness.ts` builds every scenario
// in this project one `addCard` at a time and takes the order it was given to be
// the order the pile ends up in. A build that inserted at the bottom instead would
// pose every scenario upside down: a column whose face-down cards ended up lowest,
// a foundation whose Ace was on top, a stock whose next turn took the wrong card.
// So the rule is proved here before anything leans on it.
//
// ALL FOUR KINDS OF PILE, because `addCard` names a pile by two scalars and a build
// is free to hold each kind differently; a build that appends to a column and
// prepends to the waste is caught by the same loop.
//
// THE THREE CARDS ARE ALL DIFFERENT, so where each one landed is legible in the
// reading: a build that appended to the front reports them reversed, one that
// replaced the pile reports one card, and one that dropped the call reports two.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  parseCard,
  pileOf,
  pileSpecs,
  posePile,
  type Harness,
} from "../harness";
import { EVERY_PILE, pileName } from "./board";

/** The two cards each pile is given, and the third that is added on top of them. */
const STANDING = ["3D", "9C"];
const ADDED = "KH";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds its card as the pile's third and last entry", async () => {
  openTable(h);

  for (const ref of EVERY_PILE) {
    posePile(h, ref.pile, ref.index, STANDING);
  }

  for (const ref of EVERY_PILE) {
    const card = parseCard(ADDED);
    h.debug.addCard(ref.pile, ref.index, card.suit, card.rank, card.faceUp);
  }

  const after = h.snapshot();

  // The thirteen piles, each with the added card on its top.
  await h.advance(1);
  captureStill(h, "pile");

  for (const ref of EVERY_PILE) {
    assertDeepEqual(
      pileSpecs(pileOf(after, ref.pile, ref.index)),
      [...STANDING, ADDED],
      `${pileName(ref)}, bottom card first: addCard appends to the pile's top ` +
        "(specs/instrumentation.md)",
    );
  }
});
