// drones/prism-core-destroys — the core falls to its own band.
//
// specs/drones.md, Its two layers: with the shell broken the exposed layer is the
// core, "Broken by | A shot whose effective band matches the core's", and
// "destroying the exposed core destroys the Prism". This is the second beat of the
// kind and the only way a Prism is ever taken off the field by the cannon: a
// player who has broken the shell and flipped lands this shot and the drone is
// gone.
//
// WHAT IS DRIVEN. `drones/prism-core-survives-shell-band`'s scenario with one
// value changed: the same lone Prism at the same place with the same magenta
// stored band and its SHELL POSED GONE, and the core's band — the opposite of the
// stored one, by specs/drones.md — on the bullet. A build that destroys an exposed
// core on every contact fails there and passes here; one that destroys it on none
// fails here and passes there.
//
// The shell is posed away rather than shot away, so a build that cannot break a
// shell fails `drones/prism-shell-breaks-to-shell-band` and is graded here on the
// core rule alone.
//
// One bystander stands out of the way, because this scenario destroys the drone it
// poses and specs/stages.md clears a stage in the moment the last drone of its wave
// is destroyed; the bystander leaves the wave a drone under either reading of "its
// wave", so the field is still live when the reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseBystander,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at. */
const STAGE = 1;

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/** The core's band, "always the opposite" of the shell's (specs/drones.md). */
const CORE_BAND = opposite(SHELL_BAND);

/** Where the target Prism stands. As in `drones/prism-core-survives-shell-band`. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * More than seven times the 19-unit contact reach a cored Prism has against one of
 * the player's bullets (`PRISM_CORE_HALF` 13 + `PLAYER_BULLET_HALF` 6), so the
 * bullet starts well clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the 19-unit reach inside 16 frames, and thirty leaves
 * fourteen for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("destroys a Prism with a shot of its exposed core's band", async () => {
  await startPosed(harness, { stage: STAGE });
  await poseBystander(harness);
  const prism = await poseDrone(harness, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    // The shell is already gone: the core is the exposed layer, which is the
    // scenario this point is about.
    shell: false,
  });

  const shot = await shootDrone(harness, prism, CORE_BAND, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "destroyed");

  assertEqual(shot.hit, true, "the core shot resolving inside its flight");
  assertUndefined(
    droneById(shot.snapshot, prism),
    `the Prism a ${CORE_BAND} shot destroys once its core is exposed (specs/drones.md)`,
  );
});
