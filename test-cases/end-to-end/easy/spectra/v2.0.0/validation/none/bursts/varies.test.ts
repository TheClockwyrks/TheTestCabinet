// Spectra — bursts/varies: successive bursts scatter differently.
//
// `specs/assets.md`, the drone-burst's "How it varies" rule: "Each burst is
// seeded from the game's own generator, so successive bursts in a run scatter
// differently while the flash, the ring, and the two-band sparks read the same."
// `specs/simulation.md` and `specs/instrumentation.md` say where that generator
// lives: the state carries one, and "the wave's layout, the choice of which
// drone dives next, the gap before the next dive, a Flux's starting phase, and
// each burst's scatter are all drawn from it".
//
// THIS IS THE POINT THAT TELLS A SIMULATION FROM A RECORDING. Every other burst
// point in this group is satisfied by a build that plays one canned animation
// back at the right size in the right place for the right length of time. Only
// this one is not: two bursts played at the SAME PLACE and read at the SAME AGE
// are the same picture under a recording, and different pictures under a
// simulation drawing fresh values from the run's generator.
//
// SO EVERYTHING BUT THE SCATTER IS HELD FIXED. Both drones are the same kind, in
// the same band, at the same centre, destroyed by the same shot from the same
// distance — so both bursts are played at the same footprint, from the same
// place, and are read after the same number of driven frames. The first is taken
// off with `clearBursts` before the second is started, so what is compared is
// one burst against one burst rather than one against two. What is left to
// differ is the one thing the specification says differs.
//
// THE READING IS THE MEAN OF THE SQUARE, SAMPLE FOR SAMPLE. Not the furthest
// sample: a single moved pixel is what one particle's rounding does, while the
// mean over the whole footprint moves only if the population as a whole landed
// somewhere else. And it is the same square of the same field both times, so the
// starfield and everything else a build draws under the burst is compared
// against itself and cancels.
//
// WHAT THIS DOES NOT DECIDE. That the same generator replays a run identically
// from a seed is `instrumentation/reset-seeds-randomness`. That a burst is
// painted at all is `bursts/drawn`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  framesFor,
  poseDrone,
  readRegion,
  regionDistance,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How far apart the two readings must stand, as a mean Euclidean RGB distance
 * per sample out of the `441` an RGB cube is across.
 *
 * The case's figure. The bound this is set against is not a palette but ZERO:
 * two readings of one recording, replayed at the same size in the same place and
 * read at the same age, are the same picture sample for sample, and the field
 * they are read over is compared against itself. `8` is comfortably above what
 * any drift under the burst — a starfield a build chose to animate, a HUD digit
 * outside the square — can contribute to a mean over `784` samples, and far
 * below what two independent scatters of the seeded system's `235` particles
 * put there.
 */
const VARIES_MIN = 8;

/**
 * How far into each play the field is read, in seconds.
 *
 * Late enough that the seeded system's ring and sparks have travelled out from
 * the centre under drag, which is where two draws of the generator separate
 * visibly, and early enough that the population is still inside the footprint
 * the effect is played at — the reading must not become a demand for a spread
 * the specification does not fix.
 */
const READ_AGE = 0.15;

/** The lattice the footprint is read on, in logical units: every pixel of it. */
const READ_STEP = 1;

/** Where both drones are posed, and how far below each the shot starts. */
const POP_AT = { x: 1000, y: 460 } as const;
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("paints two bursts of one run differently at the same place and age", async () => {
  await startPosed(h);
  const rect = footprint(POP_AT.x, POP_AT.y, SHARD_SIZE);

  const first = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });
  const firstShot = await shootDrone(h, first, "cyan", { below: SHOT_BELOW });
  assertLength(
    (await h.snapshot()).bursts,
    1,
    "precondition: the first matching shot left one burst playing",
  );
  await h.advance(framesFor(READ_AGE));

  // The first burst at its read age.
  await captureStill(h, "first");
  const painted = await readRegion(h, rect, READ_STEP);

  // The first taken off the field, so the second is read alone.
  await h.debug.clearBursts();

  const second = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });
  const secondShot = await shootDrone(h, second, "cyan", { below: SHOT_BELOW });
  assertLength(
    (await h.snapshot()).bursts,
    1,
    "precondition: the second matching shot left one burst playing",
  );
  await h.advance(framesFor(READ_AGE));

  // The second burst at the same age, in the same place.
  await captureStill(h, "second");
  const repainted = await readRegion(h, rect, READ_STEP);

  assertEqual(
    secondShot.frames,
    firstShot.frames,
    `precondition: both shots resolved in the same number of frames, so both ` +
      `bursts are read at the same age`,
  );

  const apart = regionDistance(painted, repainted);
  assertGreaterThan(
    apart,
    VARIES_MIN,
    `the two bursts, played at the same centre (${POP_AT.x}, ${POP_AT.y}) at ` +
      `the same SHARD_SIZE (${SHARD_SIZE}) footprint and read ` +
      `${READ_AGE}s into each play, painting the field measurably differently ` +
      `(specs/assets.md: each burst is seeded from the game's own generator, so ` +
      `successive bursts in a run scatter differently); a replayed recording ` +
      `would paint them identically, at a distance of 0`,
  );
});
