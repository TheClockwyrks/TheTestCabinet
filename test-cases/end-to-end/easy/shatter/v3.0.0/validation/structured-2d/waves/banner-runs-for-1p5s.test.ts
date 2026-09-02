// waves/banner-runs-for-1p5s — the banner a clear raises runs for a second and a
// half, not longer and not shorter.
//
// THE RULE. `specs/progression.md`, "The banner": "The banner runs for
// `WAVE_BANNER_TIME` (`1.5` seconds)". `specs/instrumentation.md` reports it as
// `waveBanner`, "seconds left on the `WAVE N` banner, `0` when none".
//
// WHAT IS MEASURED. `waveBanner` at two moments after a real clear: `1.4` seconds
// on, where it must still be showing, and `1.6` seconds on, where it must be
// gone. One requirement — a duration — read from both sides, which is what the
// review item states and what a duration needs: a build with a half-second banner
// passes an "is it gone yet" check, and a build whose banner never ends passes an
// "is it showing" check.
//
// THE HUNDRED MILLISECONDS EITHER SIDE ARE THE TOLERANCE, and they are the review
// item's own. `1.4` and `1.6` are twelve ticks short of and twelve ticks past the
// specified `1.5`, so a build whose banner clock is out by a tick or two — or
// which starts it on the tick after the clear, as `clears-on-last-rock`'s
// one-tick allowance permits — passes both, and a build that is out by more than
// a tenth of a second fails one.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A one-second banner is
// gone at `1.4` and fails the first reading. A two-second banner reads `0.6` at
// `1.4` and `0.4` at `1.6`, passing the first and failing the second. A banner
// that never runs out reads `1.5` at both and fails the second. A banner that
// counts UP rather than down never reaches `0` and fails the second.
//
// THE CLOCK IS STARTED FROM THE OBSERVED BANNER, not from the kill: the check
// reads the tick the banner first shows and measures both moments from there. A
// build allowed one tick to notice the destruction must not spend its tolerance
// twice.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the banner is DRAWN, which is
// `presentation/wave-banner-is-drawn`'s point, and what the field does underneath
// it, which is `no-rock-during-the-banner`'s and `spawns-as-the-banner-ends`'s.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/** The wave the field is posed at. Any wave raises the same banner. */
const WAVE = 2;

/**
 * The two moments the review item names, in seconds from the tick the banner is
 * first seen: a tenth of a second inside `WAVE_BANNER_TIME` and a tenth past it.
 */
const STILL_SHOWING_AT = WAVE_BANNER_TIME - 0.1;
const GONE_BY = WAVE_BANNER_TIME + 0.1;

/**
 * How many ticks after the kill the banner is looked for.
 *
 * Two: the one `clears-on-last-rock` allows a build to notice the destruction in,
 * and one more so a build that raises the banner and decrements it in the same
 * pass is read after the decrement rather than before it. The clock this check
 * measures from starts at whichever of those ticks the banner is first seen on.
 */
const BANNER_LOOKAHEAD_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the banner at 1.4 s and has it gone by 1.6 s", async () => {
  openWaveAt(h, WAVE);
  await clearTheWave(h);

  // Where the clock starts: the first tick the banner is seen on.
  let raised = h.snapshot().waveBanner;
  let elapsed = 0;
  for (let tick = 0; tick < BANNER_LOOKAHEAD_TICKS && raised <= 0; tick += 1) {
    await h.advance(1);
    elapsed += 1;
    raised = h.snapshot().waveBanner;
  }
  assertGreaterThan(
    raised,
    0,
    "a banner raised by the clear, which is what this item then times " +
      "(specs/progression.md); a build that raises none is decided by " +
      "waves/clears-on-last-rock",
  );

  await h.advance(ticksFor(STILL_SHOWING_AT) - elapsed);
  const late = h.snapshot().waveBanner;
  // The banner in its last moments.
  captureStill(h, "banner");

  assertGreaterThan(
    late,
    0,
    `the banner still showing ${String(STILL_SHOWING_AT)} s after it was ` +
      `raised — it runs for WAVE_BANNER_TIME ` +
      `(${String(WAVE_BANNER_TIME)} s) (specs/progression.md)`,
  );

  await h.advance(ticksFor(GONE_BY) - ticksFor(STILL_SHOWING_AT));
  const after = h.snapshot().waveBanner;

  assertLessThanOrEqual(
    after,
    0,
    `the banner gone ${String(GONE_BY)} s after it was raised, reported as ` +
      `0 seconds left — it runs for WAVE_BANNER_TIME ` +
      `(${String(WAVE_BANNER_TIME)} s) and nothing of it remains once it has ` +
      `run out (specs/progression.md, specs/instrumentation.md)`,
  );
});
