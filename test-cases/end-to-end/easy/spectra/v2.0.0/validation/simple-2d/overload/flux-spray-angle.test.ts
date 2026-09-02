// overload/flux-spray-angle — the spray leaves on a fan of fixed width.
//
// specs/mode.md fixes the shape of the volley an overloaded Flux fires: the bullets are
// "fanned symmetrically about straight down on headings `OVERLOAD_FLUX_SPREAD_ANGLE`
// (`20`) degrees apart, so an odd spread puts its middle shot straight down." This
// point reads the ANGLE BETWEEN SUCCESSIVE BULLETS, which is the figure the
// specification names.
//
// THE READING IS TAKEN OFF THE VELOCITIES, not off the positions. Every bullet of the
// volley leaves the drone at the same instant, so where they are one frame later
// differs only by their heading — but a heading read off two positions is a heading
// measured through whatever the frame's stepping did to them. `vx` and `vy` are
// reported by the snapshot in logical units per second (specs/instrumentation.md), so
// the heading is read directly, in the frame the volley was fired.
//
// HOW A HEADING IS COMPUTED. `atan2(vx, vy)` measures a bullet's departure from
// STRAIGHT DOWN — the axis specs/mode.md fans the volley about — in degrees, so a
// conforming spread of three reads -20, 0 and +20 and the gaps between successive
// headings are the figure asserted. Sorting them first means the check reads the FAN
// rather than the order a build happens to keep its roster in.
//
// THE TOLERANCE IS THE MANIFEST'S: within 15% of `OVERLOAD_FLUX_SPREAD_ANGLE`, so 3
// degrees either side of 20. It is a tolerance on a heading a build computes in
// floating point and not a licence to fan a different width: 15% separates 20 from
// every other round figure a build might have reached for.
//
// WHAT THIS DOES NOT DECIDE. How many bullets there are and what band they carry, which
// is `overload/flux-sprays-count` — read here only as the precondition a fan needs to
// exist at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  fluxHold,
} from "../constants";
import { assertBetween, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/** The stage `startPosed` opens on, which fixes `fluxHold`. */
const STAGE = 1;

/** Where the target Flux stands. As in `overload/flux-sprays-count`. */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/** Where in its band window the Flux is posed. As in `overload/flux-sprays-count`. */
const POSED_CLOCK = fluxHold(STAGE) / 2;

/**
 * How far apart successive headings of the fan may read, in degrees.
 *
 * `OVERLOAD_FLUX_SPREAD_ANGLE` (20) within 15%, which is the tolerance this case's
 * manifest states for the point: 17 to 23 degrees. Wide enough for the floating point a
 * build reaches the heading through and for the harness reading it back a frame later,
 * narrow enough that 15, 22.5, 25 and 30 all fall outside it.
 */
const ANGLE_TOLERANCE = 0.15;
const ANGLE_MIN = OVERLOAD_FLUX_SPREAD_ANGLE * (1 - ANGLE_TOLERANCE);
const ANGLE_MAX = OVERLOAD_FLUX_SPREAD_ANGLE * (1 + ANGLE_TOLERANCE);

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly seven times the 21-unit contact reach a Flux has against one of the player's
 * bullets (`FLUX_HALF` 15 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Seconds the spray is flown on after the reading, purely so the still shows it.
 *
 * The three bullets leave the muzzle together, so a picture taken in the frame they
 * were fired is one blob. Half a second carries them `ENEMY_BULLET_SPEED` (320) times
 * `bulletSpeedScale(1)` (1) — 160 units — down a field whose bottom is 436 units below
 * the drone, which opens the fan to better than a hundred units across. It runs AFTER
 * every reading is taken and cannot reach a verdict.
 */
const TAIL_SECONDS = 0.5;

/** A bullet's departure from straight down, in degrees. */
function heading(bullet: { vx: number; vy: number }): number {
  return (Math.atan2(bullet.vx, bullet.vy) * 180) / Math.PI;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fans successive bullets of the spray OVERLOAD_FLUX_SPREAD_ANGLE degrees apart", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET.x, TARGET.y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
    charge: OVERLOAD_AT - 1,
    // Its firing, because the reaction being read IS a volley.
    fire: true,
  });

  await mismatchShot(h, target, SHOT_BELOW);
  const sprayed = enemyBullets(h.snapshot());
  // Flown on past the reading, so the still shows the fan the headings describe.
  // Nothing after this line can reach an assertion.
  await h.advanceSeconds(TAIL_SECONDS);
  captureStill(h, "fan");
  assertLength(
    sprayed,
    OVERLOAD_FLUX_SPREAD,
    "the bullets a fan is measured across, which `overload/flux-sprays-count` is " +
      "the point that grades (specs/mode.md)",
  );

  const headings = sprayed.map(heading).sort((a, b) => a - b);
  for (let i = 1; i < headings.length; i += 1) {
    assertBetween(
      headings[i] - headings[i - 1],
      ANGLE_MIN,
      ANGLE_MAX,
      `the degrees between bullet ${String(i - 1)} and bullet ${String(i)} of the ` +
        `fan, taken in order of heading: ${String(OVERLOAD_FLUX_SPREAD_ANGLE)} ` +
        `apart within ${String(ANGLE_TOLERANCE * 100)}% (specs/mode.md)`,
    );
  }
});
