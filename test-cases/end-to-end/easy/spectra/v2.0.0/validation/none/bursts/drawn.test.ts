// Spectra — bursts/drawn: a burst is drawn where it plays.
//
// `specs/assets.md` puts the drone-burst among the things the build DRAWS: the
// build is to "draw the particles the simulation reports", compositing them
// "additively over the field so the burst reads as light", centred on the
// destroyed drone's centre and scaled to that drone's footprint. A burst the
// roster holds and the canvas does not show is a simulation nobody sees, so the
// reading here is on the pixels rather than on the roster.
//
// THE READING IS THE SAME SQUARE OF THE SAME FIELD, WITH THE BURST AND WITHOUT
// IT. Inside the footprint the burst is played at, some sample must move more
// than `DISTINCT_MIN` of `441` when the burst is taken off the field with
// `clearBursts` — which is to say the burst put something there the field does
// not carry on its own. A flash, a ring, spark streaks, or any composition of
// them satisfies that, since it is the pixels a build put down rather than the
// shape it drew them in; a burst drawn nowhere, drawn somewhere else, or drawn
// in the colour of the field behind it does not.
//
// WHY THE CONTROL IS THE SAME SQUARE RATHER THAN A PATCH OF FIELD ELSEWHERE.
// `specs/overview.md` fixes no palette and `specs/field.md` puts a starfield
// behind the play field, so a square held against some other patch's colour
// would read a build's own stars as a burst. Held against itself, the only thing
// that can move is what the burst painted — and the drone that popped is already
// gone from both readings, so it cannot be what moved either.
//
// WHY THE READING IS TAKEN EARLY IN THE PLAY. The seeded system bursts every one
// of its particles at time zero and they travel outward under drag from there,
// so a twentieth of a second in the whole population is still inside the
// footprint the effect is played at. Later in the play the ring has left that
// square, and a check reading there would be demanding a footprint the
// specification does not fix. How long the play lasts is `bursts/one-shot-ends`.
//
// WHAT THIS DOES NOT DECIDE. What the burst is made of is
// `bursts/from-provided-system`, what it is scaled to is
// `bursts/scaled-to-drone`, and that two of them differ is `bursts/varies`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  framesFor,
  poseBystander,
  poseDrone,
  readRegion,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";
import { furthestChange } from "./reading";

/**
 * How far the drawn burst must move the field, as a Euclidean RGB distance out
 * of the `441` an RGB cube is across.
 *
 * The case's figure, since the specification states the rule and leaves the
 * palette to the build: `40` is about a tenth of the space, which is the least a
 * player reads at a glance, and far above the nothing that separates two
 * readings of one unchanged pixel. `specs/assets.md` asks for light composited
 * additively over a dark field, which lands well past it.
 */
const DISTINCT_MIN = 40;

/** How far into the play the field is read, in seconds. */
const READ_AGE = 0.05;

/**
 * The lattice the footprint is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at the harness's own
 * viewport, so a `SHARD_SIZE` (`28`) square is `784` samples — every pixel of
 * it, and a burst drawn as a scatter of thin streaks cannot fall between two
 * samples.
 */
const READ_STEP = 1;

/** Where the drone is posed, and how far below it the shot starts. */
const POP_AT = { x: 1000, y: 460 } as const;
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("paints the field inside the footprint the burst is played at", async () => {
  await startPosed(h);
  await poseBystander(h);
  const target = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });

  await shootDrone(h, target, "cyan", { below: SHOT_BELOW });
  assertLength(
    (await h.snapshot()).bursts,
    1,
    "precondition: the matching shot left one burst playing",
  );

  await h.advance(framesFor(READ_AGE));

  // The burst painted over the field.
  await captureStill(h, "drawn");

  const rect = footprint(POP_AT.x, POP_AT.y, SHARD_SIZE);
  const painted = await readRegion(h, rect, READ_STEP);

  // The same square of the same field with the burst taken off it: the control
  // every sample above is held against.
  await h.debug.clearBursts();
  await h.advance(1);
  assertLength(
    (await h.snapshot()).bursts,
    0,
    "precondition: the field is left with no burst playing",
  );
  const bare = await readRegion(h, rect, READ_STEP);

  const moved = furthestChange(bare, painted, rect, READ_STEP);
  assertGreaterThan(
    moved.distance,
    DISTINCT_MIN,
    `the burst painting some pixel of the SHARD_SIZE (${SHARD_SIZE}) footprint ` +
      `it is played at, centred on (${POP_AT.x}, ${POP_AT.y}), more than ` +
      `${DISTINCT_MIN} of 441 from what that same square of the field carries ` +
      `with no burst on it (specs/assets.md: the build draws the particles the ` +
      `simulation reports, composited additively over the field); the sample ` +
      `that moved furthest was at (${moved.x.toFixed(0)}, ${moved.y.toFixed(0)})`,
  );
});
