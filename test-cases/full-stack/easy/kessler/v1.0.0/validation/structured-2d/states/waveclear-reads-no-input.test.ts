// states/waveclear-reads-no-input — rotation held through the interstitial
// leaves the deflector's center angle where the clearing event found it.
//
// specs/screens.md, on `waveclear`: "Only the interstitial's timer advances
// during it, and no input is read." specs/controls.md's screen table agrees:
// on `waveclear`, "Nothing; the interstitial runs on its own timer."
//
// The deflector is posed off its start angle first, so an ignored hold is
// told from a re-posed default, and the hold spans 100 of the interstitial's
// 180 ticks so the whole hold happens inside it. The interstitial is entered
// through the surface — setScreen("waveclear") enters "exactly as the
// clearing event enters it" — because staging a real clearing belongs to the
// rings points, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, WAVECLEAR_TICKS } from "../constants";
import { captureReplay, hold, openHarness, type Harness } from "../harness";

/** How long the rotation is held: well inside the 180-tick interstitial. */
const HELD_TICKS = 100;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ignores a held rotation during the interstitial", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setPaddleAngle(137);
  h.debug.setScreen("waveclear");
  const entered = h.snapshot();
  assertEqual(
    entered.screen,
    "waveclear",
    "the interstitial the rotation is held through",
  );

  await captureReplay(h, "held-through-interstitial", () =>
    hold(h, BINDINGS.right[0], HELD_TICKS),
  );

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "waveclear",
    `still inside the ${WAVECLEAR_TICKS}-tick interstitial after ${HELD_TICKS} held ticks`,
  );
  assertEqual(
    after.paddle.angleDeg,
    entered.paddle.angleDeg,
    "the deflector's center angle under a held rotation the interstitial must not read",
  );
});
