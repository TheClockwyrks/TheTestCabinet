// hud/health-bar-scales — the health bar's filled width scales with the health.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Health | A bar
// whose filled width scales with `hp / maxHp`, with both numbers beside it".
// This point decides that scaling at a quarter of the health: a quarter of the
// bar's full width, and no more.
//
// HOW A BAR IS MEASURED WITHOUT KNOWING WHERE IT IS. `specs/ui.md` — "Wick fixes
// no palette, no font, no layout, and no styling for any screen" — so the fill is
// found rather than looked for. Three frames are drawn a `setHp` apart with
// nothing else changed, and the filled width at an `hp` is the widest SOLID block
// of pixels that frame changed against the frame at an all but empty bar. A fill
// is a filled shape, so its block is the fill itself; the numbers beside it are
// strokes with background between them, so the largest block inside a redrawn
// number is one stem a few pixels wide.
//
// Each fill is measured against the EMPTY frame rather than against the full one
// because a build is free to recolour its bar as the health falls: whatever
// colour the fill takes, it differs from the empty track underneath it, so the
// block is the fill's own width either way.
//
// THE FIGURES. `maxHp` is `BASE_MAX_HP` (`100`) while no Tallow is held and
// `BASE_MAX_HP + TALLOW_HP_PER_LEVEL x tallow` when one is
// (specs/instrumentation.md — "Snapshot shape"), so with nothing held `hp` `25`
// is a quarter of the bar and `hp` `BASE_MAX_HP` is all of it, and with Tallow
// at its max level of `5` the maximum is `175` and `hp` `43.75` is a quarter.
// The empty reading is taken at `HP_EMPTY`, which is above `0`, since "A value
// at or below `0` ends the run fallen at the end of the next `playing` tick",
// and a ten-thousandth of the bar, which is far under one pixel of any bar a
// `1280 x 720` stage carries.
//
// WHY THE QUARTER IS READ TWICE, AT TWO MAXIMUMS. The share is measured against
// the build's OWN full fill, so a bar dividing by a CONSTANT rather than by
// `maxHp` reads a clean quarter as long as the maximum is that constant, and a
// night holding nothing leaves `maxHp` at `BASE_MAX_HP` for every reading. So
// the quarter is read a second time with Tallow at `5` held: a bar on
// `hp / maxHp` reads a quarter of `175` as a quarter, and a bar on `hp / 100`
// reads it as `0.4375`, seven times the tolerance away. The denominator the
// specification names is what the pair of readings pins.
//
// THE TOLERANCE. `FILL_TOL`, five hundredths of the full width. The
// specification fixes the ratio and leaves the bar's size, its border, and its
// rounding to the build, so the allowance covers a fill rounded to whole pixels
// inside a border drawn over its own edge: five hundredths of any legible bar is
// several pixels. It sits far below every deviation it has to catch — a bar that
// does not scale reads `1`, one that scales by area reads `0.5`, and one drawn in
// thirds reads `0.33`.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_MAX_HP, PASSIVES, maxHpOf } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
  type PixelRect,
} from "../harness";
import { differenceMask, widestSolidRect, type Rect } from "./regions";
import { drawnPixels, poseNight } from "./stage";

/** The health the quarter-full reading is taken at: a quarter of `BASE_MAX_HP`. */
const HP_QUARTER = 25;

/** The share of the bar a quarter of the maximum fills. */
const QUARTER = HP_QUARTER / BASE_MAX_HP;

/** Tallow's max level, `5`, which is the second reading's maximum. */
const TALLOW_LEVEL = PASSIVES.tallow.maxLevel;

/** `BASE_MAX_HP + TALLOW_HP_PER_LEVEL x 5`: `175`. */
const RAISED_MAX_HP = maxHpOf({ tallow: TALLOW_LEVEL });

/** A quarter of the raised maximum: `43.75`. */
const HP_QUARTER_RAISED = RAISED_MAX_HP * QUARTER;

/** An `hp` above `0`, so the run goes on, and under a pixel of any bar. */
const HP_EMPTY = 0.01;

/** How far the measured share may sit from the share the specification fixes. */
const FILL_TOL = 0.05;

/**
 * How wide the full fill must be for the reading to have found a bar at all, in
 * pixels. A bar a player reads the health off at a glance on a `1280` wide stage
 * is wider than this; a build drawing no bar leaves a block of nothing.
 */
const BAR_MIN = 16;

/**
 * How tall the fill must be for the reading to have found a bar rather than a
 * band of something else, in pixels. A bar a player reads at a glance on a
 * `1280 x 720` stage is several units tall; four is under any legible bar and
 * above the single row a redrawn line of text can leave behind.
 */
const BAR_MIN_H = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fills a quarter of the health bar at a quarter of the health", async () => {
  await poseNight(h);

  await h.debug.setHp(HP_EMPTY);
  const empty = await drawnPixels(h);
  await h.debug.setHp(BASE_MAX_HP);
  const full = await drawnPixels(h);
  await h.debug.setHp(HP_QUARTER);
  const quarter = await drawnPixels(h);
  await captureStill(h, "bar");

  const fill = (posed: PixelRect): Rect =>
    widestSolidRect(differenceMask(empty, posed));
  const bar = fill(full);
  const wide = bar.w;
  assertGreaterThan(
    wide,
    BAR_MIN,
    `the width of the health bar's fill at hp ${BASE_MAX_HP} of ${BASE_MAX_HP}, in pixels`,
  );
  assertGreaterThanOrEqual(
    bar.h,
    BAR_MIN_H,
    `the height of the health bar's fill at hp ${BASE_MAX_HP} of ${BASE_MAX_HP}, in pixels`,
  );
  assertNear(
    fill(quarter).w / wide,
    QUARTER,
    FILL_TOL,
    `the share of the health bar filled at hp ${HP_QUARTER} of ${BASE_MAX_HP} (its full fill is ${wide} pixels wide)`,
  );

  // The same quarter, against a maximum a Tallow raised.
  await holdPassive(h, "tallow", TALLOW_LEVEL);
  await h.debug.setHp(HP_EMPTY);
  const raisedEmpty = await drawnPixels(h);
  await h.debug.setHp(RAISED_MAX_HP);
  const raisedFull = await drawnPixels(h);
  await h.debug.setHp(HP_QUARTER_RAISED);
  const raisedQuarter = await drawnPixels(h);

  assertEqual(
    (await h.snapshot()).run.maxHp,
    RAISED_MAX_HP,
    `maxHp with Tallow at ${TALLOW_LEVEL}, which is the bar's full width in health`,
  );

  const raisedFillOf = (posed: PixelRect): Rect =>
    widestSolidRect(differenceMask(raisedEmpty, posed));
  const raisedBar = raisedFillOf(raisedFull);
  assertGreaterThan(
    raisedBar.w,
    BAR_MIN,
    `the width of the health bar's fill at hp ${RAISED_MAX_HP} of ${RAISED_MAX_HP}, in pixels`,
  );
  assertGreaterThanOrEqual(
    raisedBar.h,
    BAR_MIN_H,
    `the height of the health bar's fill at hp ${RAISED_MAX_HP} of ${RAISED_MAX_HP}, in pixels`,
  );
  assertNear(
    raisedFillOf(raisedQuarter).w / raisedBar.w,
    QUARTER,
    FILL_TOL,
    `the share of the health bar filled at hp ${HP_QUARTER_RAISED} of ${RAISED_MAX_HP} (its full fill is ${raisedBar.w} pixels wide)`,
  );
});
