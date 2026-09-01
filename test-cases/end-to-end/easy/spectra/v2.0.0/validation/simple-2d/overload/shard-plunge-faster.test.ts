// overload/shard-plunge-faster — the plunge runs faster than a dive.
//
// specs/mode.md fixes the plunge's speed against the one specs/swarm.md already fixes
// for a dive: the Shard "plunges down the field toward the ship's current `x`, at
// `OVERLOAD_DIVE_SCALE` (`1.6`) times the dive speed `specs/swarm.md` states for the
// stage." specs/swarm.md states that speed ALONG THE PATH — "A diving drone follows a
// smooth swooping path of your design down through the field, at `DIVE_SPEED` (`300`)
// units per second along that path" — and specs/stages.md scales it by
// `droneSpeedScale(stage)`, which is 1 at stage 1. So the figure this point reads is
// 480 units of PATH per second.
//
// THE MEASUREMENT IS PATH LENGTH, NOT DISPLACEMENT, and that is what makes it a
// reading of the specification rather than of one build's path. The route a plunge
// takes is the build's own, so two conforming builds can be in completely different
// places a second in; what the specification fixes is how much ground each covers
// getting there. Summing the distance between successive frames' centres measures
// exactly that, and at the harness's 120 Hz a plunge moves 4 units a frame, so the
// chord and the arc it stands in for differ by nothing that matters at a 15%
// tolerance.
//
// THE ONE DISCONTINUITY THE SPECIFICATION ALLOWS IS FILTERED OUT. specs/swarm.md lets
// "a dive that leaves below `FIELD_BOTTOM` re-appear above `FIELD_TOP`", and that jump
// is not ground the drone covered. A step longer than {@link WRAP_STEP} is therefore
// read as that wrap and closes the measurement, which is why the window below is short
// and opens high in the field: on a build that does not wrap there, the whole window is
// measured.
//
// THE TOLERANCE IS THE MANIFEST'S: within 15% of `OVERLOAD_DIVE_SCALE` times the
// normal dive distance in a second. That is wide enough for the frame the overload
// landed on, where a build may cover part of a step, and narrow enough that a plunge
// running at the plain `DIVE_SPEED` — the whole point of the reaction — reads 300
// against a 408-unit floor and fails.
//
// WHAT THIS DOES NOT DECIDE. That the plunge happens at all and where it goes, which
// is `overload/shard-plunges`; and an ordinary dive's own speed, which is
// `swarm/dive-speed`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  FIELD_TOP,
  OVERLOAD_AT,
  OVERLOAD_DIVE_SCALE,
  droneSpeedScale,
} from "../../src/constants";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  droneOf,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/** The stage `startPosed` opens on, which fixes `droneSpeedScale`. */
const STAGE = 1;

/** Where the ship is parked. As in `overload/shard-plunges`. */
const SHIP_AT = 200;

/**
 * Where the target Shard stands.
 *
 * High in the play field, on the far side from the ship, so the plunge has the whole
 * depth of the field to run through and reaches nothing that could turn it back inside
 * the window measured.
 */
const TARGET = { x: 1040, y: FIELD_TOP + 136 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * How long the plunge is measured over, in seconds, and the frames that covers.
 *
 * Half a second: long enough that the frame the overload landed on is a sixtieth of
 * the reading rather than a large part of it, short enough that the 240 units of path
 * it covers cannot carry the drone off the bottom of a field it starts 456 units above.
 */
const MEASURED_SECONDS = 0.5;
const MEASURED_FRAMES = ticksFor(MEASURED_SECONDS);

/** The seconds one frame of the harness's clock covers. */
const FRAME_SECONDS = seconds(1);

/**
 * The longest step between two frames that is TRAVEL rather than the wrap
 * specs/swarm.md allows a dive, in logical units.
 *
 * A plunge covers 4 units a frame and the wrap it is told apart from spans the whole
 * play field, 592 units. A hundred sits an order of magnitude clear of both, so nothing
 * a build could reach by travelling is discarded and no wrap is counted as ground
 * covered.
 */
const WRAP_STEP = 100;

/**
 * The fewest frames that must be measured for the reading to stand.
 *
 * Four fifths of the window. A build that wraps inside it leaves less ground than that
 * measured, and a rate read off a handful of frames would be a reading of the frame the
 * overload landed on rather than of the plunge.
 */
const MEASURED_MIN = Math.ceil(MEASURED_FRAMES * 0.8);

/**
 * The path a plunge covers in a second, in logical units, and the band around it.
 *
 * `DIVE_SPEED` (300) is the normal dive distance in a second at stage 1
 * (specs/swarm.md, scaled by `droneSpeedScale`), and `OVERLOAD_DIVE_SCALE` (1.6) is
 * what specs/mode.md multiplies it by. Within 15%, the tolerance this case's manifest
 * states for the point: 408 to 552, which excludes both an unscaled dive at 300 and a
 * plunge at twice the dive speed.
 */
const PLUNGE_RATE = DIVE_SPEED * droneSpeedScale(STAGE) * OVERLOAD_DIVE_SCALE;
const RATE_TOLERANCE = 0.15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers OVERLOAD_DIVE_SCALE times a dive's ground in a second of plunge", async () => {
  startPosed(h);
  h.debug.setShipX(SHIP_AT);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
    // Its locomotion, because the ground it covers is what this point reads.
    travel: true,
  });

  await mismatchShot(h, target, SHOT_BELOW);
  const overloaded = droneOf(h.snapshot(), target);
  assertEqual(
    overloaded.phase,
    "diving",
    "the phase the plunge this point measures runs in (specs/mode.md); " +
      "`overload/shard-plunges` is the point that grades it",
  );

  let previous = { x: overloaded.x, y: overloaded.y };
  let covered = 0;
  let measured = 0;
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
    await h.advance(1);
    const drone = droneOf(h.snapshot(), target);
    const step = distance(previous, drone);
    previous = { x: drone.x, y: drone.y };
    // The one discontinuity specs/swarm.md allows a dive is not ground covered.
    if (step > WRAP_STEP) break;
    covered += step;
    measured += 1;
  }
  captureStill(h, "faster");

  assertGreaterThanOrEqual(
    measured,
    MEASURED_MIN,
    `the frames of the ${String(MEASURED_SECONDS)} s window measured before the ` +
      "plunge wrapped through the bottom of the field (specs/swarm.md), which is " +
      "how much of it the reading below rests on",
  );
  assertBetween(
    covered / (measured * FRAME_SECONDS),
    PLUNGE_RATE * (1 - RATE_TOLERANCE),
    PLUNGE_RATE * (1 + RATE_TOLERANCE),
    "the units of path an overloaded Shard's plunge covers in a second, which is " +
      `${String(OVERLOAD_DIVE_SCALE)} times the ` +
      `${String(DIVE_SPEED * droneSpeedScale(STAGE))} a dive covers at stage ` +
      `${String(STAGE)}, within ${String(RATE_TOLERANCE * 100)}% ` +
      "(specs/mode.md, specs/swarm.md)",
  );
});
