// instrumentation/ship-collision-gate — with `setShipCollision(false)` a rock
// advanced onto the ship costs nothing; with it on, the same scenario costs a
// life.
//
// THE RULE. `specs/instrumentation.md`, The ship: "`setShipCollision(enabled)`
// Gates the ship's lethal contact test, which is whether a rock, the saucer, or
// a saucer bullet reaching it destroys it and costs a life, and nothing else.
// Off, the ship still flies, still turns, still fires, still slides along the
// star's core, and no contact costs anything." What a contact costs when the
// gate is on is `specs/collision.md` ("The ship and a rock — The ship is
// destroyed and a life is lost") and `specs/progression.md` ("Losing a ship
// costs one life").
//
// THE CONTACT IS REAL, AND THAT IS THE HARD PART. A gate check that never
// actually brought the two bodies together passes on any build at all, so the
// rock is advanced onto the ship by the game's own motion and the leg waits for
// the tick on which the shortest wrapped separation between the two centres is
// at most the sum of their radii — which is `specs/collision.md`'s own
// definition of touching. That reading is the precondition of both legs.
//
// THE ROCK COMES FROM BELOW. The ship stands at the safe point `(640, 560)`,
// below the star, so a rock rising toward it is being pulled the way it is
// already going (`specs/gravity.md`) and the well cannot stall the approach.
// A Small is used because it is the one size whose destruction leaves no
// fragments (`specs/rocks.md`) — nothing else appears on the field either way.
//
// THE GRACE IS CLEAR. `startPlaying` leaves `invuln` at `0`, so lethal contact
// is live and the gate is the only thing between the rock and the life
// (`specs/progression.md`: inside the grace the lethal pairs cost nothing).

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SHIP_R,
  START_LIVES,
} from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** Where the rock starts, directly below the ship, and how fast it rises. */
const ROCK_START = { x: SAFE_X, y: SAFE_Y + 80 };
const ROCK_VY = -240;

/** The separation at which the two are touching (`specs/collision.md`). */
const CONTACT_RANGE = SHIP_R + ROCK_RADIUS.small;

/** How long the approach is given, in seconds of game time. */
const APPROACH_SECONDS = 0.6;

/** How long the aftermath is read over, in seconds of game time. */
const SETTLE_SECONDS = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** How far the rock's centre is from the ship's, by the shortest wrapped path. */
function separation(snapshot: ShatterSnapshot, id: number): number {
  const rock = snapshot.rocks.find((entry) => entry.id === id);
  if (rock === undefined) return Infinity;
  return wrappedDistance(rock, snapshot.ship);
}

/** Pose the scenario and advance until the rock is touching the ship. */
async function bringTheRockOn(collision: boolean): Promise<void> {
  startPlaying(h);
  h.debug.setShipCollision(collision);
  h.debug.setLives(START_LIVES);

  const id = poseRock(h, "small", ROCK_START.x, ROCK_START.y, 0, ROCK_VY);
  requireRock(h.snapshot(), id, "the posed Small");

  const touched = await h.until((s) => separation(s, id) <= CONTACT_RANGE, {
    maxFrames: ticksFor(APPROACH_SECONDS),
  });
  assertEqual(
    touched.hit,
    true,
    "the posed rock reaches the ship: the two centres come within the sum " +
      "of their radii (specs/collision.md)",
  );
  assertLessThanOrEqual(
    separation(touched.snapshot, id),
    CONTACT_RANGE,
    "the separation at the tick the approach ended on",
  );
}

it("off, a rock advanced onto the ship costs no life and the game plays on", async () => {
  await bringTheRockOn(false);

  // The rock sitting over the ship with every life intact.
  captureStill(h, "overlap");

  // And the tick that contact fell on has been resolved either way.
  await h.advance(ticksFor(SETTLE_SECONDS));

  const after = h.snapshot();
  assertEqual(
    after.lives,
    START_LIVES,
    "with the contact gate off, a rock reaching the ship costs no life",
  );
  assertEqual(after.screen, "playing", "and the game is still being played");
  assertEqual(
    after.ship.collision,
    false,
    "the gate is still off after the contact",
  );
});

it("on, the same scenario costs a life", async () => {
  await bringTheRockOn(true);
  await h.advance(ticksFor(SETTLE_SECONDS));

  assertEqual(
    h.snapshot().lives,
    START_LIVES - 1,
    "with the contact gate on, the same rock reaching the ship costs a life",
  );
});
