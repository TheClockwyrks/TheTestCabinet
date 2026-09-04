// Meltdown — screens/back-from-mode-select: leaving the mode list returns to the
// title.
//
// THE RULE. specs/screens.md, `modeselect`: "`back` returns to `title`."
// specs/controls.md reaches that through the fourth case of its resolution order,
// "Otherwise: leave the current screen".
//
// THIS IS THE OTHER END OF THE SAME WALK, AND IT IS ITS OWN ITEM. A build that
// returns from the difficulty list but strands the player on the mode list has
// one back wired and not the other, and must grade differently from a build with
// both. So nothing here reads the difficulty list:
// `screens.back-from-difficulty-select` owns it.
//
// AND IT MUST NOT PAUSE OR START. specs/controls.md's third case opens the pause
// screen on `back`, but only when "The screen is `playing`" — which the mode list
// is not. A build that pauses or opens a run from a menu press reads `paused` or
// `playing` here and fails, which is right.
//
// THE PRECONDITION IS PART OF THE RULE: nothing armed and nothing selected, so
// `back`'s first two cases do not apply and the fourth is the one under test. Both
// are read back before the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when back is pressed on the mode list", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await tapAction(h, "back");
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen back leaves the mode list on",
  );
});
