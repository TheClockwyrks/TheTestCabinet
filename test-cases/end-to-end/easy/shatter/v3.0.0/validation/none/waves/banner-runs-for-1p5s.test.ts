// waves/banner-runs-for-1p5s — the WAVE N banner runs for a second and a half.
//
// `specs/progression.md`, The banner: "The banner runs for `WAVE_BANNER_TIME`
// (`1.5` seconds), and the rocks it announces are spawned as it ends."
//
// TWO READINGS, ONE ON EACH SIDE OF THE FIGURE. A second and four tenths after the
// banner went up it is still showing; two tenths later it is gone. That brackets
// the stated duration from both directions with a tenth of a second to spare on
// each side, so a build whose banner runs for one second fails the first reading
// and one whose banner runs for two fails the second — and a build that has the
// figure right passes both however it rounds the last tick.
//
// WHY THE READINGS ARE NOT TAKEN ON THE INSTANT. A check that read at exactly
// `WAVE_BANNER_TIME` would be deciding the item on which side of the boundary a
// build's countdown lands, which is arithmetic rather than behaviour: a build that
// takes `TICK_DT` off the banner on the tick that raises it and one that takes it
// off on the tick after are both running a banner for a second and a half. The
// tenth of a second either way is what keeps that off the verdict, and it is far
// too small to admit a build with a different figure.
//
// `waveBanner` IS THE SECONDS LEFT, so this reads the timer rather than the
// picture. Whether a banner that is running is DRAWN, and drawn near the centre of
// the field, is `presentation/wave-banner-is-drawn`'s point, so a build that keeps
// the timer faultlessly and draws nothing loses that point rather than this one.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`, and the banner
// is EARNED rather than posed: `setWaveBanner` could put a banner up in one call,
// but the item is about the banner a clear raises, and a build whose clear raises a
// banner of the wrong length would pass a posed one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { bannerUp, clearAWave } from "./scenario";

/** The wave the run is posed at. Nothing here reads the number; it only needs one. */
const POSED_WAVE = 3;

/**
 * How far either side of `WAVE_BANNER_TIME` the two readings are taken: a tenth of
 * a second, the review item's own figure.
 *
 * Twelve ticks, which is more than the one tick of rounding any two countdown
 * conventions can differ by, and a fifteenth of the figure being read — so it
 * cannot admit a build whose banner runs for a second or for two.
 */
const MARGIN = 0.1;

/** The moment the banner must still be showing at, and the moment it must be gone. */
const SHOWING_AT = WAVE_BANNER_TIME - MARGIN;
const GONE_AT = WAVE_BANNER_TIME + MARGIN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("shows the banner 1.4 seconds after a clear and hides it by 1.6", async () => {
  const cleared = await clearAWave(h, { wave: POSED_WAVE });
  const raised = await bannerUp(h, cleared);

  assertGreaterThan(
    raised.waveBanner,
    0,
    "the seconds left on the banner on the tick it went up",
  );

  await h.advance(ticksFor(SHOWING_AT));
  const late = await h.snapshot();
  // The banner in its last moments, which is the picture this item is about.
  await captureStill(h, "banner");

  assertGreaterThan(
    late.waveBanner,
    0,
    `the seconds left on the WAVE N banner ${SHOWING_AT} seconds after it went ` +
      `up, which specs/progression.md runs for WAVE_BANNER_TIME ` +
      `(${WAVE_BANNER_TIME}) — it stood at ${raised.waveBanner} when it was ` +
      `raised`,
  );

  await h.advance(ticksFor(GONE_AT - SHOWING_AT));
  const over = await h.snapshot();

  // At most zero rather than exactly zero: `specs/instrumentation.md` reports the
  // seconds LEFT and puts `0` there when none is running, and a build whose
  // countdown runs a hair past the end before it clamps has still ended its banner.
  // What the item decides is that the banner is over, and it is over either way.
  assertLessThanOrEqual(
    over.waveBanner,
    0,
    `the seconds left on the WAVE N banner ${GONE_AT} seconds after it went up, ` +
      `which specs/progression.md runs for WAVE_BANNER_TIME ` +
      `(${WAVE_BANNER_TIME}) and no longer`,
  );
});
