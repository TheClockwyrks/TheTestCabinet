// hud/combo-hidden-at-one — at a multiplier of one the combo area is empty.
//
// specs/ui.md: "The combo readout and its bar are shown only while `M` is at
// least `2`, and the combo area is empty at `M` of `1`." A multiplier of `1` is
// the multiplier every round opens on and returns to whenever the window lapses,
// so a build that draws `x1` there puts a readout on screen for most of a round
// that means nothing.
//
// The reading is the whole frame rather than a region, because where the combo
// area sits is the build's: no text of the form the specification fixes for the
// readout, `x2` through `x5`, appears anywhere. `×` is accepted beside `x`
// because a build is free to set the multiplier with the multiplication sign.
// The text read is the LOGICAL runs the frame spelled (`drawnTextLines`), so a
// readout letter-spaced into an `x` and a `2` a call apart is still found.
//
// The window is posed closed as well as the multiplier at one, which is the state
// specs/scoring.md pairs them in: a round opens with `M` at `1` and the window
// closed, and the first pellet meets exactly this.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { drawnTextLines } from "../case-harness/text";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The multiplier readout `specs/ui.md` fixes, at any value it may carry. */
const MULTIPLIER = /[x×]\s*[2-5]/i;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no multiplier readout while M is one", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    combo: 1,
    comboWindow: 0,
  });
  assertEqual(live.combo, 1, "the multiplier the HUD is read at");

  const calls = await h.frameCalls();
  await captureStill(h, "empty");

  assertLength(
    drawnTextLines(calls).filter((run) => MULTIPLIER.test(run)),
    0,
    "runs of text reading as a multiplier",
  );
});
