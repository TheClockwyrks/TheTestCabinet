// Spectra — screens/mute-indicator: mute is shown, not just held.
//
// THE RULE. `specs/ui.md`: "The bottom strip also carries a mute indicator. It is
// drawn whenever sound is muted and is absent whenever it is not, and it is the only
// thing about the HUD or the field that mute changes." `specs/field.md` puts it in
// the BOTTOM HUD strip, `y` in `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`), and leaves
// how it is composed and placed within that strip to the build.
//
// BOTH DIRECTIONS ARE ONE REQUIREMENT. "Drawn whenever muted and absent whenever not"
// is a single rule about a single mark, and a build that latches the indicator on for
// the rest of the run satisfies half of it. So the strip is read three times on one
// posed field — unmuted, muted, unmuted again — and the third reading has to come
// back to the first: the mark appears, and then it is GONE rather than merely joined
// by something else.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` gives the
// surface no operation that sets it — the mute bit is the engine's audio bus, which a
// pure `(state, ...) => state` transform could not reach — so `mute` is toggled
// through its real binding (`specs/controls.md`, `KeyM`, which toggles sound "from any
// screen") and `snapshot().muted` reports the result. It is read back at each step, so
// every reading is held against the state the BUILD believes it is in.
//
// WHY THE WHOLE STRIP. `specs/field.md` says "how each is composed and placed within
// its strip is yours", so a check that read a fixed box would be asserting a layout
// the specification leaves to the build. Nothing else in the strip can have moved: the
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
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import {
  BOTTOM_STRIP,
  PAINT_MIN,
  countMoved,
  driftOverOneFrame,
} from "./reading";

/** The key `specs/controls.md` binds `mute` to, written out as it states it. */
const MUTE_KEY = "KeyM";

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

  const drift = await driftOverOneFrame(h, BOTTOM_STRIP, PAINT_MIN);
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
  const floor = drift.count;
  assertGreaterThan(
    countMoved(unmuted, muted, PAINT_MIN),
    floor,
    "pixels of the bottom HUD strip the mute indicator painted — it is drawn " +
      "whenever sound is muted (specs/ui.md) and sits in that strip " +
      "(specs/field.md); the strip moved on its own across one frame in " +
      `${String(drift.count)} pixels`,
  );
  assertLessThanOrEqual(
    countMoved(unmuted, unmutedAgain, PAINT_MIN),
    floor,
    "pixels of the strip still standing apart from the unmuted reading once " +
      "the game was unmuted again — the indicator is ABSENT whenever sound is " +
      "not muted (specs/ui.md), so it is gone rather than latched on",
  );
});
