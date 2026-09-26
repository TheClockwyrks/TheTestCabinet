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
// IT. Inside the footprint the burst is played at, at least one pixel must move
// when the burst is taken off the field with `clearBursts` — which is to say the
// burst put something there the field does not carry on its own. A flash, a ring,
// spark streaks, or any composition of them satisfies that, since what is read is
// that pixels were put down rather than how bright, how broad or what shape they
// were; a burst drawn nowhere or drawn somewhere else does not. How the burst
// reads is the reviewer's presentation rating.
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
// `bursts/from-provided-system`, and what it is scaled to is
// `bursts/scaled-to-drone`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  readRegion,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  PAINT_MIN,
  changedPixels,
  footprintOf,
  furthestChange,
} from "./reading";
import { firedPop } from "./scene";

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

  const furthest = furthestChange(bare, painted, box);
  assertGreaterThan(
    changedPixels(bare, painted, PAINT_MIN),
    0,
    `pixels of the SHARD_SIZE (${SHARD_SIZE}) footprint the burst is played ` +
      `at, centred on (${POP_AT.x}, ${POP_AT.y}), that the burst painted over ` +
      `what that same square of the field carries with no burst on it ` +
      `(specs/assets.md: the build draws the particles the simulation reports, ` +
      `composited additively over the field); the pixel that moved furthest ` +
      `moved ${furthest.distance.toFixed(1)}, at ` +
      `(${furthest.x.toFixed(0)}, ${furthest.y.toFixed(0)})`,
  );
});
