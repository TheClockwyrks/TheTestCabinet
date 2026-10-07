// saucer/bullet-carries-the-saucers-velocity — a round leaves a moving saucer
// carrying the saucer's own motion.
//
// THE RULE. `specs/saucer.md`: "The bullet leaves at `SAUCER_BULLET_SPEED`
// (`300`) along that bearing, PLUS THE SAUCER'S OWN VELOCITY." So the reading is
// the round's velocity with the saucer's taken out of it: whatever the aim came
// out as, what is left has to be `300` units per second.
//
// THE POSE IS BUILT SO EVERY WRONG MODEL READS A DIFFERENT NUMBER. The saucer is
// given `150` units per second ALONG the bearing to the ship, and the reading is
// the length of `roundVelocity - saucerVelocity`:
//
//   * carrying the motion, as the specification says — `300`.
//   * ignoring it, firing at `300` along the aim alone — about `154`.
//   * adding it twice — about `446`.
//   * carrying it but firing at some other muzzle speed — that speed.
//
// Every one of them is outside a three percent band on `300`, and the alignment
// is what buys that: a saucer velocity across the aim rather than along it would
// leave the second model reading close to `335`, and one at about seventy-seven
// degrees to the aim would leave it reading `300` exactly, which is the confound
// this placement exists to rule out.
//
// THE VELOCITY IS POSED, NOT FLOWN, and its `travel` is off:
// `specs/instrumentation.md` gives `setSaucerVelocity` and `setSaucerTravel`
// separately for exactly this, and what the specification names is the saucer's
// VELOCITY rather than its displacement, so a saucer standing at a velocity is
// the honest reading and it keeps the geometry — which the whole discrimination
// above rests on — fixed through the shot. Its mind is off too, so nothing
// rerolls the velocity this check posed.
//
// WHERE IT STANDS. `(180, 660)`, `549` units from the star, with the ship posed
// on the `-45`-degree bearing from it. The well cannot turn a round by more than
// a fiftieth of a degree in the tick it is read, and the ship is at rest with its
// contact test off.
//
// WHY THREE PERCENT. `9` units per second on a reading of `300`, and the item's
// own figure. Nothing conformant needs it — the muzzle speed is a constant added
// to a constant — and the nearest wrong model is `146` units per second away.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SAUCER_BULLET_SPEED, SAUCER_FIRE_INTERVAL } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { nextVolley } from "./cadence";
import { poseVisit } from "./visit";

/** Where the saucer stands: quiet ground, far from the star. */
const STAND = { x: 180, y: 660 };

/** The bearing the ship is posed along, and the saucer's velocity with it. */
const BEARING = -45 * DEG;

/** How far along that bearing the ship stands. */
const RANGE = 400;

/** Where the ship stands, which is what the gun aims at. */
const SHIP = {
  x: STAND.x + Math.cos(BEARING) * RANGE,
  y: STAND.y + Math.sin(BEARING) * RANGE,
};

/**
 * The velocity the saucer is posed at: `150` units per second along the bearing.
 *
 * Half the muzzle speed, which is what makes each wrong model above read a number
 * of its own, and along the aim rather than across it for the reason the header
 * gives. Any velocity is legal for `setSaucerVelocity`; this one is chosen for
 * what it separates.
 */
const CARRIED = {
  vx: Math.cos(BEARING) * (SAUCER_BULLET_SPEED / 2),
  vy: Math.sin(BEARING) * (SAUCER_BULLET_SPEED / 2),
};

/** Three percent of `SAUCER_BULLET_SPEED`: `9` units per second. See the header. */
const SPEED_TOLERANCE = SAUCER_BULLET_SPEED * 0.03;

/** How long the shot is waited for before a silent gun is called on it. */
const SHOT_CEILING = ticksFor(4 * SAUCER_FIRE_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves at SAUCER_BULLET_SPEED once the saucer's own velocity is taken out", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP.x, SHIP.y);
  poseVisit(h, STAND.x, STAND.y, {
    vx: CARRIED.vx,
    vy: CARRIED.vy,
    mind: false,
    travel: false,
  });

  const volley = await nextVolley(h, { maxTicks: SHOT_CEILING });
  captureStill(h, "shot");

  const carried = volley.saucer ?? { vx: 0, vy: 0 };
  const round = volley.fired[0];
  const muzzle = speedOf({
    vx: round.vx - carried.vx,
    vy: round.vy - carried.vy,
  });

  assertLessThanOrEqual(
    Math.abs(muzzle - SAUCER_BULLET_SPEED),
    SPEED_TOLERANCE,
    "the speed a round left at once the saucer's own velocity was taken out " +
      "(specs/saucer.md)",
  );
});
