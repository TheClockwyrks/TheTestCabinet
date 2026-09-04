// Spectra — presentation/magenta-vs-field: a magenta drone stands out.
//
// `specs/overview.md`'s legibility table, the first row: a cyan thing and a
// magenta thing are told apart at a glance, "and each is told apart from the
// field behind it". A drone a player cannot see against the field is a drone that
// is not shot at, and `specs/field.md` puts a starfield behind that field, so the
// requirement is a real one rather than a formality: the build has to keep its
// drones above whatever it drew back there.
//
// THIS POINT IS THE MAGENTA HALF ALONE. `presentation/cyan-vs-field` is the
// cyan half, in its own file, so a build that lost one band against its field
// is named for the band it lost rather than for both.
//
// NO COLOUR IS ASSERTED. `specs/overview.md` fixes no palette, so what is graded
// is the DISTANCE between what the drone painted and what the same square of the
// same field carries with the drone gone — never a hex value, and never a fixed
// idea of what the field looks like, since `specs/field.md` leaves the starfield,
// the field's own colour and anything else a build lays there to the build.
//
// THE READING IS THE PIXELS, HELD PLACE FOR PLACE. The drone's `SHARD_SIZE`
// (`28`) square is read with the drone on it and again with the drone gone, and
// every place the drone painted is held against what that same place carries
// without it — see `presentation/reading`. So a build that drew a drone the
// colour of its own field fails here whatever colour that is, and a build whose
// starfield is bright cannot pass by having a star inside the square.
//
// THE DRONE IS A SHARD, `specs/drones.md`'s "bulk of every formation", posed as a
// prop with every faculty off so it holds its place and nothing it could do
// disturbs the frame that is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { apartFromField, droneOf, footprintOf, readRegion } from "./reading";

/**
 * How far the drone must read from the field behind it, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across, averaged over everything it
 * painted.
 *
 * The figure this item is written against: at least `40` of `441`, which is about
 * a tenth of the space and what this checklist calls the least a player reads at
 * a glance. The specification states the rule and leaves the palette to the
 * build, so this is the case's own figure for "told apart from the field behind
 * it".
 */
const DISTINCT_MIN = 40;

/** Where the Shard stands: inside the play field, clear of the ship's lane. */
const SHARD_AT = { x: 440, y: 420 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a magenta drone apart from the empty field behind it", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, { band: "magenta" });
  await h.advance(1);

  // A magenta drone against the empty field.
  captureStill(h, "magenta");

  const drone = droneOf(h.snapshot(), id);
  assertEqual(
    drone.effectiveBand,
    "magenta",
    "precondition: the Shard reads as magenta on the field (specs/bands.md; no " +
      "inversion is running)",
  );
  const square = footprintOf(drone.x, drone.y, SHARD_SIZE);
  const drawn = readRegion(h, square);

  // The same square of the same field with no drone on it: the control every
  // place the drone painted is held against.
  h.debug.clearDrones();
  await h.advance(1);
  const bare = readRegion(h, square);

  const apart = apartFromField(bare, drawn);
  assertGreaterThanOrEqual(
    apart.distance,
    DISTINCT_MIN,
    `the magenta Shard to read at least ${DISTINCT_MIN} of 441 from the empty ` +
      `field behind it, averaged over the ${apart.samples} places it painted ` +
      `inside its SHARD_SIZE (${SHARD_SIZE}) footprint (specs/overview.md: ` +
      `each band is told apart from the field behind it)`,
  );
});
