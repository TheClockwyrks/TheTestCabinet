// screens/title-up-moves-highlight — up moves the title highlight up.
//
// WHAT THIS DECIDES. One thing, in one direction: on `title` with the second
// of the three items highlighted, one `up` press leaves the highlight on the
// first item.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`up` and `down` move the highlight by one item and
//   wrap at both ends".
//   specs/controls.md ("Actions and bindings"): `up` is `ArrowUp`, `KeyW`, read
//   as an edge off `playing`.
//
// THE DRIVE, AND WHY IT PRESSES TWICE. The surface carries no pose for
// `menuIndex`: it "is `0` on entering every screen" (specs/state.md) and a key
// is the only thing that moves it, so the precondition this point needs, the
// highlight resting on the second item, is reached with one `ArrowDown` and
// asserted before the press this point is about. A build whose `down` is broken
// therefore fails this point too, which is the honest cost of a state the
// surface does not pose; the reading that follows is about `up` alone.
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the title highlight from the second item to the first", async () => {
  h.reset();
  const staged = await tap(h, "ArrowDown");
  assertEqual(staged.screen, "title", "the screen ArrowUp is pressed on");
  assertEqual(staged.menuIndex, 1, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "title", "the screen ArrowUp left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after one ArrowUp");
});
