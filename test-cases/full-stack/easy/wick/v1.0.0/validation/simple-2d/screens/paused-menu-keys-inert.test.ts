// screens/paused-menu-keys-inert — up, down, and confirm do nothing on paused.
//
// WHAT THIS DECIDES. One thing: the pause screen carries no menu, so the three
// keys that work one leave it exactly as they found it. The two keys the screen
// DOES read, `pause` and `back`, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`up`, `down`, and `confirm` do nothing here."
//   specs/controls.md ("What each screen reads"): the `paused` row lists
//   `pause`, `back`, and `mute` alone, and "An action a row omits does nothing
//   on that screen. `menuIndex` is `0` on entering every screen, and on a screen
//   with no highlight it stays `0`."
//   specs/controls.md ("Actions and bindings"): `up` is `ArrowUp`, `down` is
//   `ArrowDown`, and `confirm` is `Enter`.
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md), then the three keys pressed one after another,
// each over its own frame, with the screen and the highlight read after each.
// The three share one point because they exercise the same rule the same way:
// a key the screen does not read changes nothing.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves paused and its index untouched by ArrowUp, ArrowDown, and Enter", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the keys are pressed on");
  assertEqual(before.menuIndex, 0, "the index before the keys");

  for (const code of ["ArrowUp", "ArrowDown", "Enter"]) {
    const after = await tap(h, code);
    assertEqual(after.screen, "paused", `the screen ${code} left the game on`);
    assertEqual(after.menuIndex, 0, `the index after ${code}`);
  }
  captureStill(h, "inert");
});
