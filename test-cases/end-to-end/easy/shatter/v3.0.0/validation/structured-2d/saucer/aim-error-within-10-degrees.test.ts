// saucer/aim-error-within-10-degrees — no single shot is further off than the
// error the specification allows.
//
// THE RULE. `specs/saucer.md`, Firing: the shot's bearing is the bearing to the
// ship "offset by an angle drawn afresh for every shot, uniformly from
// `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR` (`10` degrees)". `10` degrees is the
// end of the range, so no shot leaves further off than that. THE BOUND ALONE is
// this point: that the sixty are CENTRED on the ship is
// `saucer/aims-at-the-ship`'s, and that they SCATTER is
// `saucer/aim-error-varies-per-shot`'s. Three separable ways to be wrong, three
// points, so one broken gun costs the point it broke.
//
// WHAT IS READ. Every one of sixty shots, held against the bound individually — a
// build that fires fifty-nine good rounds and one wild one fails on the wild one,
// which no average would catch.
//
// THE ALLOWANCE ON THE BOUND IS A READING COST, NOT ROOM ON THE RULE. A round is
// ballistic from the moment it leaves ("It is pulled by the well"), and this point
// samples every `SHOT_TICKS_PER_FRAME` ticks, so a reading can be up to three
// ticks old. At `(60, 60)` the well pulls at `10.6` units per second squared
// (`specs/gravity.md`), which over three ticks turns a `300`-unit-per-second round
// by `0.05` degrees; the allowance below is `0.2` degrees, four times the worst
// case and two percent of the bound it is added to. A build drawing uniformly over
// `+/- 10` degrees is not failed for the well's work, and a build drawing over
// `+/- 15` — or aiming freely — is failed on the first shot past ten.
//
// THE SCENARIO IS THE ONE `saucer/aims-at-the-ship` POSES, for the same reasons:
// the craft at rest so the round's velocity is the aim rather than the aim plus a
// cruise, its mind and travel shut so the bearing to the ship is one number, the
// ship `400` units away at rest with its contact test shut, and the whole thing in
// a corner where the well is weakest. See `shots.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SAUCER_AIM_ERROR } from "../constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { angleDelta } from "../geometry";
import {
  captureStill,
  poseShip,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import {
  collectShots,
  createShotHarness,
  framesFor,
  poseGunner,
  SHOT_TICKS_PER_FRAME,
} from "./shots";

/** The seed the run is opened on, so the sixty draws are the same every run. */
const SEED = 1;

/** Where the gunner stands, at rest. See `aims-at-the-ship` for why this corner. */
const GUN_POSE = { x: 60, y: 60, vx: 0, vy: 0 };

/** Where the ship is posed: 400 units away, along the row the gunner is on. */
const SHIP_X = 460;
const SHIP_Y = 60;

/** How many shots the bound is applied to. */
const SHOTS = 60;

/** How long the collection may run for, in seconds of game time. */
const BUDGET = 140;

/**
 * What the sampled reading may add to the bound, in degrees.
 *
 * `0.2`, which is four times the `0.05` degrees the well can turn a round over the
 * three ticks a reading may be old at this scenario's distance from the star, and
 * two percent of the ten degrees it is added to. See the header.
 */
const READING_SLACK = 0.2 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every one of sixty shots inside SAUCER_AIM_ERROR of the bearing to the ship", async () => {
  resetTo(h, SEED);
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  const shots = await collectShots(
    h,
    GUN_POSE,
    SHOTS,
    framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
  );
  // The sixty shots inside the error bound.
  // The sweep above runs undrawn, so one frame is drawn for the picture —
  // after every reading the verdict rests on has been taken.
  await h.paint();
  captureStill(h, "aim");

  assertLength(
    shots,
    SHOTS,
    `rounds collected inside ${BUDGET} s of game time — the saucer fires one ` +
      "every SAUCER_FIRE_INTERVAL it is on the field (specs/saucer.md)",
  );

  for (const [index, shot] of shots.entries()) {
    assertLessThanOrEqual(
      Math.abs(angleDelta(shot.aimed, shot.heading)) / DEG,
      (SAUCER_AIM_ERROR + READING_SLACK) / DEG,
      `how far shot ${index + 1} of ${SHOTS} left from the bearing to the ` +
        `ship, in degrees, against SAUCER_AIM_ERROR ` +
        `(${SAUCER_AIM_ERROR / DEG} degrees) — the offset is drawn uniformly ` +
        "from that range (specs/saucer.md)",
    );
  }
});
