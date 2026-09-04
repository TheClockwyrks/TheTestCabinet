// Spectra — screens/hud-resonance-ready: a full meter reads as ready.
//
// THE RULE. `specs/ui.md`, on the resonance readout: "A full meter is drawn distinctly
// from one a point below full, so a player sees that a discharge is ready."
// `specs/resonance.md` is what makes that the interesting boundary: "A discharge is
// available exactly when the meter reads `RESONANCE_MAX`, and not one point below."
//
// WHY A PLAIN DIFFERENCE WOULD NOT DECIDE IT. A bar whose filled extent tracks the
// meter differs a little between `99` and `100` for free — one point of a hundred of
// its length — and that difference is not a player seeing that a discharge is ready.
// So this point reads THREE values and holds the boundary against an ordinary step:
// how much the strip changes from `98` to `99`, which is one point of ordinary fill,
// and how much it changes from `99` to `100`, which is one point of fill PLUS whatever
// the build does to say "ready". The second must beat the first, and must be a mark a
// player could see at all. A build that only grows the bar reads the same on both and
// fails; a build that draws a full meter distinctly reads far apart.
//
// WHAT IS READ, AND WHY IT IS THE WHOLE STRIP. `specs/field.md` puts the meter in the
// bottom HUD strip and says "how each is composed and placed within its strip is
// yours", so a check that read a fixed box would be asserting a layout the
// specification leaves to the build. The strip is fixed; the strip is read. What the
// build does to say "ready" — a colour, a glow, an outline, a word — is entirely open,
// and none of it is assumed.
//
// THE METER IS POSED, NOT FILLED. `setResonance` is what `specs/instrumentation.md`
// provides, and `dischargeReady` is read back off the snapshot at each pose, so the
// reading is held against the state the BUILD believes it is in.
//
// WHAT IS NOT ASSERTED. That the filled extent grows at all, which is
// `screens/hud-resonance`'s; that the discharge is only available at `RESONANCE_MAX`,
// which is the `resonance` group's.

import { afterEach, beforeEach, it } from "vitest";
import { RESONANCE_MAX } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import { BOTTOM_STRIP, countMoved, readRegion } from "./reading";

/** The three readings: two points below full, one point below, and full. */
const TWO_BELOW = RESONANCE_MAX - 2;
const ONE_BELOW = RESONANCE_MAX - 1;

/**
 * How far a pixel must move to count as repainted, as a Euclidean RGB distance out of
 * the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/ui.md` states the rule and leaves the palette to the
 * build: `40` is about a tenth of the space, which is the least a player reads as a
 * different treatment at a glance, and far above the rounding two readings of one
 * unchanged pixel differ by.
 */
const REPAINT_MIN = 40;

/**
 * How many pixels the ready treatment must repaint on its own account.
 *
 * At the harness's default shape the canvas is the stage at one device pixel per
 * logical unit, so `64` pixels is an eight-by-eight mark, smaller than one glyph of
 * type legible at the stage's `1280 x 720` (`specs/ui.md`). A difference smaller than
 * that is not "a player sees that a discharge is ready"; anything a build actually
 * draws to say it — a recoloured bar, a glow, an outline, a word — is far larger.
 */
const READY_MIN_PIXELS = 64;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the full meter further from one point below full than an ordinary point is", async () => {
  startPosed(h);

  // Two points below full: the far end of the ordinary one-point step.
  h.debug.setResonance(TWO_BELOW);
  await h.advance(1);
  assertEqual(
    h.snapshot().dischargeReady,
    false,
    `a meter at ${String(TWO_BELOW)} is not ready (specs/resonance.md)`,
  );
  const atTwoBelow = readRegion(h, BOTTOM_STRIP);

  // One point below full: still not ready.
  h.debug.setResonance(ONE_BELOW);
  await h.advance(1);
  assertEqual(
    h.snapshot().dischargeReady,
    false,
    `a meter at ${String(ONE_BELOW)} is not ready — a discharge is available ` +
      "exactly at RESONANCE_MAX and not one point below (specs/resonance.md)",
  );
  const atOneBelow = readRegion(h, BOTTOM_STRIP);
  captureStill(h, "short");

  // Full: ready.
  h.debug.setResonance(RESONANCE_MAX);
  await h.advance(1);
  assertEqual(
    h.snapshot().dischargeReady,
    true,
    `a meter at RESONANCE_MAX (${String(RESONANCE_MAX)}) is ready ` +
      "(specs/resonance.md)",
  );
  const atFull = readRegion(h, BOTTOM_STRIP);
  captureStill(h, "full");

  const ordinaryStep = countMoved(atTwoBelow, atOneBelow, REPAINT_MIN);
  const readyStep = countMoved(atOneBelow, atFull, REPAINT_MIN);

  assertGreaterThan(
    readyStep,
    Math.max(ordinaryStep, READY_MIN_PIXELS),
    "pixels of the bottom HUD strip repainted going from " +
      `${String(ONE_BELOW)} to RESONANCE_MAX (${String(RESONANCE_MAX)}) — a ` +
      "FULL meter is drawn distinctly from one a point below full, so a player " +
      "sees that a discharge is ready (specs/ui.md); the ordinary one-point " +
      `step from ${String(TWO_BELOW)} to ${String(ONE_BELOW)} repainted ` +
      `${String(ordinaryStep)} pixels, so a bar that only grew would read the ` +
      "same on both",
  );
});
