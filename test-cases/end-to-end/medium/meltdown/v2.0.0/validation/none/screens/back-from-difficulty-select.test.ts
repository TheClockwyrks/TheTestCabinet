// Meltdown — screens/back-from-difficulty-select: Escape returns from the
// difficulty list to the mode list.
//
// THE RULE. `specs/screens.md`, on `difficultyselect`: "`back` returns to
// `modeselect`." `specs/controls.md` binds `back` to `Escape` and resolves it in
// order: with nothing armed and nothing selected and the screen not `playing`, the
// case that applies is the last — "leave the current screen, as
// `specs/screens.md` states".
//
// THE DESTINATION IS THE DISTINGUISHING READING. The difficulty list is the one
// screen in the game whose way back is neither the title nor a resumed run, so
// every wrong model reads a different screen: a build that always backs out to the
// title reads `title`, one that treats Escape as a confirm reads `playing`, and one
// that answers Escape nowhere reads `difficultyselect`.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, posed outright, because the first two
// cases of `back` would otherwise take precedence and this item would be reading
// one of them. Those two are `controls.esc-cancels-a-held-placement` and
// `controls.esc-deselects`.
//
// THAT ESCAPE IS THE KEY AT ALL is `controls.esc-pauses`'s reading on the playing
// screen; this item reads where the difficulty list's way back leads.

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

it("returns to the mode list when Escape is pressed on the difficulty list", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setArmed(null);
  await debug.setSelected(null);
  await debug.setScreen("difficultyselect");
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "difficultyselect",
    "the screen the scenario is posed on",
  );
  assertEqual(posed.build, null, "nothing armed, so back leaves the screen");
  assertEqual(posed.selected, null, "nothing selected, so back leaves the screen");

  await tapAction(h, "back");
  await h.advance(1);
  await captureStill(h, "back");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "modeselect",
    `${BINDINGS.back}: the screen the difficulty list's way back leads to`,
  );
});
