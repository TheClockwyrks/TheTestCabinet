// instrumentation/flyer-ids-distinct — every card in flight carries an id of
// its own.
//
// THE RULE. specs/instrumentation.md, under Identity, gives a flyer the same
// id rule a card has: "a number, distinct among the entities live at any
// moment". Every per-flyer operation the surface carries —
// `setFlyerPosition`, `setFlyerVelocity`, `removeFlyer` — takes one, so two
// flyers sharing a number leaves each of those three operations ambiguous, and
// a build that answered such a call by moving the wrong card would be
// unanswerable rather than wrong.
//
// SIX AT ONCE, BECAUSE THE COLLISION IS IN THE NUMBERING. A build that hands
// out one number per flight, or restarts its numbering when the list is
// rebuilt, reads the same id twice as soon as more than one card is up. Six is
// past any small fixed pool a build might have written and is what the item
// names.
//
// THE FLYERS ARE POSED, NOT LAUNCHED. `addFlyer` appends a card to the flight
// and it takes a fresh id (specs/instrumentation.md), which is exactly the
// numbering under test; reaching six in flight through a real cascade would
// charge a broken launch cadence to this point instead.
//
// THE SIX CARDS ARE ALL DIFFERENT so a failure can say which two collided, and
// they are posed clear of both side edges so none retires before the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  EIGHT,
  FIVE,
  JACK,
  NINE,
  QUEEN,
  THREE,
  captureStill,
  card,
  createHarness,
  openTable,
  poseFlyer,
  type Harness,
} from "../harness";

/**
 * The six cards in flight, spread across the table and clear of both side
 * edges, so every one of them is still in the flight when the ids are read.
 */
const FLYERS = [
  { spec: card("spades", THREE), x: 200, y: 200 },
  { spec: card("hearts", FIVE), x: 380, y: 260 },
  { spec: card("clubs", EIGHT), x: 560, y: 320 },
  { spec: card("diamonds", NINE), x: 740, y: 380 },
  { spec: card("spades", JACK), x: 900, y: 440 },
  { spec: card("hearts", QUEEN), x: 1060, y: 260 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each of six cards in flight an id no other flyer carries", async () => {
  openTable(h);
  h.debug.setScreen("won");
  for (const flyer of FLYERS) {
    poseFlyer(h, flyer.spec, flyer.x, flyer.y, 0, 0);
  }

  const posed = h.snapshot();
  const ids = posed.flyers.map((flyer) => flyer.id);

  await h.advance(1);
  captureStill(h, "flyers");

  assertLength(
    posed.flyers,
    FLYERS.length,
    "cards in flight after six addFlyer calls, each appending one " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    new Set(ids).size,
    ids.length,
    `distinct ids across the ${ids.length} cards in flight: an id is ` +
      "distinct among the entities live at any moment " +
      "(specs/instrumentation.md)",
  );
});
