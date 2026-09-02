// Wick — screens/paused-menu-keys-inert: the menu actions do nothing on the
// pause screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`": "`up`,
// `down`, and `confirm` do nothing here." `specs/controls.md`, "What each
// screen reads", gives the `paused` row `pause`, `back`, and `mute` alone,
// and "An action a row omits does nothing on that screen"; the three keys
// pressed here are `ArrowUp`, `ArrowDown`, and `Enter`.
//
// THE DRIVE. An isolated `playing` world, paused through
// `setScreen("paused")` — which `specs/instrumentation.md` says enters the
// screen "exactly as `pause` does" — then
// the three presses in turn, each read back where it was made. The pause
// screen carries no menu, so `specs/ui.md`'s "on a screen with no highlight it
// stays `0`" is what `menuIndex` must still read.
//
// THE TOLERANCE. None: a screen name and an index, read after each press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The three keys the pause screen reads nothing of (specs/controls.md). */
const INERT_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "Enter"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stays paused with menuIndex 0 under up, down, and confirm", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the presses are made on");

  for (const code of INERT_KEYS) {
    const after = await tap(h, code);
    captureStill(h, "inert");
    assertEqual(after.screen, "paused", `the screen after ${code}`);
    assertEqual(after.menuIndex, 0, `menuIndex after ${code}`);
  }
});
