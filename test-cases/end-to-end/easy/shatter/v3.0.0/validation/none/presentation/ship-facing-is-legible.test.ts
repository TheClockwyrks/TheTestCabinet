// presentation/ship-facing-is-legible — the drawn ship says which way it is pointing.
//
// THE RULE. `specs/overview.md`: the ship "reads apart from the field behind it and
// from every other body, and its facing is legible at a glance."
// `specs/ship.md` draws it as "a triangle pointing along its current facing, roughly
// `34` long from nose to tail and `26` wide at the tail". A ship whose drawing is the
// same in every direction is a ship the player cannot aim, since the facing is the
// only thing the thrust and the gun are given (`specs/ship.md`, `specs/weapons.md`).
//
// WHAT IS ASSERTED, AND WHY IT IS ASYMMETRY RATHER THAN A SHAPE. No triangle is
// demanded of the canvas here, and no dimension: `specs/overview.md` closes with the
// palette, the type and every other aspect of the look being the build's, and a
// build drawing a dart, a wedge or a hull with a marker at its nose is legible.
// What every legible facing has in common is that the drawing is NOT the same
// forward as back, so what is read is exactly that.
//
// TWO MEASURES, AND THE LARGER OF THEM DECIDES. Either one alone has a shape that
// defeats it, and they do not share it:
//
//   - REACH, along the facing axis: how far the farthest drawn point ahead of the
//     centre is, against the farthest behind. A triangle whose BOUNDING BOX is
//     centred on the entity's position reaches equally far each way, and reads zero
//     on this.
//   - AREA, over the disc about the centre: how many samples ahead of the centre are
//     drawn, against how many behind. A triangle whose centre is placed at the point
//     that halves its area reads zero on THAT one — and reaches half as far again
//     forward as back, so reach carries it.
//
// A body drawn the same in every direction — a disc, a ring, a square — reads zero on
// both, which is the failure this item exists to name.
//
// WHY FOUR FACINGS, AND WHY THESE FOUR. `30`, `120`, `210` and `300` degrees: one to
// a quadrant, none on an axis, none an odd multiple of `45`. A build that draws its
// hull along a fixed axis and never turns it reads as symmetric at some facings and
// not others; requiring all four is what stops one lucky facing carrying the item,
// and placing them off the axes and off the diagonals is what stops a build that
// swapped a sine for a cosine from passing on the facings where the two agree.
//
// THE POSE is `ship-is-drawn-and-distinct`'s: an emptied, gated field with the ship
// at `SHIP_SPOT`, `376` from the star's centre, so nothing of the star reaches the
// disc being read, and nothing but the hull is in it — no grace, since
// `startPlaying` leaves the ship with none, and no flame, since no thrust is held.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { DEG } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleField,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import { unitAt, wrap } from "../geometry";
import { discPoints, readPoints } from "./ink";
import { SHIP_SPOT } from "./scene";

/** The four facings the hull is read at, in degrees. See the header. */
const FACINGS_DEG = [30, 120, 210, 300] as const;

/**
 * How far from the centre a reading looks, in logical units.
 *
 * `specs/ship.md` makes the hull roughly `34` long from nose to tail, so a hull
 * centred anywhere sensible on that length lies inside `30` of the centre either
 * way. Wide enough to hold the whole ship, tight enough that nothing else on a field
 * posed like this can enter it.
 */
const SEARCH_R = 30;

/** How far apart two samples along the facing axis are, in logical units. */
const AXIS_STEP = 0.5;

/** How far a sample must be from the field to be the ship's, of 441. */
const APART = 60;

/**
 * How lopsided the drawing must be, as a fraction of its whole extent or its whole
 * area.
 *
 * The tightest a conformant triangle gets: one drawn about its own centroid reaches
 * two thirds of its length forward and one third back, and puts a little over five
 * ninths of its area behind the centre — an asymmetry of `0.33` on reach and `0.12`
 * on area, so the larger of the two never falls under `0.33` for a triangle at all.
 * Fifteen hundredths is under half of that, which leaves room for a hull with a
 * flared tail or a blunted nose, and is far above the zero a body drawn the same in
 * every direction reads.
 */
const MIN_ASYMMETRY = 0.15;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Whether a reading is the ship rather than the field behind it. */
function drawn(sample: Rgb, field: Rgb): boolean {
  return colorDistance(sample, field) > APART;
}

/** How far the farthest drawn point along `sign * facing` is from the centre. */
async function reach(
  h: Harness,
  facing: number,
  sign: number,
  field: Rgb,
): Promise<number> {
  const along = unitAt(facing);
  const steps: number[] = [];
  for (let at = AXIS_STEP; at <= SEARCH_R; at += AXIS_STEP) steps.push(at);
  const look = await readPoints(
    h,
    steps.map((at) =>
      wrap({
        x: SHIP_SPOT.x + sign * along.x * at,
        y: SHIP_SPOT.y + sign * along.y * at,
      }),
    ),
  );
  let farthest = 0;
  look.forEach((sample, index) => {
    if (drawn(sample, field)) farthest = steps[index];
  });
  return farthest;
}

/** How many drawn samples of the disc lie ahead of, and behind, the centre. */
async function halves(
  h: Harness,
  facing: number,
  field: Rgb,
): Promise<{ ahead: number; behind: number }> {
  const along = unitAt(facing);
  const points = discPoints(SHIP_SPOT, SEARCH_R);
  const look = await readPoints(h, points);
  let ahead = 0;
  let behind = 0;
  points.forEach((point, index) => {
    if (!drawn(look[index], field)) return;
    const forward =
      (point.x - SHIP_SPOT.x) * along.x + (point.y - SHIP_SPOT.y) * along.y;
    if (forward > 0) ahead += 1;
    else if (forward < 0) behind += 1;
  });
  return { ahead, behind };
}

/** How lopsided two readings are, as a fraction of their total; `0` when both are `0`. */
function lopsided(ahead: number, behind: number): number {
  const total = ahead + behind;
  return total === 0 ? 0 : Math.abs(ahead - behind) / total;
}

it("draws the ship lopsided about its centre along its facing, at four facings", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);

  for (const degrees of FACINGS_DEG) {
    const facing = degrees * DEG;
    const at = `facing ${degrees} degrees`;

    await harness.debug.setShipAngle(facing);
    await harness.advance(1);

    const field = await sampleField(harness);
    const forward = await reach(harness, facing, 1, field);
    const backward = await reach(harness, facing, -1, field);
    const area = await halves(harness, facing, field);
    // Overwritten each time round, so what is kept is the last facing that RAN,
    // including the one an assertion below is about to fail on.
    await captureStill(harness, "facings");

    if (forward === 0 && backward === 0 && area.ahead + area.behind === 0) {
      fail(
        `${at}: a ship drawn somewhere inside ${SEARCH_R} of its centre, so its facing can be read (specs/overview.md)`,
        "nothing within that disc was drawn apart from the field",
      );
    }

    assertGreaterThan(
      Math.max(lopsided(forward, backward), lopsided(area.ahead, area.behind)),
      MIN_ASYMMETRY,
      `${at}: how lopsided the drawn ship is about its centre along its facing — the larger of its reach (${forward.toFixed(1)} ahead against ${backward.toFixed(1)} behind) and its area (${area.ahead} samples ahead against ${area.behind} behind) — as a fraction of the whole (specs/overview.md)`,
    );
  }
});
