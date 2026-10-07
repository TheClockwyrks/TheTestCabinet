// Meltdown — screens/back-from-mode-select: Escape returns from the mode list to
// the title.
//
// THE RULE. `specs/screens.md`, on `modeselect`: "`back` returns to `title`."
// `specs/controls.md` binds `back` to `Escape` and resolves it in order: with
// nothing armed and nothing selected and the screen not `playing`, the case that
// applies is the last — "leave the current screen, as `specs/screens.md` states".
//
// THE DESTINATION IS THE DISTINGUISHING READING. A build that answers Escape
// nowhere reads `modeselect`, one that backed out one screen too far — there being
// no screen behind the title — reads something else again, and one that took the
// press as a confirm reads `difficultyselect` or `playing`.
//
// WHY THIS IS ITS OWN ITEM ALONGSIDE `screens.back-from-difficulty-select`. The
// two screens' ways back lead to DIFFERENT places, so a build that hard-wired
// Escape to one destination passes exactly one of the two items, and the failed
// grade names which screen strands the player.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, posed outright, because the first two
// cases of `back` would otherwise take precedence — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title when Escape is pressed on the mode list", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setArmed(null);
  await debug.setSelected(null);
  await debug.setScreen("modeselect");
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(posed.build, null, "nothing armed, so back leaves the screen");
  assertEqual(
    posed.selected,
    null,
    "nothing selected, so back leaves the screen",
  );

  await tapAction(h, "back");
  await h.advance(1);
  await captureStill(h, "back");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    `${BINDINGS.back}: the screen the mode list's way back leads to`,
  );
});
