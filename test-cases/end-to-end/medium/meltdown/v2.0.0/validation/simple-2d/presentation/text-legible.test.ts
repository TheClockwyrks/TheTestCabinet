// presentation/text-legible — every run of text the game draws reaches the
// finished picture.
//
// THE RULE. specs/overview.md's legibility table: "Every readout and every
// screen's text is legible against its background at the logical stage size."
// What a check can decide of that is that the ink ARRIVED: the run the build
// submitted left something on the frame a player sees. How readable the result is
// — the face, the size, the colour it chose against the panel behind it — is
// appearance, which the same specification hands to the build ("The palette, the
// type, the glow, and every other aspect of the look are yours") and the
// reviewer's presentation rating judges. So the check names no text: it finds
// every run the frame drew, and reads the box each one landed in.
//
// WHY THIS IS NOT ALREADY CARRIED BY `hud` AND `screens`. Those groups read the
// runs the build SUBMITTED — what each screen and each readout says, and that it
// was drawn at all. A build that submits a run and then paints over it, or draws
// it in the exact colour of the ground under it, satisfies every one of them and
// puts nothing on the screen. This point is the one reading taken off the
// finished frame instead.
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
// WHERE THE BAR COMES FROM. Not a stated contrast. The same band is read on two
// consecutive frames, which is how much the build's own animation moves it, and
// the ink has to beat that by `NOISE_MARGIN`. A build that lays its text in the
// ground's own colour, or paints over it, leaves a band that reads as one flat
// colour and clears nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  createHarness,
  captureStill,
  drawFrame,
  drawnTextSpans,
  startRun,
  transformsInForce,
  type DrawCall,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";
import type { Screen } from "../surface";
import {
  NOISE_MARGIN,
  furthestFrom,
  largestShift,
  modal,
  readRegion,
  showRgb,
} from "./read";

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

/**
 * The index of the last call that covered essentially the whole stage.
 *
 * The transform in force at each call comes from `harness.ts`'s
 * {@link transformsInForce}, which carries it through the frame's own operations;
 * it is a `[a, b, c, d, e, f]` tuple, in the order a canvas states one.
 */
function lastWash(h: Harness, calls: readonly DrawCall[]): number {
  const view = h.engine.viewport();
  const inForce = transformsInForce(calls);
  let found = -1;
  calls.forEach((call, index) => {
    if (call.kind !== "call" || call.method !== "fillRect") return;
    const m = inForce[index];
    const [, , w, height] = call.args;
    if (typeof w !== "number" || typeof height !== "number") return;
    const wide = (Math.abs(w) * Math.hypot(m[0], m[1])) / view.scale;
    const tall = (Math.abs(height) * Math.hypot(m[2], m[3])) / view.scale;
    if (wide * tall >= WASH_SHARE * STAGE_W * STAGE_H) found = index;
  });
  return found;
}

/** The band of the picture one run of text was laid in, or `null` if too small. */
function bandOf(h: Harness, span: TextSpan): Rgb[] | null {
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
  return samples.length < MIN_BAND_PIXELS ? null : samples;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every run of text onto the frame", async () => {
  for (const screen of SCREENS) {
    startRun(h);
    h.debug.setScreen(screen);
    const calls = await drawFrame(h);
    if (screen === SHOWN_SCREEN) captureStill(h, "text");

    const spans = drawnTextSpans(h, calls.slice(lastWash(h, calls) + 1));
    const bands = spans.map((span) => bandOf(h, span));
    await drawFrame(h);
    const again = spans.map((span) => bandOf(h, span));

    let read = 0;
    for (const [index, span] of spans.entries()) {
      if (span.text.trim() === "") continue;
      const before = bands[index];
      const band = again[index];
      if (before === null || band === null) continue;
      read += 1;
      const noise = largestShift(before, band);
      const ground = modal(band);
      const ink = furthestFrom(band, ground);
      assertGreaterThanOrEqual(
        ink.distance,
        noise + NOISE_MARGIN,
        `the ${screen} screen's "${span.text.trim()}": ink left on the ` +
          `finished picture there (${showRgb(ink.colour)}) against the ground ` +
          `it is laid on (${showRgb(ground)}), past the ${noise} that band ` +
          `moved between two frames on its own. A run drawn in the ground's ` +
          `own colour, and one drawn and then painted over, both read as ` +
          `nothing (specs/overview.md: every readout and every screen's text ` +
          `is legible against its background at the logical stage size)`,
      );
    }
    assertGreaterThan(
      read,
      0,
      `runs of text the ${screen} screen drew for a player to read ` +
        `(specs/screens.md, specs/hud.md), which is what this point reads the ` +
        `picture for`,
    );
  }
});
