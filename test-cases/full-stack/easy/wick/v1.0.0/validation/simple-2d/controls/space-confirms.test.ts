// controls/space-confirms — Space accepts the highlighted menu entry.
//
// WHAT THIS DECIDES. One thing: the second key bound to `confirm`, `Space`,
// does on the title what `Enter` does, starting a run. `Enter` itself is
// graded by screens/title-confirm-light-the-lamp, and the fresh run that
// confirming leaves behind by screens/fresh-run-state; this point is about the
// KEY alone.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`confirm` | `Enter`, `Space` |
//   edge | accepts the highlighted item", and "The two keys bound to an action
//   are interchangeable: `KeyW` does exactly what `ArrowUp` does wherever `up`
//   is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`confirm` takes
//   the highlighted item".
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving", and the item at
//   `0` is `LIGHT THE LAMP`, which "Starts a fresh run, defined below, and sets
//   `screen = playing`."
//
// THE DRIVE. The title is reached through `reset` alone, so no other key is
// pressed on the way: `reset` "Restores every declared field of the game's
// state to its title-screen value: the `title` screen with `menuIndex` `0`"
// (specs/instrumentation.md). The screen and the highlight are read back
// before the press, so a build that could not be posed onto the title fails
// here rather than deciding nothing. The press is a REAL `Space` dispatched at
// the engine's own event target, held for exactly the one frame that delivers
// its edge ("A press is therefore news for exactly one frame", the engine's
// input documentation), which is what `tap` does.
//
// THE TOLERANCE. None: a screen name is an exact comparison.

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

it("starts a run when Space is pressed on the title with LIGHT THE LAMP highlighted", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  assertEqual(title.menuIndex, 0, "the highlight before the press");

  const after = await tap(h, "Space");
  captureStill(h, "space");

  assertEqual(after.screen, "playing", "the screen Space left the game on");
});
