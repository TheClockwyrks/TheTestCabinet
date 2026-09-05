// hud/health-bar-scales — the health bar fills from its left edge by `hp`.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Health | A bar
// filled from its left edge, its filled width `hp / maxHp` of the bar's width,
// with both numbers beside it".
//
// THE FIGURE, AND WHERE IT COMES FROM. `hp / maxHp` at 25 of 100 is a quarter,
// so the fill at that health is a quarter of the fill at full health. `maxHp` is
// `BASE_MAX_HP` (`100`) with no Tallow held (`specs/instrumentation.md`,
// "Snapshot shape"), which is what an isolated run holds, so the two healths
// this point poses are literally a quarter and the whole of the bar.
//
// HOW A FILL IS MEASURED WITHOUT KNOWING WHERE THE BAR IS. `specs/ui.md` fixes
// no palette and no styling, and leaves the HUD's layout to the build past the
// placements its own table states, so nothing here may look for a colour or a
// coordinate. What a fill IS, to a script, is the region that changed when the
// health changed and nothing else did: the band between two fills of one bar
// is a filled shape running the height of the bar, so `hud/regions.ts` takes the
// tallest unbroken block of changed pixels for the bar's rows and reads the
// band's width across them, passing over the rules a build may have drawn down
// its bar. A run of text can never be mistaken for one, since a stroke tall
// enough to fill those rows stands alone and narrower. A band of any width at
// all is what says a bar was drawn; how tall it is, and how it is styled, are
// the build's and the reviewer's. Three frames are taken, differing in health
// alone, and each band is measured against the near-empty one:
//
//   band(1 → 25)  is the bar from a hundredth of its width to a quarter of it
//   band(1 → 100) is the bar from a hundredth of its width to all of it
//
// so the ratio of the two widths is `(0.25 − 0.01) / (1 − 0.01)`, `0.2424`. The
// near-empty frame is posed at `hp` `1` rather than `0` because `specs/world.md`
// ends the run fallen at the end of the next tick at `0`, and a frame on `fallen`
// draws no HUD.
//
// WHICH END THE FILL GREW FROM. Both bands were left by health ADDED to the
// near-empty frame, and a bar "filled from its left edge" grows to the right
// alone, so both begin on the column that frame's own fill ended at and differ
// in their right edges alone. The two left edges are therefore read as well as
// the two widths, which is what separates the picture the row states from its
// reflection: a bar anchored on its right edge and a bar that empties as the
// health rises both draw the quarter and the whole at the same two WIDTHS, and
// put the shorter band's left edge three quarters of the way along the bar.
//
// THE TOLERANCES. `HUD_BAR_RATIO_TOL` (`0.1`) around the quarter the spec figure
// gives, which the `0.2424` a perfect bar measures sits well inside. A bar drawn
// with a border, an inset, or a rounded end loses a pixel or two at each end of
// each band, and at any width a legible bar is drawn at that is far under the
// tolerance; a bar that ignores `hp`, that fills to a fixed width, or that snaps
// between empty and full is nowhere near it. `HUD_BAR_LEFT_TOL` (`0.1` of the
// bar's own width) between the two left edges, which the same border or inset
// moves by the same pixel or two.
//
// WHY THE NUMBERS ARE TAKEN OUT OF THE COMPARISON. The health numbers change
// with the health too, and `specs/ui.md` draws them "beside" the bar, so the
// columns a redrawn readout covers are columns the bar is not in. Clearing them
// leaves the bar alone and leaves a build that never moves its fill with nothing
// changed at all to be measured (`hud/readouts.ts`).
//
// WHY EACH FRAME GETS A HARNESS OF ITS OWN. The three frames then sit at the
// same tick, the same simulated time and the same run state, and differ in the
// one figure this point is about, so nothing else in the frame can have moved
// under the comparison.

import { afterEach, it } from "vitest";
import {
  BASE_MAX_HP,
  HUD_BAR_LEFT_TOL,
  HUD_BAR_RATIO_TOL,
  TICK_HZ,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNear,
} from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  type DrawCall,
  type Harness,
  type PixelRect,
} from "../harness";
import { textSpansDiffering } from "./readouts";
import { changedBand, differenceMask, frame, withoutColumns } from "./regions";

/** The three healths read, out of `BASE_MAX_HP` (`100`). */
const NEARLY_EMPTY = 1;
const QUARTER = 25;
const FULL = BASE_MAX_HP;

/** The share of the bar the spec figure gives `QUARTER` of `FULL`. */
const QUARTER_SHARE = QUARTER / FULL;

/**
 * Ticks run after the health is posed, so a bar a build chose to ease toward
 * its target has arrived. One second of game time at `TICK_HZ`; the run clock
 * still reads the same in all three frames, and with every driver switch off
 * nothing else in the world moves across them.
 */
const SETTLE_TICKS = TICK_HZ;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

interface Frame {
  h: Harness;
  pixels: PixelRect;
  calls: DrawCall[];
}

/** An isolated run posed at `hp`, settled, and the frame it left. */
async function frameAt(hp: number): Promise<Frame> {
  const h = await createHarness();
  harnesses.push(h);
  const posed = isolate(h);
  assertEqual(
    posed.run.maxHp,
    BASE_MAX_HP,
    "the max health an isolated run holds",
  );
  h.debug.setHp(hp);
  const settled = await advanceTicks(h, SETTLE_TICKS);
  assertEqual(settled.run.player.hp, hp, `the health the run holds at ${hp}`);
  assertEqual(settled.screen, "playing", `the screen at ${hp} health`);
  return { h, pixels: frame(h), calls: h.lastCalls() };
}

/** The band of bar the two frames differ in, with their readouts left out. */
function bandBetween(a: Frame, b: Frame) {
  return changedBand(
    withoutColumns(
      differenceMask(a.pixels, b.pixels),
      textSpansDiffering(a.calls, b.calls),
    ),
  );
}

it("fills the health bar in proportion to hp", async () => {
  const empty = await frameAt(NEARLY_EMPTY);
  const quarter = await frameAt(QUARTER);
  const full = await frameAt(FULL);
  captureStill(quarter.h, "bar");

  assertGreaterThan(
    pixelsDiffering(quarter.pixels, full.pixels),
    0,
    `pixels the frame at ${QUARTER} of ${FULL} health differs from the frame at ${FULL} in`,
  );

  const whole = bandBetween(empty, full);
  const part = bandBetween(empty, quarter);

  assertGreaterThan(whole.w, 0, "the width of the bar the health filled");
  assertGreaterThan(part.w, 0, `the width the bar filled at ${QUARTER} health`);

  assertNear(
    part.w / whole.w,
    QUARTER_SHARE,
    HUD_BAR_RATIO_TOL,
    `the share of the bar filled at ${QUARTER} of ${FULL} health (${part.w} device pixels of ${whole.w})`,
  );

  assertLessThanOrEqual(
    Math.abs(part.x - whole.x) / whole.w,
    HUD_BAR_LEFT_TOL,
    `how far apart the two bands begin, as a share of the bar's width (the ` +
      `band at ${QUARTER} health begins at column ${part.x}, the band at ` +
      `${FULL} at column ${whole.x})`,
  );
});
