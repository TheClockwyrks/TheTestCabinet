// drones/prism-shell-survives-mismatch — the shell holds against the other band.
//
// specs/drones.md, Its two layers: "The shell hides the core until the shell is
// gone, so exactly one layer is exposed at a time", and "Each layer falls to a
// single matching shot, and a shot of the other band breaks neither." A shot of the
// CORE's band therefore does nothing at all while the shell stands — the core is
// not exposed, so its band is not the one that decides. Without this rule a Prism
// would fall to any two shots rather than to the ordered pair the kind is built
// around.
//
// WHAT IS DRIVEN. `drones/prism-shell-breaks-to-shell-band`'s scenario with one
// value changed: the same lone Prism at the same place with the same magenta stored
// band and its shell intact, and the OPPOSITE band on the bullet. A build that
// breaks the shell on every contact fails here and passes there; a build that
// breaks it on none fails there and passes here.
//
// THE READING. The Prism is still on the field and its shell still stands. Which
// band a shelled Prism reads AS is `bands`', and what a mismatched shot does to the
// DRONE beyond sparing it belongs to the mode the build ships (specs/mode.md),
// which the variants grade in their own categories. Nothing is destroyed here, so
// nothing clears the stage.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  fireAt,
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

/** Where the target Prism stands. As in `drones/prism-shell-breaks-to-shell-band`. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * Geometry, not a tolerance: nearly six times the `34`-unit contact reach a shelled
 * Prism has against one of the player's bullets (`PRISM_HALF` `28` +
 * `PLAYER_BULLET_HALF` `6`), so the bullet starts well clear and climbs into the
 * drone over every frame `fireAt` derives from `PLAYER_BULLET_SPEED`.
 */
const SHOT_BELOW = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a Prism's shell standing against a shot of the core's band", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const prism = poseDrone(h, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    shell: true,
  });

  await fireAt(h, AT.x, AT.y, CORE_BAND, SHOT_BELOW);
  captureStill(h, "intact");

  // `droneOf` fails the point if the roster no longer holds it, which is exactly
  // the build a mismatched shot destroyed through the shell.
  const after = droneOf(h.snapshot(), prism);
  assertEqual(
    after.shellAlive,
    true,
    `the shell a ${CORE_BAND} shot must not break on a ${SHELL_BAND}-shelled ` +
      "Prism (specs/drones.md)",
  );
});
