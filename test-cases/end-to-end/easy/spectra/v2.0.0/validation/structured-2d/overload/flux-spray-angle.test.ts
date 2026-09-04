// overload/flux-spray-angle — the spray leaves on a fan of fixed width.
//
// specs/mode.md fixes the shape of the volley an overloaded Flux fires: the bullets
// are "fanned symmetrically about straight down on headings
// `OVERLOAD_FLUX_SPREAD_ANGLE` (`20`) degrees apart, so an odd spread puts its
// middle shot straight down." This point reads the ANGLE BETWEEN SUCCESSIVE
// BULLETS, which is the figure the specification names.
//
// THE READING IS TAKEN OFF THE VELOCITIES, not off the positions. Every bullet of
// the volley leaves the drone at the same instant, so where they are one frame
// later differs only by their heading — but a heading read off two positions is a
// heading measured through whatever the frame's stepping did to them. `vx` and `vy`
// are reported by the snapshot in logical units per second
// (specs/instrumentation.md), so the heading is read directly, in the frame the
// volley was fired.
//
// HOW A HEADING IS COMPUTED. `atan2(vx, vy)` measures a bullet's departure from
// STRAIGHT DOWN — the axis specs/mode.md fans the volley about — in degrees, so a
// conforming spread of three reads -20, 0 and +20 and the gaps between successive
// headings are the figure asserted. Sorting them first means the check reads the
// FAN rather than the order a build happens to keep its roster in.
//
// THE TOLERANCE IS THE MANIFEST'S: within 15% of `OVERLOAD_FLUX_SPREAD_ANGLE`, so
// 3 degrees either side of 20. It is a tolerance on a heading a build computes in
// floating point and not a licence to fan a different width: 15% separates 20 from
// every other round figure a build might have reached for.
//
// WHAT THIS DOES NOT DECIDE. How many bullets there are and what band they carry,
// which is `overload/flux-sprays-count` — read here only as the precondition a fan
// needs to exist at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  FLUX_HALF,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  PLAYER_BULLET_HALF,
  fluxHold,
} from "../constants";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge } from "./charge";

/** The stage `startPosed` poses, which is what fixes `fluxHold`. */
const STAGE = 1;

/** Where the target Flux stands. As in `overload/flux-sprays-count`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/** Where in its band window the Flux is posed. As in `overload/flux-sprays-count`. */
const POSED_CLOCK = fluxHold(STAGE) / 2;

/**
 * How far apart successive headings of the fan may read, in degrees.
 *
 * `OVERLOAD_FLUX_SPREAD_ANGLE` (`20`) within 15%, which is the tolerance this
 * case's manifest states for the point: 17 to 23 degrees. Wide enough for the
 * floating point a build reaches the heading through, narrow enough that 15, 22.5,
 * 25 and 30 all fall outside it.
 */
const ANGLE_TOLERANCE = 0.15;
const ANGLE_MIN = OVERLOAD_FLUX_SPREAD_ANGLE * (1 - ANGLE_TOLERANCE);
const ANGLE_MAX = OVERLOAD_FLUX_SPREAD_ANGLE * (1 + ANGLE_TOLERANCE);

/** The centre separation a contact needs: `FLUX_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = FLUX_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: six times the contact reach. */
const SHOT_BELOW = 6 * TOUCHING;

/** Frames the flight is allowed. As in `overload/flux-sprays-count`. */
const SHOT_FRAMES = 30;

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
  const target = poseDrone(h, "flux", TARGET_X, TARGET_Y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
    // Its firing, because the reaction being read IS a volley.
    fire: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "fan");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  const sprayed = enemyBullets(shot.snapshot);
  assertLength(
    sprayed,
    OVERLOAD_FLUX_SPREAD,
    "the bullets a fan is measured across, which `overload/flux-sprays-count` " +
      "is the point that grades (specs/mode.md)",
  );

  const headings = sprayed.map(heading).sort((a, b) => a - b);
  for (let i = 1; i < headings.length; i += 1) {
    assertBetween(
      headings[i] - headings[i - 1],
      ANGLE_MIN,
      ANGLE_MAX,
      `the degrees between bullet ${String(i - 1)} and bullet ${String(i)} of ` +
        "the fan, taken in order of heading: " +
        `${String(OVERLOAD_FLUX_SPREAD_ANGLE)} apart within ` +
        `${String(ANGLE_TOLERANCE * 100)}% (specs/mode.md)`,
    );
  }
});
