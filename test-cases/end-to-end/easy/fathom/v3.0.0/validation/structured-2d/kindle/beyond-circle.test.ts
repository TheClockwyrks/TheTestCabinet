// kindle/beyond-circle — the amber lights are clipped to the circle.
//
// specs/sensing.md, in the Kindle dive: the bonus drifter and the Lanternjaw's
// bulb "are clipped to the vision circle below: an amber light inside the circle
// is drawn whatever the fog beneath it says and wherever the light pocket fails
// to reach, and an amber light beyond the circle is painted over with the flat
// fog like the ground around it."
//
// This is the one rule the Standard dive states the other way round — there the
// same lights are "drawn at all times and at any distance" — so a build that
// carried the Standard rule into this dive draws a mote out in the dark and
// reports the drifter in `drifters` exactly as the specification asks. Only the
// canvas separates the two.
//
// BOTH HALVES ARE REQUIRED. "Nothing is drawn out there" is passed by a build
// that never draws an amber light at all, so the same drifter is then taken
// inside the circle and must draw its mote. The near station stands past the
// LIGHT pocket and inside the circle, which is the band the clipping rule is
// actually about: what draws the mote there is the circle, not the light.
//
// THE MOTE IS SEARCHED FOR RATHER THAN SAMPLED AT A POINT, because where on a
// body a build draws the light is its own art. The review item fixes the reach:
// "the pixels within 12 units of its reported center". The far reading takes the
// BRIGHTEST of them, whatever its hue, so a mote drawn in any color is caught;
// the near reading takes the brightest RED-LEANING one, which is the item's own
// hue test.
//
// THE DRIFTER IS HELD STILL by `setDrifterMind(0, false)`, which holds that
// drifter exactly where it stands and leaves everything else in the game running
// (specs/instrumentation.md), so it is read where the snapshot says it is and the
// forager is what moves between the two stations. It is the only creature on the
// board.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
  assertNotNull,
  fail,
} from "../assert";
import { poseMaze } from "../fixtures";
import {
  brightestNear,
  brightestWarmNear,
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  MOTE_SEARCH,
  type NearSample,
  sampleColorAtTile,
  startPlaying,
  visibilityAt,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { DRAWN_FLOOR, MASKED_MATCH, windowRadius } from "./circle";

/**
 * The board: one long corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `A` is the away station, `AWAY_TILES` from the drifter's berth `D`. `N` is the
 * near station, `NEAR_TILES` from it. `S` is the fog reference.
 */
const ART = [
  "A" + ".".repeat(10) + "N" + ".".repeat(4) + "D" + " ".repeat(8) + "S..",
] as const;

/** How far the away station stands from the drifter, in tiles. */
const AWAY_TILES = 16; // 512 units: past R at G = 1 (320)

/** How far the near station stands from it, in tiles. */
const NEAR_TILES = 5; // 160 units: past V (96), inside R (192)

/** What a light the circle has clipped away may read as, out of `441`. */
const CLIPPED_MAX = MASKED_MATCH;

/**
 * The sensing floor a light inside the circle owes against the fog around it, as
 * an RGB distance out of `441`.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 */
const DRAWN_MIN = DRAWN_FLOOR;

/** Ticks run at each station, so the build has drawn the posed board. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The amber lights are clipped to the circle", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const away = board.mark("A");
  const near = board.mark("N");
  const berth = board.mark("D");
  const unlit = board.mark("S");

  await parkForager(h, away);
  h.debug.spawnDrifter(berth.tx, berth.ty);
  h.debug.setDrifterMind(0, false);
  const guard = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const beyond = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture of the
  // light that should have been clipped away.
  captureStill(h, "clipped");

  requireSceneHeld(beyond, guard);

  assertEqual(
    beyond.drifters.length,
    1,
    "the drifters the maze holds after one was spawned across the board",
  );
  const far = beyond.drifters[0];
  const farGap = Math.hypot(far.x - beyond.forager.x, far.y - beyond.forager.y);
  assertGreaterThan(
    farGap,
    windowRadius(beyond),
    `the logical units between the forager and the drifter ${AWAY_TILES} tiles ` +
      "off, against the vision circle R it must stand beyond",
  );
  assertEqual(
    visibilityAt(beyond, berth),
    "u",
    `the drifter's tile at (${berth.tx}, ${berth.ty}), which nothing has revealed`,
  );

  const fog = sampleColorAtTile(h, beyond, unlit);
  assertLessThanOrEqual(
    colorDistance(brightestNear(h, far.x, far.y).color, fog),
    CLIPPED_MAX,
    `the RGB distance out of 441 between the brightest pixel within ` +
      `${MOTE_SEARCH} units of the drifter's reported center and the flat fog ` +
      "around it: an amber light beyond the circle is painted over with it",
  );

  // The same drifter, taken inside the circle by moving the forager to the near
  // station — still outside the light pocket, so the circle is what draws it.
  await parkForager(h, near);
  await h.advance(SETTLE_TICKS);
  const inside = h.snapshot();
  const close = inside.drifters[0];
  const nearGap = Math.hypot(
    close.x - inside.forager.x,
    close.y - inside.forager.y,
  );
  const radius = windowRadius(inside);
  if (nearGap >= radius) {
    // The band this half lives in has to exist on this build.
    fail(
      `the vision circle to reach past the ${NEAR_TILES} tiles the near station ` +
        "stands from the drifter, which specs/sensing.md's R at G = 0 does",
      `R was reported as ${radius.toFixed(1)} with the drifter ` +
        `${nearGap.toFixed(1)} units off`,
    );
  }
  assertLessThan(
    nearGap,
    radius,
    "the logical units between the forager and the drifter at the near station, " +
      "against the vision circle R it stands inside",
  );
  assertGreaterThan(
    nearGap,
    inside.visionRadius,
    "the same distance against the light pocket V it stands outside, so the " +
      "circle rather than the light is what draws the mote",
  );

  const mote = brightestWarmNear(h, close.x, close.y);
  assertNotNull(
    mote,
    `a red-leaning pixel within ${MOTE_SEARCH} units of the drifter's reported ` +
      "center once it lies inside the vision circle",
  );
  assertGreaterThan(
    colorDistance((mote as NearSample).color, fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the brightest warm pixel at the drifter " +
      "inside the circle and the flat fog around it",
  );
});
