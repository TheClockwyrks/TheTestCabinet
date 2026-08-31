// presentation/text-legible — every word the game draws can be read.
//
// THE RULE. specs/overview.md's legibility table: "Every readout and every
// screen's text is legible against its background at the logical stage size." It
// is the one row of the table that is not about two named things reading apart,
// because the two things are whatever a build chose to write and whatever it
// chose to write it on. So the check does not name any text: it finds every run
// the frame drew, and reads each one against the ground it landed on.
//
// EVERY SCREEN, BECAUSE THE ROW SAYS EVERY SCREEN. The eight screens
// specs/screens.md fixes, plus the build panel of specs/hud.md, which is drawn
// with the floor while the run is playing. Each is reached through `setScreen`
// and drawn once; what each screen must SAY is the `screens` and `hud` groups'
// business, and nothing here reads a word of it.
//
// HOW A RUN OF TEXT IS FOUND AND MEASURED. `drawnTextSpans` maps every `fillText`
// and `strokeText` of the frame back into logical units through the transform the
// context held at the call, which gives the run's anchor and the horizontal
// extent of its glyphs. The specification fixes no typeface and no size, so the
// height is taken from the run itself: a run's measured width over its length is
// its average advance, and an average advance is a little over half an em in
// every ordinary face, which puts the band of the glyphs just above the baseline.
// The band is then read whole, and the reading is the distance between what that
// band MOSTLY is — its ground — and the pixel in it furthest from that, which is
// the ink at its most solid.
//
// WHY ONLY WHAT IS DRAWN AFTER THE LAST FULL-STAGE WASH. specs/screens.md has the
// pause screen and the two end screens open OVER a run, and a build is free to
// lay a scrim across the whole stage before drawing them. The text under such a
// scrim was drawn, and `drawnTextSpans` finds it, but it is not text the player is
// being asked to read — it is the floor being deliberately pushed back. So the
// frame's last fill covering essentially the whole stage is taken as the point
// the picture starts, and only the runs after it are read. On a screen with no
// overlay that fill is the frame's own clear, and everything is read.
//
// WHY THE FIGURE IS WHAT IT IS. This is a contrast, and the measured contrast
// UNDERSTATES the real one: at ordinary sizes many of a glyph's pixels are blends
// of ink and ground, and a run drawn at a small size may have few solid ones. So
// the same 50 of 441 the rest of this group calls "plainly apart" is a floor here
// rather than a target — a build that clears it may still have text a reviewer
// finds thin, and a build that fails it has drawn text a player genuinely cannot
// pick out of its own background.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_H, STAGE_W } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  createHarness,
  captureStill,
  drawFrame,
  drawnTextSpans,
  startRun,
  type DrawCall,
  type Harness,
  type TextSpan,
} from "../harness";
import type { Screen } from "../surface";
import { dominant, furthestFrom, readRegion, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a run's ink must sit from its
 * ground.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. See the header on
 * why it is a floor rather than a target here.
 */
const TEXT_CONTRAST_MIN = 50;

/**
 * How close two pixels of a run's band must be to count as the same reading, when
 * the check asks what the band mostly is.
 *
 * Half of `TEXT_CONTRAST_MIN`, and the suite's figure for two readings that are
 * the same thing rather than two things: a panel shaded behind its readouts, a
 * gradient, a pixel softened at the edge of a slot.
 */
const SAME_READING_MAX = 25;

/**
 * The share of the stage a single fill must cover to count as a wash the picture
 * starts after.
 *
 * Nine tenths. A scrim laid over a screen covers the stage; the largest thing a
 * build fills that is NOT a wash is a region of it — specs/floor.md puts the
 * reactor at 986 of 1280 wide, which is under four fifths of the stage — so
 * nothing short of a full-stage cover is mistaken for one.
 */
const WASH_SHARE = 0.9;

/**
 * The average advance of a glyph, as a share of the em.
 *
 * How the band's height is recovered from a run's measured width, since the
 * specification fixes no typeface and no size. Between a half and three fifths in
 * every ordinary face, condensed and wide alike; the band it produces is read
 * whole, and it only has to contain both the glyphs and some of the ground around
 * them, so the estimate has all the room it needs.
 */
const ADVANCE_PER_EM = 0.55;

/** How far above and below the baseline the band runs, in ems. */
const BAND_ABOVE = 0.72;
const BAND_BELOW = 0.02;

/** The smallest em a run may be measured at, and the fewest pixels a band needs. */
const MIN_EM = 5;
const MIN_BAND_PIXELS = 8;

/** How dense the reading of a band is: about sixteen samples across an em. */
const SAMPLES_PER_EM = 16;

/** The screens read, in the order specs/screens.md gives them. */
const SCREENS: readonly Screen[] = [
  "title",
  "modeselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];

/** The screen whose frame is kept as the point's picture: the panel's readouts. */
const SHOWN_SCREEN: Screen = "playing";

/** The index of the last call that covered essentially the whole stage. */
function lastWash(h: Harness, calls: readonly DrawCall[]): number {
  const view = h.engine.viewport();
  let found = -1;
  calls.forEach((call, index) => {
    if (call.kind !== "call" || call.method !== "fillRect") return;
    const m = call.transform;
    if (m === undefined) return;
    const [, , w, height] = call.args;
    if (typeof w !== "number" || typeof height !== "number") return;
    const wide = (Math.abs(w) * Math.hypot(m.a, m.b)) / view.scale;
    const tall = (Math.abs(height) * Math.hypot(m.c, m.d)) / view.scale;
    if (wide * tall >= WASH_SHARE * STAGE_W * STAGE_H) found = index;
  });
  return found;
}

/** The contrast between a run's ink and its ground, or `null` if too small to read. */
function contrastOf(
  h: Harness,
  span: TextSpan,
): { contrast: number; ground: string; ink: string } | null {
  const width = span.right - span.left;
  const em = width / (ADVANCE_PER_EM * Math.max(1, span.text.length));
  if (em < MIN_EM) return null;
  const samples = readRegion(
    h,
    {
      left: span.left,
      top: span.y - BAND_ABOVE * em,
      right: span.right,
      bottom: span.y + BAND_BELOW * em,
    },
    Math.max(1, Math.round(em / SAMPLES_PER_EM)),
  );
  if (samples.length < MIN_BAND_PIXELS) return null;
  const ground = dominant(samples, SAME_READING_MAX);
  const ink = furthestFrom(samples, ground);
  return {
    contrast: ink.distance,
    ground: showRgb(ground),
    ink: showRgb(ink.colour),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every run of text apart from what it is drawn on", async () => {
  for (const screen of SCREENS) {
    startRun(h);
    h.debug.setScreen(screen);
    const calls = await drawFrame(h);
    if (screen === SHOWN_SCREEN) captureStill(h, "text");

    const spans = drawnTextSpans(h, calls.slice(lastWash(h, calls) + 1));
    let read = 0;
    for (const span of spans) {
      if (span.text.trim() === "") continue;
      const found = contrastOf(h, span);
      if (found === null) continue;
      read += 1;
      assertGreaterThanOrEqual(
        found.contrast,
        TEXT_CONTRAST_MIN,
        `the ${screen} screen's "${span.text.trim()}" (ink ${found.ink} on ` +
          `ground ${found.ground}), out of 441 (specs/overview.md: every ` +
          `readout and every screen's text is legible against its background ` +
          `at the logical stage size)`,
      );
    }
    assertGreaterThan(
      read,
      0,
      `runs of text the ${screen} screen drew for a player to read ` +
        `(specs/screens.md, specs/hud.md), which is what this point measures ` +
        `the contrast of`,
    );
  }
});
