// hud/experience-bar-scales — the experience bar fills from its left edge by
// `xp`.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Experience | A
// bar filled from its left edge, its filled width `xp / xpToNext` of the bar's
// width, labeled with `LEVEL_LABEL` (`LEVEL`) and the current level".
//
// THE FIGURES, AND WHERE THEY COME FROM. `specs/progression.md` gives the curve
// `xpToNext(level) = XP_BASE + XP_STEP × (level − 1)` and tables it: level `2`
// needs `15`. So a run posed at level `2` with `3` experience has filled one
// fifth of the bar, one with `12` has filled four fifths of it, and one with
// `15` has filled all of it.
//
// HOW A FILL IS MEASURED WITHOUT KNOWING WHERE THE BAR IS. `specs/ui.md` fixes
// no palette and no styling, and leaves the HUD's layout to the build past the
// placements its own table states, so nothing here may look for a colour or a
// coordinate. What a fill IS, to a script, is the region that changed when
// the experience changed and nothing else did: the band between two fills of one
// bar is a filled shape running the height of the bar, so `hud/regions.ts` takes
// the tallest unbroken block of changed pixels for the bar's rows and reads the
// band's width across them, passing over the rules a build may have drawn down
// its bar. A band of any width at all is what says a bar was drawn; how tall it
// is, and how it is styled, are the build's and the reviewer's. The bar is EMPTY
// at `xp` `0`, so each band measured against that frame is a fill read from the
// bar's own start:
//
//   band(0 → 3)  is the bar filled one fifth
//   band(0 → 12) is the bar filled four fifths
//   band(0 → 15) is the bar filled whole
//
// and nothing else in these four frames differs at all — the level label, the
// health readout, the clock and the kill count are the same in each, since only
// `xp` was posed.
//
// WHICH END THE FILL GREW FROM. The bar the empty frame drew is filled to
// nothing, so every band IS the fill itself, and a bar "filled from its left
// edge" puts all of them on the same column with only their right edges apart.
// Each partial band's left edge is therefore read as well as its width, which is
// what separates the picture the row states from the pictures that draw those
// same WIDTHS somewhere else along the bar. A band of a given share sits this
// far along a bar that is not filled from its left edge:
//
//   anchored on the right edge, or emptying as the experience rises:
//     the whole of what the fill is short by — a fifth at four fifths filled,
//     four fifths at a fifth filled
//   centred on its own track:
//     HALF of what the fill is short by — a tenth at four fifths filled, and
//     two fifths at a fifth filled
//
// which is why TWO partial fills are read and not one. The centred bar at four
// fifths lands on a tenth, `HUD_BAR_LEFT_TOL` exactly, so a large fill cannot be
// what the left edge is held by; the fifth puts every one of those pictures at
// least two fifths of the bar's width from the bar's start. The four fifths is
// still read, for its WIDTH: it holds the ratio at the top of the bar, where a
// fill that saturates early already reads as whole.
//
// THE TOLERANCES. `HUD_BAR_RATIO_TOL` (`0.1`) around each share the spec figures
// give, the fifth and the four fifths. A bar drawn with a border, an inset, or a
// rounded end loses a pixel or two at each end of each band, far under the
// tolerance at any width a legible bar is drawn at; a bar that ignores `xp`,
// that fills to a fixed width, or that snaps between empty and full is nowhere
// near either. `HUD_BAR_LEFT_TOL` (`0.1` of the bar's own width) between a
// band's left edge and the whole bar's, which the same border or inset moves by
// the same pixel or two, and which the fifth's band clears by four times over
// or more under any of the pictures above.
//
// WHY EACH FRAME GETS A HARNESS OF ITS OWN. The four frames then sit at the
// same tick, the same simulated time and the same run state, and differ in the
// one figure this point is about.

import { afterEach, it } from "vitest";
import {
  HUD_BAR_LEFT_TOL,
  HUD_BAR_RATIO_TOL,
  TICK_HZ,
  xpToNext,
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
  type Harness,
  type PixelRect,
} from "../harness";
import { changedBand, differenceMask, frame } from "./regions";

/** The level posed, whose `xpToNext` is the `15` the point is stated in. */
const LEVEL = 2;

/** The four experiences read, out of `xpToNext(2)` (`15`). */
const EMPTY = 0;
const FIFTH = 3;
const FOUR_FIFTHS = 12;
const WHOLE = xpToNext(LEVEL);

/** Ticks run after the experience is posed, so an eased bar has arrived. */
const SETTLE_TICKS = TICK_HZ;

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
  const fifth = await frameAt(FIFTH);
  const fourFifths = await frameAt(FOUR_FIFTHS);
  const whole = await frameAt(WHOLE);
  captureStill(fourFifths.h, "bar");

  assertGreaterThan(
    pixelsDiffering(empty.pixels, fourFifths.pixels),
    0,
    `pixels the frame at ${FOUR_FIFTHS} of ${WHOLE} experience differs from the frame at ${EMPTY} in`,
  );

  const filled = changedBand(differenceMask(empty.pixels, whole.pixels));

  assertGreaterThan(filled.w, 0, "the width of the bar the experience filled");

  /** Each partial fill, the share of the bar the spec gives it, and its band. */
  const parts = [
    {
      xp: FIFTH,
      share: FIFTH / WHOLE,
      band: changedBand(differenceMask(empty.pixels, fifth.pixels)),
    },
    {
      xp: FOUR_FIFTHS,
      share: FOUR_FIFTHS / WHOLE,
      band: changedBand(differenceMask(empty.pixels, fourFifths.pixels)),
    },
  ];

  for (const part of parts) {
    assertGreaterThan(
      part.band.w,
      0,
      `the width the bar filled at ${part.xp} experience`,
    );

    assertNear(
      part.band.w / filled.w,
      part.share,
      HUD_BAR_RATIO_TOL,
      `the share of the bar filled at ${part.xp} of ${WHOLE} experience (${part.band.w} device pixels of ${filled.w})`,
    );

    assertLessThanOrEqual(
      Math.abs(part.band.x - filled.x) / filled.w,
      HUD_BAR_LEFT_TOL,
      `how far apart the two bands begin, as a share of the bar's width (the ` +
        `band at ${part.xp} experience begins at column ${part.band.x}, the ` +
        `band at ${WHOLE} at column ${filled.x})`,
    );
  }
});
