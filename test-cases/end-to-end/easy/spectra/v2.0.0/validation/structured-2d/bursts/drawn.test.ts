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
// IT. Inside the footprint the burst is played at, a whole PATCH of pixels must
// move when the burst is taken off the field with `clearBursts` — which is to
// say the burst put something there the field does not carry on its own. A
// flash, a ring, spark streaks, or any composition of them satisfies that, since
// it is the pixels a build put down rather than the shape it drew them in; a
// burst drawn nowhere, drawn somewhere else, or drawn in the colour of the field
// behind it does not.
//
// WHY A PATCH RATHER THAN ONE PIXEL. `specs/field.md` leaves a build's starfield
// its "motion if it has any", so the one frame between the two readings can
// carry a mark of it across a pixel of the square all on its own. A count is
// what tells that apart from a burst: the starfield holds at least
// `STARFIELD_MIN` (`40`) marks over the WHOLE play field, which is more than a
// thousand times the area of this square, while the seeded system bursts `235`
// particles inside it.
//
// WHY THE CONTROL IS THE SAME SQUARE RATHER THAN A PATCH OF FIELD ELSEWHERE.
// `specs/overview.md` fixes no palette and the starfield sits behind the play
// field, so a square held against some other patch's colour would read a build's
// own stars as a burst. Held against itself, what moved is what the burst
// painted — and the drone that popped is already gone from both readings, so it
// cannot be what moved either.
//
// WHY THE READING IS TAKEN EARLY IN THE PLAY. The seeded system bursts every one
// of its particles at time zero and they travel outward from there, so a
// twentieth of a second in the population is still inside the footprint the
// effect is played at. Later in the play the ring has left that square, and a
// check reading there would be demanding a footprint the specification does not
// fix. How long the play lasts is `bursts/one-shot-ends`.
//
// WHAT THIS DOES NOT DECIDE. What the burst is made of is
// `bursts/from-provided-system`, what it is scaled to is
// `bursts/scaled-to-drone`, and that two of them differ is `bursts/varies`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  changedPixels,
  footprintOf,
  furthestChange,
  readRegion,
} from "./reading";
import { firedPop, poseBystander } from "./scene";

/**
 * How far a pixel must move to count as painted, as a Euclidean RGB distance out
 * of the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/assets.md` states the rule and leaves the
 * palette to the build: `40` is about a tenth of the space, which is the least a
 * player reads at a glance, and far above the nothing that separates two
 * readings of one unchanged pixel. Light composited additively over a dark field
 * lands well past it.
 */
const DISTINCT_MIN = 40;

/**
 * How many pixels of the footprint must move that far.
 *
 * A fortieth of the `SHARD_SIZE` (`28`) square, which is `20` of its `784`
 * pixels. The floor it has to clear is what a drifting starfield could
 * contribute: the play field is `1280` by `592` units and carries at least
 * `STARFIELD_MIN` (`40`) marks (`specs/field.md`), so a square this size holds a
 * twentieth of one mark on an even spread, and a build would need tens of
 * thousands of stars before one frame's drift moved twenty pixels of it. The
 * ceiling it has to stay under is what a burst does: the seeded system puts
 * `235` particles inside the same square at this age, so even a build drawing
 * them small and dim leaves a patch several times this. It asks for a patch, not
 * for a brightness, a shape or a coverage the specification does not fix.
 */
const PAINTED_MIN = Math.round((SHARD_SIZE * SHARD_SIZE) / 40);

/** How far into the play the field is read, in seconds. */
const READ_AGE = 0.05;

/** Where the drone is posed: the clear stretch of field this group pops on. */
const POP_AT = { x: 1000, y: 460 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the field inside the footprint the burst is played at", async () => {
  startPosed(h);
  poseBystander(h);
  poseDrone(h, "shard", POP_AT.x, POP_AT.y, { band: "cyan" });

  await firedPop(h, POP_AT.x, POP_AT.y, "cyan");
  await h.advance(ticksFor(READ_AGE));

  // The burst painted over the field.
  captureStill(h, "drawn");

  const box = footprintOf(POP_AT.x, POP_AT.y, SHARD_SIZE);
  const painted = readRegion(h, box);

  // The same square of the same field with the burst taken off it: the control
  // every pixel above is held against.
  h.debug.clearBursts();
  await h.advance(1);
  assertLength(
    h.snapshot().bursts,
    0,
    "precondition: the field is left with no burst playing",
  );
  const bare = readRegion(h, box);

  const moved = changedPixels(bare, painted, DISTINCT_MIN);
  const furthest = furthestChange(bare, painted, box);
  assertGreaterThanOrEqual(
    moved,
    PAINTED_MIN,
    `the pixels of the SHARD_SIZE (${SHARD_SIZE}) footprint the burst is ` +
      `played at, centred on (${POP_AT.x}, ${POP_AT.y}), that the burst moved ` +
      `more than ${DISTINCT_MIN} of 441 from what that same square of the ` +
      `field carries with no burst on it (specs/assets.md: the build draws the ` +
      `particles the simulation reports, composited additively over the field); ` +
      `the pixel that moved furthest moved ${furthest.distance.toFixed(1)}, at ` +
      `(${furthest.x.toFixed(0)}, ${furthest.y.toFixed(0)})`,
  );
});
