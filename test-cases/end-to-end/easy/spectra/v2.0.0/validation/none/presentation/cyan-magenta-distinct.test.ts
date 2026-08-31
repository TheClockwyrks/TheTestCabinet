// Spectra — presentation/cyan-magenta-distinct: the two bands are told apart.
//
// `specs/overview.md`'s legibility table, the first row: "A cyan thing and a
// magenta thing are told apart at a glance." It is the one row of that table
// whose failure breaks the game rather than the look, which is why this item's
// cap is `broken`: `specs/bands.md` decides every shot by band, so a player who
// cannot see which band a drone carries cannot play at all.
//
// NO COLOUR IS ASSERTED, AND THERE IS NONE TO ASSERT. `specs/overview.md` fixes
// no palette — "the palette, the type and every other aspect of the look are
// yours" — so what is graded is the DISTANCE between the two bands as the build
// drew them, never a hex value.
//
// THE TWO ARE ONE DRONE OF ONE KIND, IN THE TWO BANDS. Two Shards side by side,
// identical in every respect but the band they store, so the only thing that can
// separate the two readings is the band. A Shard against a Prism would separate
// on the kind as well, and a build that drew both bands the same colour would
// still pass; that the three KINDS read apart is `presentation/drones-distinct`'s
// question.
//
// THE READING IS THE PIXELS, HELD PLACE FOR PLACE. Both stand at the same
// `SHARD_SIZE` (`28`) footprint, so the square each occupies is read on the same
// lattice and the two pictures are compared place for place over everything
// either painted — see `presentation/reading`. Held against the same squares of
// the same field with the Shards gone, so a build's own starfield is in both
// readings and cannot be what moved.
//
// BOTH ARE PROPS with every faculty off, so neither travels, oscillates or fires
// between the pose and the frame that is read, and neither carries a charge or a
// shell state that could separate them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  poseDrone,
  readRegion,
  requireDrone,
  startPosed,
  type Harness,
  type Rgb,
} from "../harness";
import { apartness } from "./reading";

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
const CYAN_X = 440;
const MAGENTA_X = 840;

/**
 * The lattice each square is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so a `SHARD_SIZE` (`28`) square is every one of its `784` pixels and
 * a band carried on a thin accent alone is still read.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a cyan drone and a magenta drone in colours told apart", async () => {
  await startPosed(h);
  const cyan = await poseDrone(h, "shard", CYAN_X, ROW_Y, { band: "cyan" });
  const magenta = await poseDrone(h, "shard", MAGENTA_X, ROW_Y, {
    band: "magenta",
  });
  await h.advance(1);

  // A cyan drone beside a magenta one.
  await captureStill(h, "pair");

  const posed = await h.snapshot();
  const read = [
    { id: cyan, name: "the cyan Shard", band: "cyan" },
    { id: magenta, name: "the magenta Shard", band: "magenta" },
  ].map(({ id, name, band }) => {
    const drone = requireDrone(posed, id, name);
    assertEqual(
      drone.effectiveBand,
      band,
      `precondition: ${name} reads as ${band} on the field (specs/bands.md; ` +
        `no inversion is running)`,
    );
    return { name, square: footprint(drone.x, drone.y, SHARD_SIZE) };
  });

  const drawn: Rgb[][] = [];
  for (const { square } of read) {
    drawn.push(await readRegion(h, square, READ_STEP));
  }

  // The same two squares of the same field with no drone on them: the control
  // every reading above is held against.
  await h.debug.clearDrones();
  await h.advance(1);
  const bare: Rgb[][] = [];
  for (const { square } of read) {
    bare.push(await readRegion(h, square, READ_STEP));
  }

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
