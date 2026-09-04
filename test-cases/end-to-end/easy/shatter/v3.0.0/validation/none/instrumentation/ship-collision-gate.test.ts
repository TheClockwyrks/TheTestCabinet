// instrumentation/ship-collision-gate — `setShipCollision(false)` really does shut
// the ship's lethal contact test: a rock brought onto the ship costs nothing and
// the run carries on. With the gate open, the same contact costs a life.
//
// WHAT THE GATE GATES, EXACTLY. `specs/instrumentation.md` scopes it narrowly —
// "the ship's lethal contact test, which is whether a rock, the saucer, or a saucer
// bullet reaching it destroys it and costs a life, and nothing else. Off, the ship
// still flies, still turns, still fires, still slides along the star's core, and no
// contact costs anything." So the reading is `lives` and the screen, and nothing
// else about the ship is touched.
//
// WHY THE GATE MATTERS TO EVERYTHING ELSE. The ship is the one entity no scenario
// can remove from the field, so `startPlaying` shuts this gate for every scenario in
// the project: without it, a rock posed anywhere near the safe point costs a life
// and empties the field mid-scenario. A build whose gate does nothing does not
// merely fail this item — it breaks scenarios all over the case.
//
// THE CONTACT IS POSED, NOT FLOWN. A rock sent in from a distance would be bent by
// the well on the way and could pass by; a rock placed on the ship's own centre is
// inside `SHIP_R + ROCK_RADIUS.small` (`28`, `specs/collision.md`) with nothing left
// to arrange, so the only question either leg asks is what the build does about a
// contact it certainly has. The overlap is read back off the snapshot before either
// verdict, so a leg that passed because the two never touched cannot.
//
// AND THE ROCK IS A SMALL. The lethal pair is the same for any size
// (`specs/collision.md`), and the smallest rock keeps the posed overlap tightest
// around the ship's own circle.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ROCK_RADIUS, SAFE_X, SAFE_Y, SHIP_R, START_LIVES } from "../constants";
import { wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The ticks the posed contact is left to resolve in. */
const CONTACT_TICKS = 4;

/** The separation at which a Small and the ship touch (`specs/collision.md`). */
const TOUCHING = SHIP_R + ROCK_RADIUS.small;

let h: Harness;

/** Fail unless the rock really is inside the ship's circle at the reading. */
function assertOverlapping(
  snapshot: ShatterSnapshot,
  rockId: number,
  what: string,
): void {
  const rock = requireRock(snapshot, rockId, what);
  assertLessThanOrEqual(
    wrappedDistance(rock, snapshot.ship),
    TOUCHING,
    `${what}: the rock is touching the ship`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("costs no life while the contact gate is shut", async () => {
  // `startPlaying` opens with the contact gate shut and no respawn grace running,
  // which is the state under test.
  await startPlaying(h);
  const id = await poseRock(h, "small", SAFE_X, SAFE_Y);
  await h.advance(CONTACT_TICKS);
  await captureStill(h, "overlap");

  const s = await h.snapshot();
  assertOverlapping(s, id, "with the gate shut");
  assertEqual(s.lives, START_LIVES, "the ships left after the contact");
  assertEqual(s.screen, "playing", "the screen after the contact");
});

it("costs a life once the contact gate is open", async () => {
  await startPlaying(h);
  await h.debug.setShipCollision(true);
  const id = await poseRock(h, "small", SAFE_X, SAFE_Y);
  const posed = await h.snapshot();
  assertOverlapping(posed, id, "with the gate open");

  await h.advance(CONTACT_TICKS);
  assertEqual(
    (await h.snapshot()).lives,
    START_LIVES - 1,
    "the ships left after the same contact with setShipCollision(true)",
  );
});
