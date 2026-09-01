// hud/experience-bar-scales — the experience bar's filled width scales with `xp`.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Experience | A
// bar whose filled width scales with `xp / xpToNext`, labeled with `LEVEL_LABEL`
// (`LEVEL`) and the current level".
//
// THE FIGURE, AND WHERE IT COMES FROM. `specs/progression.md` gives the curve
// `xpToNext(level) = XP_BASE + XP_STEP × (level − 1)` and tables it: level `2`
// needs `15`. So a run posed at level `2` with `12` experience has filled four
// fifths of the bar, and one at `15` has filled all of it.
//
// HOW A FILL IS MEASURED WITHOUT KNOWING WHERE THE BAR IS. `specs/ui.md` fixes
// no palette, no layout, and no styling, so nothing here may look for a colour
// or a coordinate. What a fill IS, to a script, is the region that changed when
// the experience changed and nothing else did: the band between two fills of one
// bar is a filled shape running the height of the bar, so `hud/regions.ts` takes
// the tallest unbroken block of changed pixels for the bar's rows and reads the
// band's width across them, passing over the rules a build may have drawn down
// its bar. The bar is EMPTY at `xp` `0`, so each band measured against that
// frame is a fill read from the bar's own start:
//
//   band(0 → 12) is the bar filled four fifths
//   band(0 → 15) is the bar filled whole
//
// and nothing else in these three frames differs at all — the level label, the
// health readout, the clock and the kill count are the same in each, since only
// `xp` was posed.
//
// THE TOLERANCE. `HUD_BAR_RATIO_TOL` (`0.1`) around the four fifths the spec
// figure gives. A bar drawn with a border, an inset, or a rounded end loses a
// pixel or two at each end of each band, far under the tolerance at any width a
// legible bar is drawn at; a bar that ignores `xp`, that fills to a fixed width,
// or that snaps between empty and full is nowhere near it.
//
// WHY EACH FRAME GETS A HARNESS OF ITS OWN. The three frames then sit at the
// same tick, the same simulated time and the same run state, and differ in the
// one figure this point is about.

import { afterEach, it } from "vitest";
import { HUD_BAR_RATIO_TOL, TICK_HZ, xpToNext } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
} from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";
import { changedBand, differenceMask, frame } from "./regions";

/** The level posed, whose `xpToNext` is the `15` the point is stated in. */
const LEVEL = 2;

/** The three experiences read, out of `xpToNext(2)` (`15`). */
const EMPTY = 0;
const PART = 12;
const WHOLE = xpToNext(LEVEL);

/** The share of the bar the spec figure gives `PART` of `WHOLE`. */
const PART_SHARE = PART / WHOLE;

/** Ticks run after the experience is posed, so an eased bar has arrived. */
const SETTLE_TICKS = TICK_HZ;

/** The fewest rows a band must be thick to be a bar rather than an artifact. */
const MIN_BAR_ROWS = 3;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/** An isolated run at level 2 posed at `xp`, settled, and the frame it left. */
async function frameAt(xp: number): Promise<{ h: Harness; pixels: PixelRect }> {
  const h = await createHarness();
  harnesses.push(h);
  const posed = isolate(h, { level: LEVEL });
  assertEqual(
    posed.run.xpToNext,
    WHOLE,
    "the experience the posed level needs",
  );
  h.debug.setXp(xp);
  const settled = await advanceTicks(h, SETTLE_TICKS);
  assertEqual(settled.run.xp, xp, `the experience the run holds at ${xp}`);
  assertEqual(settled.run.level, LEVEL, `the level the run holds at ${xp}`);
  assertEqual(settled.screen, "playing", `the screen at ${xp} experience`);
  return { h, pixels: frame(h) };
}

it("fills the experience bar in proportion to xp", async () => {
  const empty = await frameAt(EMPTY);
  const part = await frameAt(PART);
  const whole = await frameAt(WHOLE);
  captureStill(part.h, "bar");

  assertGreaterThan(
    pixelsDiffering(empty.pixels, part.pixels),
    0,
    `pixels the frame at ${PART} of ${WHOLE} experience differs from the frame at ${EMPTY} in`,
  );

  const filled = changedBand(differenceMask(empty.pixels, whole.pixels));
  const partly = changedBand(differenceMask(empty.pixels, part.pixels));

  assertGreaterThan(filled.w, 0, "the width of the bar the experience filled");
  assertGreaterThanOrEqual(filled.h, MIN_BAR_ROWS, "the height of that bar");
  assertGreaterThan(
    partly.w,
    0,
    `the width the bar filled at ${PART} experience`,
  );

  assertNear(
    partly.w / filled.w,
    PART_SHARE,
    HUD_BAR_RATIO_TOL,
    `the share of the bar filled at ${PART} of ${WHOLE} experience (${partly.w} device pixels of ${filled.w})`,
  );
});
