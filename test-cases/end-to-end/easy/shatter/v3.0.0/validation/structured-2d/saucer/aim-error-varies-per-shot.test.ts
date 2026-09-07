// saucer/aim-error-varies-per-shot — the offset is drawn afresh for every shot.
//
// THE RULE. `specs/saucer.md`, Firing: the bearing is offset "by an angle drawn
// afresh for every shot, uniformly from `-SAUCER_AIM_ERROR` to
// `+SAUCER_AIM_ERROR`", and the specification draws the consequence itself:
// "Successive shots at a stationary ship therefore differ." That consequence is
// what makes the rule assertable, and it is what this point reads.
//
// WHAT IS READ. Eight shots at a ship that does not move, which must not all
// leave along one bearing. Two wrong builds are what the reading has to
// separate from a conformant one: one that aims dead on, whose eight bearings
// are identical; and one that draws an offset ONCE and reuses it, whose eight
// are identical too. A build drawing afresh from a continuous range never
// repeats a bearing, so two distinct bearings among the eight is the whole of
// the assertion. How widely a build's shots scatter inside the stated range is
// not a figure `specs/saucer.md` fixes and not one a sample decides: it is the
// reviewer's to judge from the picture.
//
// TWO BEARINGS ARE DISTINCT WHEN THEY DIFFER BY MORE THAN A READING CAN. A
// round is ballistic from the moment it leaves, and this point samples every
// `SHOT_TICKS_PER_FRAME` ticks, so a reading can be up to three ticks old: at
// `(60, 60)` the well turns a `300`-unit-per-second round by `0.05` degrees over
// those ticks. A quarter of a degree is five times that, so a build with no error
// at all cannot be credited with variation the well and the sampling supplied,
// and it is a fortieth of the twenty-degree range a conformant draw covers.
//
// THE SHIP IS STATIONARY, which is the condition the specification's own sentence
// names. A ship in motion would spread the bearings by moving, and the point would
// then pass for a build with no error at all.
//
// NOTHING IS POSED FOR THE ERROR. `setNextSaucerAim` is how a check that wants a
// particular error gets one, and this check wants the build's own draws, eight of
// them.
//
// THE SCENARIO IS THE ONE `saucer/aims-at-the-ship` POSES, for the same reasons:
// the craft at rest so the round's velocity is the aim rather than the aim plus a
// cruise, its mind and travel shut so the bearing to the ship is one number, and
// the ship `400` units away at rest with its contact test shut. See `shots.ts`.
//
// WHAT THIS DOES NOT DECIDE. Where the shots are centred
// (`saucer/aims-at-the-ship`) or how far one may stray
// (`saucer/aim-error-within-10-degrees`).

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../constants";
import { assertGreaterThan, assertLength } from "../assert";
import { angleDelta } from "../geometry";
import { captureStill, poseShip, startPlaying, type Harness } from "../harness";
import {
  collectShots,
  createShotHarness,
  framesFor,
  poseGunner,
  SHOT_TICKS_PER_FRAME,
} from "./shots";

/** Where the gunner stands, at rest. See `aims-at-the-ship` for why this corner. */
const GUN_POSE = { x: 60, y: 60, vx: 0, vy: 0 };

/** Where the ship is posed: 400 units away, along the row the gunner is on. */
const SHIP_X = 460;
const SHIP_Y = 60;

/** How many shots are read. */
const SHOTS = 8;

/**
 * How long the collection may run for, in seconds of game time.
 *
 * Eight shots at `SAUCER_FIRE_INTERVAL` is `12.8` seconds across two visits, and
 * the second visit is posed the frame the first runs out; twenty is that with
 * room.
 */
const BUDGET = 20;

/**
 * How far apart two bearings must be to count as two bearings, in degrees.
 *
 * A quarter of a degree: five times what the well can turn a reading by over the
 * ticks it may be old, and a fortieth of the range the offset is drawn from. See
 * the header.
 */
const DISTINCT_DEG = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires eight shots at a still ship along more than one bearing", async () => {
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  const shots = await collectShots(
    h,
    GUN_POSE,
    SHOTS,
    framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
  );
  // The scatter across eight shots at a still ship.
  // The sweep above runs undrawn, so one frame is drawn for the picture —
  // after every reading the verdict rests on has been taken.
  await h.paint();
  captureStill(h, "scatter");

  assertLength(
    shots,
    SHOTS,
    `rounds collected inside ${BUDGET} s of game time — the saucer fires one ` +
      "every SAUCER_FIRE_INTERVAL it is on the field (specs/saucer.md)",
  );

  const errors = shots.map(
    (shot) => angleDelta(shot.aimed, shot.heading) / DEG,
  );

  assertGreaterThan(
    Math.max(...errors) - Math.min(...errors),
    DISTINCT_DEG,
    `the degrees between the widest two of ${SHOTS} shot bearings at a ` +
      "stationary ship, which an offset drawn afresh for every shot puts apart " +
      "and a fixed aim never does (specs/saucer.md)",
  );
});
