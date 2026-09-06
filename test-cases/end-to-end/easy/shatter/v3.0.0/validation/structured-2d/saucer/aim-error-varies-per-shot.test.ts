// saucer/aim-error-varies-per-shot — the offset is drawn afresh for every shot.
//
// THE RULE. `specs/saucer.md`, Firing: the bearing is offset "by an angle drawn
// afresh for every shot, uniformly from `-SAUCER_AIM_ERROR` to
// `+SAUCER_AIM_ERROR`", and the specification draws the consequence itself:
// "Successive shots at a stationary ship therefore differ." That consequence is
// what makes the rule assertable, and it is what this point reads.
//
// WHAT IS READ. The spread — the largest bearing minus the smallest — of sixty
// shots at a ship that does not move, which must exceed four degrees. Two wrong
// builds are what the threshold has to separate: one that aims dead on, whose
// sixty bearings are identical and whose spread is zero; and one that draws an
// offset ONCE and reuses it, whose spread is also zero. A build drawing afresh
// from `+/- 10` degrees clears four overwhelmingly — sixty uniform draws span less
// than a fifth of their range only once in about `10^40` runs — so the threshold
// is loose enough to be about the rule rather than about the draw.
//
// THE THRESHOLD COMES FROM THE STATED RANGE, not from an observed spread: four
// degrees is a fifth of the twenty the specification fixes. Reading it off a
// reference run would have made it a fact about that build.
//
// THE SHIP IS STATIONARY, which is the condition the specification's own sentence
// names. A ship in motion would spread the bearings by moving, and the point would
// then pass for a build with no error at all.
//
// NOTHING IS POSED FOR THE ERROR. `setNextSaucerAim` is how a check that wants a
// particular error gets one, and this check wants the build's own draws, sixty of
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
import { DEG, SAUCER_AIM_ERROR } from "../constants";
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

/** How many shots the spread is taken over. */
const SHOTS = 60;

/** How long the collection may run for, in seconds of game time. */
const BUDGET = 140;

/**
 * The least the sixty bearings may span, in degrees: a fifth of the twenty-degree
 * range `specs/saucer.md` draws each offset from. See the header.
 */
const MIN_SPREAD = 4 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spreads sixty shots at a still ship over more than four degrees", async () => {
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  const shots = await collectShots(
    h,
    GUN_POSE,
    SHOTS,
    framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
  );
  // The scatter across sixty shots at a still ship.
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
    MIN_SPREAD / DEG,
    `the spread of ${SHOTS} shot bearings at a stationary ship, in degrees, ` +
      `against a fifth of the ${(2 * SAUCER_AIM_ERROR) / DEG}-degree range ` +
      "each offset is drawn from — successive shots at a stationary ship " +
      "differ (specs/saucer.md)",
  );
});
