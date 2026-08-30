// instrumentation/card-ids-distinct — every card on the table carries an id of
// its own.
//
// THE RULE. specs/instrumentation.md, under Identity: "Every card and every
// flyer carries an `id`: a number, distinct among the entities live at any
// moment, reported by `snapshot` and taken by every per-entity operation." An
// id is how a scenario names one card out of fifty-two — `removeCard`,
// `setCardFaceUp` and every reading that follows a card across a move take one —
// so two cards sharing an id makes the surface ambiguous everywhere.
//
// A FULL DEALT BOARD IS THE HARDEST CASE AND THE ONLY ONE WORTH READING. The
// deal is where fifty-two cards are created at once, so a build whose numbering
// restarts per pile, or is derived from a card's position in its pile, collides
// there and nowhere else.
//
// THE COUNT IS TAKEN OFF THE BOARD RATHER THAN FIXED AT FIFTY-TWO. That a deal
// puts fifty-two cards on the table is `deal.full-deck`'s requirement, and
// charging it here as well would dock one defect twice. What this reads is that
// however many cards the build dealt, no two of them share a number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dealInPlay,
  everyCard,
  type Harness,
} from "../harness";

/** The seed the board is dealt from. Any seed the specification permits. */
const SEED = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every card of a dealt board an id no other card carries", async () => {
  dealInPlay(h, SEED);
  const dealt = everyCard(h.snapshot());
  const ids = dealt.map((site) => site.card.id);

  await h.advance(1);
  captureStill(h, "dealt");

  assertEqual(
    new Set(ids).size,
    ids.length,
    `distinct ids across the ${ids.length} cards on a dealt board: an id is ` +
      "distinct among the entities live at any moment " +
      "(specs/instrumentation.md)",
  );
});
