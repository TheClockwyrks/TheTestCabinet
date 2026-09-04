// Spectra — screens/mute-indicator: mute is shown, not just held.
//
// THE RULE. `specs/ui.md`: "The bottom strip also carries a mute indicator. It is
// drawn whenever sound is muted and is absent whenever it is not, and it is the only
// thing about the HUD or the field that mute changes." `specs/field.md` puts it in the
// BOTTOM HUD strip, `y` in `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`), and leaves how
// it is composed and placed within that strip to the build.
//
// BOTH DIRECTIONS ARE ONE REQUIREMENT. "Drawn whenever muted and absent whenever not"
// is a single rule about a single mark, and a build that latches the indicator on for
// the rest of the run satisfies half of it. So the strip is read three times on one
// posed field — unmuted, muted, unmuted again — and the third reading has to come back
// to the first: the mark appears, and then it is GONE rather than merely joined by
// something else.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. There is no `setMuted` on the surface
// under any engine (`specs/instrumentation.md`) — the mute bit is the engine's own,
// reported by the snapshot and reached through the `mute` binding — so `mute` is
// toggled through its real key (`specs/controls.md`, `KeyM`, which toggles sound "from
// any screen") and `snapshot().muted` reports the result. It is read back at each step,
// so every reading is held against the state the BUILD believes it is in.
//
// WHY THE WHOLE STRIP. `specs/field.md` says "how each is composed and placed within
// its strip is yours", so a check that read a fixed box would be asserting a layout the
// specification leaves to the build. Nothing else in the strip can have moved: the
// lives, the score, the meter and the ship's band are untouched across all three
// readings.
//
// THE CONTROL. A build is free to animate what it draws, so the strip's own
// frame-to-frame drift is measured first, unmuted, with nothing posed between the two
// readings, and the change mute causes has to beat it.
//
// WHAT IS NOT ASSERTED. That `KeyM` is mute's only binding, which is
// `controls/mute-m`'s; that a muted game starts no sound, which is
// `audio/mute-silences`'s. This point reads what mute DRAWS.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import {
  BOTTOM_STRIP,
  countMoved,
  driftOverOneFrame,
  readRegion,
} from "./reading";

/** The key `specs/controls.md` binds `mute` to, written out as it states it. */
const MUTE_KEY = "KeyM";

/**
 * How far a pixel must move to count as repainted, as a Euclidean RGB distance out of
 * the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/ui.md` states the rule and leaves the palette to the
 * build: `40` is about a tenth of the space, which is the least a player reads as a
 * mark appearing at a glance, and far above the rounding two readings of one unchanged
 * pixel differ by.
 */
const REPAINT_MIN = 40;

/**
 * How many pixels of the strip the indicator must repaint to count as drawn — and,
 * unmuted again, must NOT repaint, for it to count as gone.
 *
 * One figure for both directions on purpose: "drawn whenever muted and absent whenever
 * it is not" is one mark, so what counts as present has to be what counts as absent —
 * and both are taken against the same floor, so the two readings partition cleanly on
 * one number rather than on two the strip could fall between.
 *
 * At the harness's default shape the canvas is the stage at one device pixel per
 * logical unit, so `64` pixels is an eight-by-eight mark, smaller than one glyph of
 * type legible at the stage's `1280 x 720` (`specs/ui.md`).
 */
const INDICATOR_PIXELS = 64;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a mute indicator in the bottom strip while muted and none when unmuted", async () => {
  startPosed(h);
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    false,
    "the game starts unmuted, which is the state this reading is held against",
  );

  const drift = await driftOverOneFrame(h, BOTTOM_STRIP, REPAINT_MIN);
  const unmuted = drift.reading;

  await h.tap(MUTE_KEY);
  assertEqual(
    h.snapshot().muted,
    true,
    `the ${MUTE_KEY} key muted the game, mute being toggled from any screen ` +
      "(specs/controls.md)",
  );
  const muted = readRegion(h, BOTTOM_STRIP);
  captureStill(h, "muted");

  await h.tap(MUTE_KEY);
  assertEqual(
    h.snapshot().muted,
    false,
    `a second ${MUTE_KEY} unmuted the game again (specs/controls.md)`,
  );
  const unmutedAgain = readRegion(h, BOTTOM_STRIP);
  captureStill(h, "unmuted");

  // One floor for both directions: a strip that moves on its own moves whether the
  // game is muted or not, so it raises the bar the mark must clear and the bar the
  // absent mark must stay under by the same amount.
  const floor = Math.max(drift.count, INDICATOR_PIXELS);
  assertGreaterThan(
    countMoved(unmuted, muted, REPAINT_MIN),
    floor,
    "pixels of the bottom HUD strip the mute indicator painted — it is drawn " +
      "whenever sound is muted (specs/ui.md) and sits in that strip " +
      "(specs/field.md); the strip moved on its own across one frame in " +
      `${String(drift.count)} pixels`,
  );
  assertLessThanOrEqual(
    countMoved(unmuted, unmutedAgain, REPAINT_MIN),
    floor,
    "pixels of the strip still standing apart from the unmuted reading once " +
      "the game was unmuted again — the indicator is ABSENT whenever sound is " +
      "not muted (specs/ui.md), so it is gone rather than latched on",
  );
});
