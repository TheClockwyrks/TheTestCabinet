// screens/fallen-up-moves-highlight — up moves the fallen highlight up.
//
// WHAT THIS DECIDES. One thing, in one direction: on `fallen` with the second
// menu item highlighted, one `up` press leaves the highlight on the first.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`up` and `down` move the highlight
//   and wrap", over `END_ITEMS`, "`TRY AGAIN`, `TITLE`, in that order".
//   specs/controls.md ("What each screen reads"): the `fallen`, `dawn` row, and
//   `up` is `ArrowUp`, `KeyW`.
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one.
//
// WHY IT PRESSES TWICE. Nothing poses `menuIndex`: it "is `0` on entering every
// screen" (specs/state.md) and a key is the only thing that moves it, so the
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

it("moves the fallen highlight from the second item to the first", async () => {
  isolate(h);
  h.debug.setScreen("fallen");
  const staged = await tap(h, "ArrowDown");
  assertEqual(staged.screen, "fallen", "the screen ArrowUp is pressed on");
  assertEqual(staged.menuIndex, 1, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "fallen", "the screen ArrowUp left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after one ArrowUp");
});
