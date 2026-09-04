// drones/prism-shell-survives-mismatch — the shell holds against the other band.
//
// specs/drones.md, Its two layers: "The shell hides the core until the shell is
// gone, so exactly one layer is exposed at a time", and "Each layer falls to a
// single matching shot, and a shot of the other band breaks neither." A shot of
// the CORE's band therefore does nothing at all while the shell stands — the core
// is not exposed, so its band is not the one that decides. Without this rule a
// Prism would fall to any two shots rather than to the ordered pair the kind is
// built around.
//
// WHAT IS DRIVEN. `drones/prism-shell-breaks-to-shell-band`'s scenario with one
// value changed: the same lone Prism at the same place with the same magenta
// stored band and its shell intact, and the opposite band on the bullet. A build
// that breaks the shell on every contact fails here and passes there; a build
// that breaks it on none fails there and passes here.
//
// THE READING. The Prism is still on the field and its shell still stands. Which
// band a shelled Prism reads as is `bands`', and what a mismatched shot does to
// the DRONE beyond sparing it belongs to the mode the build ships
// (specs/mode.md), which the variants grade in their own categories. Nothing is
// destroyed here, so no bystander is needed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
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

/** Where the target Prism stands. As in `drones/prism-shell-breaks-to-shell-band`. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * Nearly six times the 34-unit contact reach a shelled Prism has against one of
 * the player's bullets (`PRISM_HALF` 28 + `PLAYER_BULLET_HALF` 6), so the bullet
 * starts well clear and climbs into the drone.
 */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 22 frames and, consumed or not, is
 * well past it by frame 45 — so the reading is taken after the contact has had
 * every chance to resolve.
 */
const SHOT_FRAMES = 45;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves a Prism's shell standing against a shot of the core's band", async () => {
  await startPosed(harness, { stage: STAGE });
  const prism = await poseDrone(harness, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    shell: true,
  });

  const shot = await shootDrone(harness, prism, CORE_BAND, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "intact");

  const after = requireDrone(
    shot.snapshot,
    prism,
    `the Prism a ${CORE_BAND} shot must not destroy through its shell (specs/drones.md)`,
  );
  assertEqual(
    after.shellAlive,
    true,
    `the shell a ${CORE_BAND} shot must not break on a ${SHELL_BAND}-shelled Prism (specs/drones.md)`,
  );
});
