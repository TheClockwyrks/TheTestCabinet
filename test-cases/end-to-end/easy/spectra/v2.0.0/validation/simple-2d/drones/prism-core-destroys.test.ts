// drones/prism-core-destroys — the core falls to its own band.
//
// specs/drones.md, Its two layers: with the shell broken the exposed layer is the
// core, "Broken by | A shot whose effective band matches the core's", and
// "destroying the exposed core destroys the Prism". This is the second beat of the
// kind and the only way a Prism is ever taken off the field by the cannon: a player
// who has broken the shell and flipped lands this shot and the drone is gone.
//
// WHAT IS DRIVEN. `drones/prism-core-survives-shell-band`'s scenario with one value
// changed: the same lone Prism at the same place with the same magenta stored band
// and its SHELL POSED GONE, and the core's band — the opposite of the stored one,
// by specs/drones.md — on the bullet. A build that destroys an exposed core on
// every contact fails there and passes here; one that destroys it on none fails
// here and passes there.
//
// The shell is posed away rather than shot away, so a build that cannot break a
// shell fails `drones/prism-shell-breaks-to-shell-band` and is graded here on the
// core rule alone.
//
// THE FRAME THAT KILLS ALSO CLEARS THE STAGE, AND THAT COSTS NOTHING. The world
// holds exactly the drone the requirement concerns, so the kill's own frame is
// necessarily the frame the live wave holds none — which specs/stages.md makes a
// clear. Nothing here reads the screen or the stage; the reading is whether the
// roster still holds the drone, and the clear can only follow the destruction it is
// asserting. So no bystander is parked on the field to hold the wave open.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X } from "../constants";
import { assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Band,
  type Harness,
} from "../harness";

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/** The other of the two bands specs/bands.md fixes; there is no third. */
function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** The core's band, "always the opposite" of the shell's (specs/drones.md). */
const CORE_BAND = opposite(SHELL_BAND);

/** Where the target Prism stands. As in `drones/prism-core-survives-shell-band`. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * Geometry, not a tolerance: more than seven times the `19`-unit contact reach a
 * cored Prism has against one of the player's bullets (`PRISM_CORE_HALF` `13` +
 * `PLAYER_BULLET_HALF` `6`), so the bullet starts well clear and climbs into the
 * drone over every frame `fireAt` derives from `PLAYER_BULLET_SPEED`.
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a Prism with a shot of its exposed core's band", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const prism = poseDrone(h, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    // The shell is already gone: the core is the exposed layer, which is the
    // scenario this point is about.
    shell: false,
  });

  await fireAt(h, AT.x, AT.y, CORE_BAND, SHOT_BELOW);
  captureStill(h, "destroyed");

  assertNull(
    findDrone(h.snapshot(), prism),
    `the Prism a ${CORE_BAND} shot destroys once its core is exposed ` +
      "(specs/drones.md)",
  );
});
