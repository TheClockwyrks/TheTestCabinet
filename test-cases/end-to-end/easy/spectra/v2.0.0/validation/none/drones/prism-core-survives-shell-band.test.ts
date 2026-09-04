// drones/prism-core-survives-shell-band — the core holds against the shell's band.
//
// specs/drones.md, Its two layers: with the shell broken the exposed layer is the
// core, "Broken by | A shot whose effective band matches the core's", and "a shot
// of the other band breaks neither". The shell's band is now the WRONG band, so a
// player who breaks the shell and keeps firing the same band gets nowhere: the
// Prism costs one shot of each, in that order. Without this rule the second beat
// of the kind would be free.
//
// WHAT IS DRIVEN. One Prism alone in mid-field, every faculty off, its stored band
// posed MAGENTA and its SHELL POSED GONE through `setDroneShell(id, false)`, which
// is the state specs/instrumentation.md gives that operation. That reaches the
// scenario directly: nothing about breaking the shell is replayed here, because
// breaking it is `drones/prism-shell-breaks-to-shell-band`'s requirement, and a
// build that cannot break a shell must fail that point rather than this one. The
// shot then carries the shell's own band — the stored band — and must do nothing.
//
// MAGENTA IS THE DISTINGUISHING VALUE. `addDrone` creates a drone holding cyan, so
// a build that matches an exposed core against a default, or against the stored
// band without taking the opposite once for the broken shell (specs/bands.md's
// effective-band rule), destroys the Prism here and fails.
//
// The other half is `drones/prism-core-destroys`, which fires the core's own band
// into this same posed Prism, so a build that destroys on every contact and one
// that destroys on none grade differently. Nothing is destroyed here, so no
// bystander is needed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at. */
const STAGE = 1;

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/** Where the target Prism stands. Mid-field, clear of both HUD strips and the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * With only its core left a Prism's contact reach against one of the player's
 * bullets is `PRISM_CORE_HALF` (13) plus `PLAYER_BULLET_HALF` (6) = 19 units of
 * centre separation, so 140 starts the bullet more than seven times clear of it.
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

it("leaves an exposed core standing against a shot of the shell's band", async () => {
  await startPosed(harness, { stage: STAGE });
  const prism = await poseDrone(harness, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    // The shell is already gone: the core is the exposed layer, which is the
    // scenario this point is about.
    shell: false,
  });

  const shot = await shootDrone(harness, prism, SHELL_BAND, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "survived");

  assertDefined(
    droneById(shot.snapshot, prism),
    `the exposed core a ${SHELL_BAND} shot must not destroy (specs/drones.md)`,
  );
});
