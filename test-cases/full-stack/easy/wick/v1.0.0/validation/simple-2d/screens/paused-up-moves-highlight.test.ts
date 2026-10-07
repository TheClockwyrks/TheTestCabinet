// screens/paused-up-moves-highlight — up moves the pause highlight up.
//
// WHAT THIS DECIDES. One thing, in one direction: on `paused` with the second
// item highlighted, one `up` press leaves the highlight on the first.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight and wrap at both ends", over `PAUSE_ITEMS`, "`RESUME`,
//   `MAIN MENU`, in that order".
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping", and `up` is `ArrowUp`, `KeyW`.
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md), so a build with a broken pause key fails its own
// point and not this one.
//
// WHY IT PRESSES TWICE. Nothing poses `menuIndex`: it "is `0` on entering every
// screen" (specs/controls.md) and a key is the only thing that moves it, so the
// second item is reached with one `ArrowDown` and asserted before the press
// this point is about. A build whose `down` is broken fails this point too,
// which is the honest cost of a state the surface does not pose.
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

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

it("moves the pause highlight from the second item to the first", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const staged = await tap(h, "ArrowDown");
  assertEqual(staged.screen, "paused", "the screen ArrowUp is pressed on");
  assertEqual(staged.menuIndex, 1, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "paused", "the screen ArrowUp left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after one ArrowUp");
});
