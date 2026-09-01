// Spectra — bursts/spawns-on-kill: a pop plays the burst.
//
// `specs/assets.md`, the drone-burst's two opening rules: "One burst starts in
// the moment a drone is destroyed, by a bullet or by a discharge wave alike",
// and "Centered on the destroyed drone's center." So the reading has three
// halves — that a matching shot leaves a burst at all, that it leaves exactly
// ONE, and that the one it leaves stands where the drone stood.
//
// THE SHOT IS THE PLAINEST POP THERE IS. A Shard, whose band is fixed for its
// life (`specs/drones.md`), held still with every faculty off, struck by one of
// the player's bullets carrying the Shard's own band. `specs/bands.md` makes
// that the destroying case, so nothing about the outcome is posed: the build's
// own contact and band rules are what destroy the drone, and the burst is what
// the build did about it. The discharge's half of the same rule is
// `bursts/discharge-pops`, and the Prism's is `bursts/prism-twice`.
//
// WHY THE FIELD IS POSED EMPTY AND WHY A BYSTANDER STANDS IN THE CORNER.
// `startPosed` leaves no drone, no bullet and no burst, so the roster this check
// counts starts at zero and the only thing that can put a burst on it is the
// kill. The bystander is what keeps the wave open once the target is destroyed
// (see `poseBystander`); it stands in the far corner with every faculty off, so
// it takes no part.
//
// WHAT THIS DOES NOT DECIDE. Whether the drone was destroyed at all is
// `bands/match-destroys`, and it is read here as the precondition of a pop. What
// the burst is SCALED to is `bursts/scaled-to-drone`, how long it plays is
// `bursts/one-shot-ends`, and whether it is painted is `bursts/drawn`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertLength,
  assertLessThanOrEqual,
  assertUndefined,
} from "../assert";
import { SHARD_SIZE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { droneOf } from "./reading";
import { poseBystander, shootAt } from "./scene";

/**
 * How far from the destroyed drone's centre the burst's own centre may stand, in
 * logical units.
 *
 * `specs/assets.md` says "Centered on the destroyed drone's center", and half a
 * `SHARD_SIZE` (`28`) footprint is the latitude a burst still reads as centred
 * on the drone from: a burst placed anywhere inside the square the drone was
 * drawn on covers the drone it is popping. A burst put at the ship, at the top
 * of the field, or at the origin is nowhere near it.
 */
const PLACED_MAX = SHARD_SIZE / 2;

/**
 * Where the drone is posed: a clear stretch of the play field, below the
 * formation grid's lowest row and its full sway, above the ship's lane, and well
 * clear of the corner the bystander holds.
 */
const POP_AT = { x: 1000, y: 460 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves exactly one burst, at the destroyed drone's centre", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "shard", POP_AT.x, POP_AT.y, { band: "cyan" });

  const before = h.snapshot();
  assertLength(before.bursts, 0, "precondition: no burst is playing yet");
  const drone = droneOf(before, target, "the drone the shot destroys");

  await shootAt(h, POP_AT.x, POP_AT.y, "cyan");

  // The burst the kill started, on the frame the shot resolved.
  captureStill(h, "burst");

  const after = h.snapshot();
  assertUndefined(
    droneById(after, target),
    "precondition: the Shard destroyed by one of the player's bullets " +
      "carrying its own band (specs/bands.md)",
  );
  assertLength(
    after.bursts,
    1,
    "the bursts playing after one drone was destroyed (specs/assets.md: one " +
      "burst starts in the moment a drone is destroyed)",
  );

  const burst = after.bursts[0];
  assertLessThanOrEqual(
    distanceBetween(burst, drone),
    PLACED_MAX,
    `the burst centred within ${PLACED_MAX} units of the destroyed drone's ` +
      `centre, (${drone.x.toFixed(1)}, ${drone.y.toFixed(1)}) ` +
      `(specs/assets.md: centered on the destroyed drone's center); it was ` +
      `reported at (${burst.x.toFixed(1)}, ${burst.y.toFixed(1)})`,
  );
});
