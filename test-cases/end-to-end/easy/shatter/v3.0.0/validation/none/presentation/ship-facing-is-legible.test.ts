// presentation/ship-facing-is-legible — the drawn ship says which way it is pointing.
//
// THE RULE. `specs/overview.md`: the ship "reads apart from the field behind it and
// from every other body, and its facing is legible at a glance."
// `specs/ship.md` draws it as "a triangle pointing along its current facing, roughly
// `34` long from nose to tail and `26` wide at the tail". A ship whose drawing is the
// same in every direction is a ship the player cannot aim, since the facing is the
// only thing the thrust and the gun are given (`specs/ship.md`, `specs/weapons.md`).
//
// WHAT IS READ, AND WHY IT IS A CHANGE. No triangle is demanded of the canvas here,
// no dimension and no shape: `specs/overview.md` closes with the palette, the type
// and every other aspect of the look being the build's, and a build drawing a dart,
// a wedge or a hull with a marker at its nose is legible. What every legible facing
// has in common is that the drawing MOVES when the facing does. So the same disc
// about the ship's own centre is read twice — once with the ship facing one way and
// once with it facing the other way about — and what is asserted is that the samples
// changed between the two frames.
//
// A HALF TURN, because it is the pair a legible drawing must differ across: a hull
// that reads the same nose-on and tail-on is one a player cannot fly. `30` and `210`
// degrees rather than `0` and `180`, so a build that swapped a sine for a cosine
// cannot pass on a facing where the two agree.
//
// NOTHING BUT THE HULL IS IN THE DISC BETWEEN THE TWO READINGS. The pose is
// `ship-is-drawn-and-distinct`'s: an emptied, gated field with the ship at
// `SHIP_SPOT`, `376` from the star's centre, so nothing of the star reaches the disc,
// and no grace is running — `startPlaying` leaves the ship with none — and no thrust
// is held, so no flame is drawn. The ship is at rest and the well does not pull it
// (`specs/gravity.md`), so between the two frames the only thing that moved is the
// facing.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { DEG } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { changedSamples, DISC_SAMPLES, readDisc } from "./ink";
import { SHIP_SPOT } from "./scene";

/** The two facings the hull is read at, a half turn apart. See the header. */
const FACINGS_DEG = [30, 210] as const;

/**
 * How far from the centre a reading looks, in logical units.
 *
 * `specs/ship.md` makes the hull roughly `34` long from nose to tail, so a hull
 * centred anywhere sensible on that length lies inside `30` of the centre either
 * way. Wide enough to hold the whole ship, tight enough that nothing else on a field
 * posed like this can enter it.
 */
const SEARCH_R = 30;

/**
 * How far a sample's colour must move to count as changed, of the 441 a colour
 * distance can span.
 *
 * The figure `armor/damaged-look` reads its own redraw at, and for the same reason:
 * well above what a build's anti-aliasing does to a stationary edge, and far below
 * the contrast between a hull and the field it is drawn on.
 */
const SAMPLE_DELTA = 16;

/**
 * How many of the {@link DISC_SAMPLES} readings must have moved.
 *
 * A fortieth of the disc. A hull `34` long and `26` across covers about a sixth of
 * a disc of `SEARCH_R`, and turning it about redraws most of what it covers, so a
 * conformant drawing moves several times this many samples even when it is stroked
 * as a bare outline. A body drawn the same in every direction — a disc, a ring, a
 * square — moves none of them, which is the failure this item exists to name.
 */
const MIN_CHANGED = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws the ship differently at two facings a half turn apart", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);

  await harness.debug.setShipAngle(FACINGS_DEG[0] * DEG);
  await harness.advance(1);
  const one = await readDisc(harness, SHIP_SPOT, SEARCH_R);

  await harness.debug.setShipAngle(FACINGS_DEG[1] * DEG);
  await harness.advance(1);
  const other = await readDisc(harness, SHIP_SPOT, SEARCH_R);
  await captureStill(harness, "facings");

  assertGreaterThan(
    changedSamples(one, other, SAMPLE_DELTA),
    MIN_CHANGED,
    `of ${DISC_SAMPLES} samples inside ${SEARCH_R} of the ship's centre, how many the build redrew between facing ${FACINGS_DEG[0]} degrees and facing ${FACINGS_DEG[1]} (specs/overview.md)`,
  );
});
