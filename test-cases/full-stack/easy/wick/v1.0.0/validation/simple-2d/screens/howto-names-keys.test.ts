// screens/howto-names-keys — the how-to screen names the keys.
//
// WHAT THIS DECIDES. One thing: the how-to frame names every key `BINDINGS`
// gives an action, so a player who has read it can drive the game. The screen's
// other subjects are prose whose words are the build's, and the one figure it
// carries, dawn's `10:00`, is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`howto`): the screen "covers ... the controls, naming the keys
//   `BINDINGS` gives each action: the arrows or `WASD` to move, `Enter` or
//   `Space` to confirm, `Escape` to go back, `P` to pause, and `M` to mute."
//   specs/controls.md ("Actions and bindings"): `up`/`down`/`left`/`right` are
//   the arrows and `KeyW`/`KeyS`/`KeyA`/`KeyD`, `confirm` is `Enter`, `Space`,
//   `back` is `Escape`, `pause` is `KeyP`, `mute` is `KeyM`.
//
// THE DRIVE. The how-to screen through `setScreen("howto")`, which enters it
// "exactly as confirming `HOW TO PLAY` does" (specs/instrumentation.md), so a
// build with a broken title menu fails the title's points and not this one. One
// frame, and the runs of text it drew are read as one corpus.
//
// THE TOLERANCE. Each key is looked for as a whole token in the frame's text,
// case ignored, since specs/ui.md "fixes no palette, no font, no layout, and no
// styling for any screen" and the sentences around the keys are the build's own
// words. The arrows are matched as the word the specification uses for them,
// and `WASD` as its four letters in order however they are separated, so a
// build that writes `W A S D` passes. `P` and `M` are matched as standalone
// letters, which is how the specification names them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

/** Each key of `BINDINGS`, and how the how-to screen may spell it. */
const KEYS: readonly (readonly [string, RegExp])[] = [
  ["the arrows", /arrow/i],
  ["WASD", /W[^A-Za-z0-9]*A[^A-Za-z0-9]*S[^A-Za-z0-9]*D/],
  ["Enter", /(?<![A-Za-z0-9])enter(?![A-Za-z0-9])/i],
  ["Space", /(?<![A-Za-z0-9])space(?![A-Za-z0-9])/i],
  ["Escape", /(?<![A-Za-z0-9])escape(?![A-Za-z0-9])/i],
  ["P", /(?<![A-Za-z0-9])P(?![A-Za-z0-9])/],
  ["M", /(?<![A-Za-z0-9])M(?![A-Za-z0-9])/],
];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("names the arrows, WASD, Enter, Space, Escape, P, and M", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "howto");
  const text = drawnText(calls).join(" ");

  assertDeepEqual(
    KEYS.filter(([, pattern]) => !pattern.test(text)).map(([key]) => key),
    [],
    "the keys BINDINGS gives each action, missing from the how-to frame",
  );
});
