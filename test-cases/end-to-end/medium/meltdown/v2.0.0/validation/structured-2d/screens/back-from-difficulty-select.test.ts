// Meltdown — screens/back-from-difficulty-select: leaving the difficulty list
// returns to the mode list.
//
// THE RULE. specs/screens.md, `difficultyselect`: "`back` returns to
// `modeselect`." specs/controls.md resolves `back` "in this order, taking the
// first case that applies", and the fourth and last case is "Otherwise: leave the
// current screen, as `specs/screens.md` states".
//
// IT RETURNS TO THE SCREEN IT CAME FROM, not to the title. That is the reading
// that matters and the one a wrong build gets wrong: a build that treats `back` as
// "go to the title" strands the player who wanted a different mode, and reads
// `title` here. So the destination is asserted exactly, and `title` is named as
// the wrong answer this check exists to catch.
//
// THE PRECONDITION IS PART OF THE RULE. `back`'s first three cases — a placement
// armed, a tower selected, the screen `playing` — all fail to apply on a menu
// screen, so the fourth is reached; the reset leaves nothing armed and nothing
// selected and both are read back before the press, so a build that armed or
// selected something of its own accord is caught posing rather than judged on a
// case it was never in.
//
// EACH BACK IS ITS OWN ITEM. A build that wired one screen's back and not
// another's is an ordinary defect, and it must grade differently from one with
// every back working; `screens.back-from-mode-select` and
// `screens.back-from-howto` read the other two.
//
// THE ACTION, NOT THE KEY. The press goes through the `back` action's own binding
// out of the case-fixed `BINDINGS` table; that `Escape` reaches the action is
// `controls.esc-pauses`'s half of the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
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

it("returns to the mode list when back is pressed on the difficulty list", async () => {
  resetTo(h);
  h.debug.setScreen("difficultyselect");
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "difficultyselect",
    "the screen the scenario is posed on",
  );
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await tapAction(h, "back");
  captureStill(h, "back");

  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "title",
    "back from the difficulty list steps back one screen rather than to the title",
  );
  assertEqual(
    after.screen,
    "modeselect",
    "the screen back leaves the difficulty list on",
  );
});
