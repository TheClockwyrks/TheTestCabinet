// lives/invuln-ignores-a-rock — a ship inside its grace is passed through.
//
// THE RULE. `specs/progression.md`: through the respawn grace "the ship is fully
// controllable and ignores the three lethal contacts", and `specs/collision.md`
// says the same from the other side — "the ship's destruction is subject to the
// respawn grace `specs/progression.md` states: inside that window the three lethal
// pairs above cost nothing and the ship passes through unharmed". This item reads
// one direction of that: inside the window, a rock costs NOTHING. `invuln-ends`
// reads the other.
//
// THE CONTACT TEST IS OPEN THROUGHOUT. `setShipCollision(true)` is what makes the
// reading mean anything: with the gate shut, no contact would cost a life whatever
// the grace was doing, and this item would pass on a build with no grace at all.
// The grace is what is being asked to suspend the contact, so the contact is armed.
//
// AND THE ROCK IS REQUIRED TO HAVE REACHED THE SHIP. The separation is tracked at
// every tick of the drive and the closest approach is asserted to have come inside
// the `28` at which the pair touches (`specs/collision.md`). Without that the item
// would pass on a build whose rock never moved, or whose `setRockVelocity` did
// nothing — a check reading "no life was lost" from a scenario in which nothing
// ever came near the ship. That is the failure mode this whole rework was about,
// and it is the reason the reading is a MINIMUM SEPARATION rather than a life
// count alone.
//
// TWO SECONDS OF GRACE, AND A SECOND OF WATCHING. `setShipInvuln(2.0)` poses a
// window wider than the drive, so the whole of what is read happens inside it and
// nothing here depends on where the window ends. The Small closes the `72` units
// past touching distance in a third of a second and is clear again by two thirds,
// so a whole second of watching covers the approach, the overlap and the departure
// — a build that resolves its contact on entry, on every overlapping tick, or on
// exit is caught by any of the three.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ROCK_RADIUS, SHIP_R } from "../constants";
import { wrappedDistance } from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
} from "./scene";

/**
 * The grace posed, in seconds.
 *
 * Wider than the whole drive below, so the contact this reads happens squarely
 * inside the window rather than near either of its ends.
 */
const GRACE = 2.0;

/**
 * The ticks the rock is watched over.
 *
 * The approach is `(APPROACH_GAP - 28) / ROCK_DRIFT`, a third of a second, and the
 * rock is clear of the ship again a third of a second after that, so a whole
 * second carries the entire crossing and leaves a third of a second of margin
 * inside `GRACE`.
 */
const WATCH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("costs no life when a rock crosses a ship inside its grace", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).lives;
  const rockId = await arrangeDoomedShip(h, { grace: GRACE });

  let closest = Number.POSITIVE_INFINITY;
  const watched = await h.until(
    (snapshot) => {
      const rock = rockById(snapshot, rockId);
      if (rock !== undefined) {
        closest = Math.min(
          closest,
          wrappedDistance(centreOf(snapshot.ship), centreOf(rock)),
        );
      }
      return snapshot.lives < before;
    },
    { maxTicks: WATCH_TICKS, poll: 1 },
  );
  await captureStill(h, "grace");

  assertLessThanOrEqual(
    closest,
    SHIP_TOUCHES_SMALL,
    `the closest the Small came to the ship's centre over the crossing, which ` +
      `has to reach the ${SHIP_R} + ${ROCK_RADIUS.small} at which the pair ` +
      `touches for this item to be reading a contact at all; it was posed ` +
      `${APPROACH_GAP} units out closing at ${ROCK_DRIFT} units per second ` +
      `(specs/collision.md)`,
  );
  assertEqual(
    watched.snapshot.lives,
    before,
    `the ships left after a rock crossed a ship carrying ${GRACE} s of respawn ` +
      `grace with its contact gate open — inside the grace the three lethal ` +
      `pairs cost nothing (specs/progression.md, specs/collision.md)`,
  );
});
