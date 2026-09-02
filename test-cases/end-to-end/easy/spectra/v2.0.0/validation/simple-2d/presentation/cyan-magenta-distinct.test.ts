// Spectra — presentation/cyan-magenta-distinct: the two bands are told apart.
//
// `specs/overview.md`'s legibility table, the first row: "A cyan thing and a
// magenta thing are told apart at a glance." It is the one row of that table
// whose failure breaks the game rather than the look, which is why this item's
// cap is `broken`: `specs/bands.md` decides every shot by band, so a player who
// cannot see which band a drone carries cannot play at all.
//
// NO COLOUR IS ASSERTED, AND THERE IS NONE TO ASSERT. `specs/overview.md` fixes
// no palette — "the palette, the type, the glow, and every other aspect of the
// look are yours" — so what is graded is the DISTANCE between the two bands as
// the build drew them, never a hex value.
//
// THE TWO ARE ONE DRONE OF ONE KIND, IN THE TWO BANDS. Two Shards side by side,
// identical in every respect but the band they store, so the only thing that can
// separate the two readings is the band. A Shard against a Prism would separate
// on the kind as well, and a build that drew both bands the same colour would
// still pass; that the three KINDS read apart is `presentation/drones-distinct`'s
// question.
//
// THE READING IS THE PIXELS, HELD PLACE FOR PLACE. Both stand at the same
// `SHARD_SIZE` (`28`) footprint, so the square each occupies is read over the
// same extent and the two pictures are compared place for place over everything
// either painted — see `presentation/reading`. Held against the same squares of
// the same field with the Shards gone, so a build's own starfield is in both
// readings and cannot be what moved.
//
// BOTH ARE PROPS with every faculty off, so neither travels, oscillates or fires
// between the pose and the frame that is read, and neither carries a shell state
// that could separate them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  readRegion,
  startPosed,
  type Band,
  type Harness,
  type Region,
} from "../harness";
import { apartness, footprintOf } from "./reading";

/**
 * How far apart the two bands must read, as a Euclidean RGB distance out of the
 * `441` an RGB cube is across, averaged over everything either drone painted.
 *
 * The figure this item is written against: at least `60` of `441`, half again
 * the `40` this checklist calls the least a player reads at a glance. The band a
 * drone carries is the one fact a player must never misread — every shot is
 * decided by it — so the two bands are held to a wider separation than anything
 * else on the field.
 */
const DISTINCT_MIN = 60;

/** The row the two stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 420;

/**
 * Where the two stand, `400` units apart — more than fourteen footprints — so no
 * glow or accent a build lays around one can reach the square the other is read
 * through.
 */
const POSED: readonly { band: Band; x: number }[] = [
  { band: "cyan", x: 440 },
  { band: "magenta", x: 840 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a cyan drone and a magenta drone in colours told apart", async () => {
  startPosed(h);
  const ids = POSED.map(({ band, x }) => ({
    band,
    id: poseDrone(h, "shard", x, ROW_Y, { band }),
  }));
  await h.advance(1);

  // A cyan drone beside a magenta one.
  captureStill(h, "pair");

  const posed = h.snapshot();
  const read = ids.map(({ band, id }) => {
    const drone = droneOf(posed, id);
    assertEqual(
      drone.effectiveBand,
      band,
      `precondition: the ${band} Shard reads as ${band} on the field ` +
        `(specs/bands.md; no inversion is running)`,
    );
    return { band, square: footprintOf(drone.x, drone.y, SHARD_SIZE) };
  });

  const drawn: Region[] = read.map(({ square }) => readRegion(h, square));

  // The same two squares of the same field with no drone on them: the control
  // every reading above is held against.
  h.debug.clearDrones();
  await h.advance(1);
  const bare: Region[] = read.map(({ square }) => readRegion(h, square));

  const apart = apartness(bare[0], drawn[0], bare[1], drawn[1]);
  assertGreaterThanOrEqual(
    apart.distance,
    DISTINCT_MIN,
    `the cyan Shard and the magenta Shard to read at least ${DISTINCT_MIN} of ` +
      `441 apart, averaged over the ${apart.samples} places either of them ` +
      `painted inside their SHARD_SIZE (${SHARD_SIZE}) footprints ` +
      `(specs/overview.md: a cyan thing and a magenta thing are told apart at ` +
      `a glance)`,
  );
});
