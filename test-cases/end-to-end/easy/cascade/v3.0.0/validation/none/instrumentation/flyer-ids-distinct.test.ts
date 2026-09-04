// instrumentation/flyer-ids-distinct — no two cards in flight carry the same id.
//
// THE RULE. `specs/instrumentation.md`, Identity: "Every card and every flyer
// carries an `id`: a number, distinct among the entities live at any moment,
// reported by `snapshot` and taken by every per-entity operation", and "An entity
// added through this surface is appended to its pile or to the flyer list, so it
// is the last entry and its id is read from there."
//
// WHY SIX. The three per-flyer operations — `setFlyerPosition`,
// `setFlyerVelocity` and `removeFlyer` — all name their card by id, and every
// check in the `cascade` group that steers one card while others fly rests on
// that id naming one card and no other. One flyer cannot collide with anything
// and two can collide only in one way; six is a flight big enough that a build
// numbering flyers by anything other than a fresh count — an index into the
// flight, a rank, a position hash — repeats itself here.
//
// EACH IS READ OFF THE END OF THE FLIGHT AS IT IS ADDED, because that is the only
// way a caller learns what it just created: `addFlyer` hands nothing back, and
// the append rule is what makes the last entry the new one. So the flight is
// required to have grown by exactly one at every add, and the id at its end is
// required to be one no earlier entry carried.
//
// THE SIX ARE POSED AT REST, CLEAR OF EVERY EDGE, and no game time is spent on
// them: the requirement is identity, so nothing here depends on where a card
// flies, and a flyer that retired off a side edge would take its id with it and
// turn this point into a reading about motion.
//
// WHAT THIS DOES NOT DECIDE. How ids are assigned, whether a flyer keeps its id
// across the flight, or whether a card that LAUNCHES keeps the id it carried on
// the table — `cascade/launch-keeps-id` decides the last of those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CARD_W, FLOOR_Y, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseFlyer,
  type Harness,
} from "../harness";

/**
 * Where the six are posed: a row across the middle of the stage, at rest.
 *
 * Every one of them sits inside `[0, STAGE_W - CARD_W]` horizontally and above
 * `FLOOR_Y` vertically, so none is against an edge the cascade retires a card
 * past (`specs/victory.md`), and none is given a velocity.
 */
const FLYERS = [
  { x: 60, y: 120 },
  { x: 260, y: 200 },
  { x: 460, y: 280 },
  { x: 660, y: 360 },
  { x: 860, y: 440 },
  { x: 1060, y: 200 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives each of six cards in flight an id no other flyer carries", async () => {
  await openTable(h);
  // The cascade runs on the `won` screen (`specs/victory.md`), which is where a
  // card in flight belongs; the table under it is empty, so nothing launches.
  await h.debug.setScreen("won");

  const ids: number[] = [];
  for (const spec of FLYERS) {
    // Every position is inside the stage and above the floor, so the check is
    // reading identity rather than a card that had already left.
    if (spec.x < 0 || spec.x > STAGE_W - CARD_W || spec.y > FLOOR_Y) {
      throw new RangeError(
        `cascade: a flyer posed at (${spec.x}, ${spec.y}) is not clear of the edges`,
      );
    }
    const before = (await h.snapshot()).flyers.map((f) => f.id);
    const id = await poseFlyer(h, spec);
    const after = (await h.snapshot()).flyers;

    assertLength(
      after,
      before.length + 1,
      `the cards in flight after one addFlyer, against the ${before.length} ` +
        `that were flying before it`,
    );
    assertEqual(
      before.includes(id),
      false,
      `whether the id at the END of the flight (${id}) was already carried by ` +
        `a card that was flying before the add — an added entity is APPENDED, ` +
        `so the last entry is the new one (specs/instrumentation.md, Identity)`,
    );
    ids.push(id);
  }

  await h.advance(1);
  // Before the assertions, so a collision still leaves the picture of the six
  // cards in flight.
  await captureStill(h, "flyers");

  assertEqual(
    new Set(ids).size,
    ids.length,
    `the DISTINCT ids among the ${ids.length} cards this scenario put in ` +
      `flight ([${ids.join(", ")}]) — an id is distinct among the entities ` +
      `live at any moment (specs/instrumentation.md, Identity)`,
  );
});
