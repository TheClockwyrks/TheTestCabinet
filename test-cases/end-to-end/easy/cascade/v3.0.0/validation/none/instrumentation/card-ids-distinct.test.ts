// instrumentation/card-ids-distinct — no two cards on the board carry the same
// id.
//
// THE RULE. `specs/instrumentation.md`, Identity: "Every card and every flyer
// carries an `id`: a number, distinct among the entities live at any moment,
// reported by `snapshot` and taken by every per-entity operation."
//
// WHY IT IS A `broken` POINT. The id is how every per-card operation names its
// card — `removeCard`, `setCardFaceUp`, and every check in this suite that
// follows one card across a move. A build that hands two cards the same number
// makes each of those operations ambiguous, and it does so silently: the wrong
// card turns, the wrong card is removed, and the point that reads the result
// reports a mechanic rather than the identity defect beneath it.
//
// THE BOARD IS A REAL DEAL, not a posed one, because that is where the ids are
// handed out in bulk: `deal()` replaces the contents of all thirteen piles at
// once (`specs/instrumentation.md`), so a build whose id counter restarts per
// pile, or that numbers cards by their position, collides here and nowhere a
// hand-posed board would reach.
//
// THE COMPARISON IS AGAINST THE BOARD'S OWN SIZE, not against fifty-two. Whether
// the deal produced a whole deck is `deal/full-deck`'s point, and a build that
// dealt fifty-one cards must fail there rather than twice: what is read here is
// that as many distinct ids were handed out as there are cards on the table.
//
// WHAT THIS DOES NOT DECIDE. How ids are ASSIGNED — nothing here requires them to
// count up, or to be small — nor whether a card keeps its id, which is
// `instrumentation/card-ids-stable`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  everyCard,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives every card on a dealt board an id no other card carries", async () => {
  await openTable(h);
  await h.debug.deal();

  const dealt = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a collision still leaves the picture of the board
  // the ids were read from.
  await captureStill(h, "dealt");

  const table = everyCard(dealt);
  assertGreaterThan(
    table.length,
    0,
    "the cards on the table after deal() — an empty board would say nothing " +
      "about the ids handed out on one",
  );

  const ids = table.map((c) => c.id);
  const distinct = new Set(ids).size;
  assertEqual(
    distinct,
    ids.length,
    `the DISTINCT ids among the ${ids.length} cards a deal put on the table — ` +
      `an id is distinct among the entities live at any moment ` +
      `(specs/instrumentation.md, Identity)`,
  );
});
