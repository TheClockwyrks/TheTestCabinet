// presentation/thrust-flame-while-thrusting — a flame shows while thrust is applied,
// and only while it is.
//
// THE RULE. `specs/ship.md`: "While thrust is being applied, a flame is drawn
// trailing from the ship's tail. It is absent whenever thrust is not being applied."
// `specs/overview.md` says the same from the player's side. It is the only feedback
// the ship gives that the key is doing anything: the acceleration is `480` units per
// second squared and the drag bleeds it back off, so a player with no flame cannot
// tell a held key from a missed one.
//
// WHERE THE READING IS TAKEN. A band behind the ship, along its facing: from `16` to
// `44` units behind the centre and `14` either side of the axis. `specs/ship.md`
// makes the hull roughly `34` long from nose to tail, so a hull centred anywhere
// sensible on that length ends by about `17` behind the centre and the band begins
// just inside that and runs well past it. The ship is posed pointing along `+x` and
// the band is laid on its ACTUAL position each time it is read, so the two ticks of
// thrust that move it cannot slide the reading off it.
//
// THREE READINGS, AND WHY THE QUIET ONE IS THE BASELINE. A build is free to draw a
// hull longer than the specification's rough figure, and any part of it that reaches
// into the band would be counted as a flame by a reading taken against the field
// alone. So the band is read three times — before any thrust, while it is held, and a
// tick after it is released — and what is asserted is the CHANGE from the quiet
// reading. Whatever a build draws there permanently sits in all three and decides
// nothing.
//
//   - THE FLAME APPEARS: the band gains at least `MIN_FLAME` drawn samples while
//     thrust is held.
//   - AND IT GOES: a tick after the key is released, the band is back within
//     `MAX_RESIDUE` samples of where it was before any thrust.
//
// Two assertions, but one requirement in one direction each way round: a build with
// no flame fails the first, and a build whose flame never goes out fails the second,
// and they grade differently.
//
// THE POSE is `ship-is-drawn-and-distinct`'s emptied, gated field with the ship at
// `SHIP_SPOT`, `376` from the star's centre. A few ticks of thrust move it a
// fraction of a unit, so nothing of the star and no seam comes near the band.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { KEYS_THRUST } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleField,
  shipVelocity,
  startPlaying,
  type Harness,
  type Rgb,
  type ShipView,
} from "../harness";
import { unitAt, wrap } from "../geometry";
import { readPoints } from "./ink";
import { SHIP_SPOT } from "./scene";

/** The facing the ship is posed at: along `+x`, so the band runs along `-x`. */
const FACING = 0;

/** How far behind the centre the band begins, in logical units. See the header. */
const BAND_FROM = 16;

/** How far behind the centre it ends. */
const BAND_TO = 44;

/** How far either side of the facing axis it reaches. */
const BAND_HALF_WIDTH = 14;

/** How far apart two samples of the band are, in logical units. */
const BAND_STEP = 1;

/** How far a sample must be from the field to be drawn, of 441. */
const APART = 60;

/** Ticks the key is held before the band is read: enough for the build to see it. */
const HOLD_TICKS = 4;

/**
 * How many samples the band must GAIN while thrust is held.
 *
 * The band holds about `840` samples at one per square unit. A flame reaching only
 * five units past a hull's tail and a couple of units across still paints twenty of
 * them, which is where the bar sits — low enough for the smallest flame a player
 * could see, and far above the handful a sub-pixel shift of the hull's own edge can
 * move as the ship gets under way.
 */
const MIN_FLAME = 20;

/**
 * How many samples the band may still hold a tick after the key is released.
 *
 * Not zero: the ship carries the velocity the burn built (`specs/ship.md` gives it
 * no brake), so the hull sits a fraction of a unit further on than it did at the
 * quiet reading and its own anti-aliased edge moves a few samples with it. Ten is
 * that and nothing more; a flame still burning is tens.
 */
const MAX_RESIDUE = 10;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** The points of the band behind `ship`, along its facing. */
function bandPoints(ship: ShipView): { x: number; y: number }[] {
  const along = unitAt(ship.angle);
  const across = { x: -along.y, y: along.x };
  const points: { x: number; y: number }[] = [];
  for (let back = BAND_FROM; back <= BAND_TO; back += BAND_STEP) {
    for (
      let side = -BAND_HALF_WIDTH;
      side <= BAND_HALF_WIDTH;
      side += BAND_STEP
    ) {
      points.push(
        wrap({
          x: ship.x - along.x * back + across.x * side,
          y: ship.y - along.y * back + across.y * side,
        }),
      );
    }
  }
  return points;
}

/** How many samples of the band behind the ship are drawn apart from the field. */
async function bandInk(h: Harness, field: Rgb): Promise<number> {
  const ship = (await h.snapshot()).ship;
  const look = await readPoints(h, bandPoints(ship));
  let marked = 0;
  for (const sample of look) {
    if (colorDistance(sample, field) > APART) marked += 1;
  }
  return marked;
}

it("draws behind the tail while thrust is held and stops a tick after it is released", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  await harness.debug.setShipAngle(FACING);
  await harness.advance(1);

  const field = await sampleField(harness);
  const quiet = await bandInk(harness, field);

  let burning = quiet;
  await harness.hold(KEYS_THRUST[0]);
  try {
    await harness.advance(HOLD_TICKS);
    burning = await bandInk(harness, field);
    // Kept while the key is still down, so the picture shows the flame the reading
    // was taken from rather than the field a tick after it went out.
    await captureStill(harness, "flame");
  } finally {
    await harness.release(KEYS_THRUST[0]);
  }

  await harness.advance(1);
  const released = await bandInk(harness, field);
  const moving = shipVelocity(await harness.snapshot());

  assertGreaterThanOrEqual(
    burning - quiet,
    MIN_FLAME,
    `how many samples of the band behind the tail the build painted while thrust was held that it had not painted before, of about 840 (specs/ship.md; the burn built a velocity of ${Math.hypot(moving.x, moving.y).toFixed(1)})`,
  );

  assertLessThanOrEqual(
    released - quiet,
    MAX_RESIDUE,
    "how many samples of that band the build was still painting a tick after the thrust key was released, above what it painted before any thrust (specs/ship.md)",
  );
});
