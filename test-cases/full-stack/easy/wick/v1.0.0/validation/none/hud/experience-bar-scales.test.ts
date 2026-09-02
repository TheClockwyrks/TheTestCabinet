// hud/experience-bar-scales — the experience bar's filled width scales with the
// experience.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Experience | A
// bar whose filled width scales with `xp / xpToNext`, labeled with `LEVEL_LABEL`
// (`LEVEL`) and the current level". This point decides the scaling; the label is
// `hud/level-label-drawn`.
//
// THE FIGURES. `xpToNext` is `XP_BASE` (`5`) `+ XP_STEP` (`10`) `x (level - 1)`
// (specs/instrumentation.md — "Snapshot shape"), so the level posed at `2` puts
// the next level `15` experience away and the level posed at `3` puts it `25`
// away, and `12` of `15` is four fifths of the bar. `setXp` is the whole of the
// pose: "No level-up is derived from it: a level-up comes from the next gain",
// so a bar posed full stays on the screen it was posed on.
//
// WHY THE FULL BAR IS READ AT TWO LEVELS. The share is measured against the
// build's OWN fill at `xp = xpToNext`, so any wrong DENOMINATOR cancels out of
// the four-fifths reading and only a bar that scales non-linearly fails it. A
// full bar is the whole track at every level, so the two full fills must be the
// same width: a bar reading `xpToNext` for the level after the current one
// fills fifteen twenty-fifths of the track at level 2 and twenty-five
// thirty-fifths at level 3, more than twice the tolerance apart. The `xpToNext`
// the specification names is what the pair of readings pins.
//
// HOW A BAR IS MEASURED WITHOUT KNOWING WHERE IT IS. As in
// `hud/health-bar-scales`: `specs/ui.md` fixes no palette, no layout, and no
// styling, so three frames are drawn a `setXp` apart with nothing else changed,
// and the filled width at an `xp` is the widest SOLID block of pixels that frame
// changed against the frame at an empty bar. A fill is a filled shape and a
// redrawn figure is strokes with background between them, so the block is the
// fill. Measuring against the empty frame rather than the full one leaves a build
// free to recolour the fill as it grows.
//
// THE TOLERANCE. `FILL_TOL`, five hundredths of the full width, for the reason
// `hud/health-bar-scales` states: the specification fixes the share and leaves
// the bar's size, its border, and its rounding to the build, and five hundredths
// of any legible bar is several pixels while every deviation this has to catch —
// a bar that does not scale, one that scales by area, one drawn in thirds — is
// tenths away.

import { afterEach, beforeEach, it } from "vitest";
import { xpToNext } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
} from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type PixelRect,
} from "../harness";
import { differenceMask, widestSolidRect, type Rect } from "./regions";
import { drawnPixels, poseNight } from "./stage";

/** The level posed, which fixes what the next level costs. */
const LEVEL = 2;

/** The second level the full bar is read at, whose next level costs more. */
const LEVEL_B = 3;

/** `XP_BASE + XP_STEP x (LEVEL - 1)`: `15`. */
const TO_NEXT = xpToNext(LEVEL);

/** `XP_BASE + XP_STEP x (LEVEL_B - 1)`: `25`. */
const TO_NEXT_B = xpToNext(LEVEL_B);

/** The experience the part-full reading is taken at: four fifths of the bar. */
const XP_MOST = 12;

/** The share of the bar `XP_MOST` of `TO_NEXT` fills. */
const MOST = XP_MOST / TO_NEXT;

/** How far the measured share may sit from the share the specification fixes. */
const FILL_TOL = 0.05;

/** How wide the full fill must be for the reading to have found a bar at all. */
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

it("fills four fifths of the experience bar at four fifths of a level", async () => {
  await poseNight(h);
  await h.debug.setLevel(LEVEL);

  await h.debug.setXp(0);
  const empty = await drawnPixels(h);
  await h.debug.setXp(TO_NEXT);
  const full = await drawnPixels(h);
  await h.debug.setXp(XP_MOST);
  const most = await drawnPixels(h);
  await captureStill(h, "bar");

  const posed = await h.snapshot();
  assertEqual(
    posed.run.xpToNext,
    TO_NEXT,
    `xpToNext at level ${LEVEL}, which is the bar's full width in experience`,
  );

  const fill = (drawn: PixelRect): Rect =>
    widestSolidRect(differenceMask(empty, drawn));
  const bar = fill(full);
  const wide = bar.w;
  assertGreaterThan(
    wide,
    BAR_MIN,
    `the width of the experience bar's fill at ${TO_NEXT} of ${TO_NEXT}, in pixels`,
  );
  assertGreaterThanOrEqual(
    bar.h,
    BAR_MIN_H,
    `the height of the experience bar's fill at ${TO_NEXT} of ${TO_NEXT}, in pixels`,
  );
  assertNear(
    fill(most).w / wide,
    MOST,
    FILL_TOL,
    `the share of the experience bar filled at xp ${XP_MOST} of ${TO_NEXT} (its full fill is ${wide} pixels wide)`,
  );

  // The same full bar, one level on, where the next level costs more.
  await h.debug.setLevel(LEVEL_B);
  await h.debug.setXp(0);
  const emptyB = await drawnPixels(h);
  await h.debug.setXp(TO_NEXT_B);
  const fullB = await drawnPixels(h);

  const posedB = await h.snapshot();
  assertEqual(
    posedB.run.xpToNext,
    TO_NEXT_B,
    `xpToNext at level ${LEVEL_B}, which is the bar's full width in experience`,
  );

  const wideB = widestSolidRect(differenceMask(emptyB, fullB)).w;
  assertNear(
    wideB / wide,
    1,
    FILL_TOL,
    `the width of the experience bar's full fill at level ${LEVEL_B} (${wideB} pixels) against its width at level ${LEVEL} (${wide} pixels)`,
  );
});
