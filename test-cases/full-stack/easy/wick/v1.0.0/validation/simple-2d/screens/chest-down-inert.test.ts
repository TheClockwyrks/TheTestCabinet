// screens/chest-down-inert — `down` does nothing on the chest overlay.
//
// WHAT THIS DECIDES. One thing: the chest overlay carries no menu, so `down`
// leaves it exactly as it found it. The other arrow is
// `screens/chest-up-inert`'s, the `confirm` that closes the overlay is its
// own point, and so are `back` and `pause`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "`up`, `down`, `back`, and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): "`chest` | none | `confirm`
//   closes the overlay; `mute`", and "An action a row omits does nothing on
//   that screen. `menuIndex` is `0` on entering every screen but `title` ... and
//   on a screen with no highlight it stays `0`."
//   specs/controls.md ("Actions and bindings"): `down` is `ArrowDown`.
//
// THE DRIVE. An isolated `playing` run, a chest at the lamplighter's center
// collected by one tick, then one `ArrowDown` press over its own frame, with the
// screen and the index read after it.
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

it("leaves the chest overlay and its index untouched by ArrowDown", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the key is pressed on");
  assertEqual(opened.menuIndex, 0, "the index before the key");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen ArrowDown left the game on");
  assertEqual(after.menuIndex, 0, "the index after ArrowDown");
});
