// screens/chest-up-down-inert — up and down do nothing on the chest overlay.
//
// WHAT THIS DECIDES. One thing: the chest overlay carries no menu, so the two
// keys that walk one leave it exactly as they found it. The `confirm` that
// closes it is its own point, and so are `back` and `pause`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "`up`, `down`, `back`, and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): "`chest` | none | `confirm`
//   closes the overlay; `mute`", and "An action a row omits does nothing on
//   that screen. `menuIndex` is `0` on entering every screen, and on a screen
//   with no highlight it stays `0`."
//   specs/controls.md ("Actions and bindings"): `up` is `ArrowUp`, `down` is
//   `ArrowDown`.
//
// THE DRIVE. An isolated `playing` run, a chest at the lamplighter's center
// collected by one tick, then the two keys pressed one after another, each over
// its own frame, with the screen and the index read after each. The two share
// one point because they exercise the same rule the same way.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
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

it("leaves the chest overlay and its index untouched by ArrowUp and ArrowDown", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the keys are pressed on");
  assertEqual(opened.menuIndex, 0, "the index before the keys");

  for (const code of ["ArrowUp", "ArrowDown"]) {
    const after = await tap(h, code);
    assertEqual(after.screen, "chest", `the screen ${code} left the game on`);
    assertEqual(after.menuIndex, 0, `the index after ${code}`);
  }
  captureStill(h, "inert");
});
