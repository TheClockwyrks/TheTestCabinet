// instrumentation/flyer-ids-distinct — every card in flight carries an id of its
// own.
//
// specs/instrumentation.md "Identity": every flyer carries an `id`, "a number,
// distinct among the entities live at any moment, reported by `snapshot` and taken
// by every per-entity operation". `setFlyerPosition`, `setFlyerVelocity` and
// `removeFlyer` all name a flyer by that number, and the whole `cascade` group
// follows one parabola by it, so two flyers sharing a number makes every one of
// those readings ambiguous.
//
// SIX AT ONCE, because one flyer's id says nothing: the failure this rule exists to
// prevent is a build that hands out a number derived from something several cards
// can share, or that addresses a flyer by its position in the flight. So six are
// added, each a different card, and each is added on top of the ones before it.
//
// EACH ONE IS ALSO READ BACK OFF THE END OF THE FLIGHT, which is the first of
// specs/instrumentation.md's two identity rules: "An entity added through this
// surface is appended to its pile or to the flyer list, so it is the last entry and
// its id is read from there." Without that, an id cannot be found at all.
//
// THE WORLD IS POSED STILL. The table is empty, launching is gated off so no card
// leaves a foundation to join the flight, and every posed flyer is given no
// velocity, so the six read at the end are the six that were added and none of them
// has drifted off an edge and retired (specs/victory.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  lastFlyer,
  openTable,
  parseCard,
  type Harness,
} from "../harness";

/**
 * The six cards posed in flight, and the top-left each is posed at.
 *
 * Spread across the stage, well inside both side edges, so no card is at risk of
 * retiring and a reviewer can tell the six apart in the still.
 */
const FLYERS = [
  { card: "AS", x: 60, y: 120 },
  { card: "2H", x: 260, y: 200 },
  { card: "3D", x: 460, y: 280 },
  { card: "4C", x: 660, y: 200 },
  { card: "5S", x: 860, y: 120 },
  { card: "6H", x: 1060, y: 280 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each of six cards in flight a distinct id, appending each", async () => {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(false);
  h.debug.clearFlyers();

  const ids = FLYERS.map((pose, index) => {
    const card = parseCard(pose.card);
    h.debug.addFlyer(card.suit, card.rank, pose.x, pose.y, 0, 0);

    // Each flyer added is the LAST entry of the flight it was appended to.
    const flight = h.snapshot().flyers;
    assertLength(flight, index + 1, "the flight after the add");
    return lastFlyer(h.snapshot()).id;
  });

  const flight = h.snapshot().flyers;

  // The six cards in flight the ids were read from.
  await h.advance(1);
  captureStill(h, "flyers");

  assertLength(flight, FLYERS.length, "the six cards posed in flight");
  assertLength(
    [...new Set(ids)],
    ids.length,
    "the distinct ids among the six cards in flight: every flyer's id is " +
      "distinct from every other's (specs/instrumentation.md)",
  );
  assertEqual(
    flight.map((flyer) => flyer.id).join(","),
    ids.join(","),
    "the flight, in the order the six were appended to it " +
      "(specs/instrumentation.md)",
  );
});
