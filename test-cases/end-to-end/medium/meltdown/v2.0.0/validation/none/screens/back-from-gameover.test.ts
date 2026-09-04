// Meltdown — screens/back-from-gameover — Escape on the gameover screen returns to the title.
//
// THE RULE. `specs/screens.md`, on `victory` and `gameover`: "`back` returns to
// `title` from either of them." `specs/controls.md` binds `back` to `Escape` and
// resolves it in order: with nothing armed and nothing selected and the screen
// not `playing`, the case that applies is the last — "leave the current screen,
// as `specs/screens.md` states".
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO SCREENS. They are reached by different
// paths and are two cases of one branch, so a build that answers Escape on one
// and strands the player on the other must not grade as one that answers neither.
// The other screen is `screens.back-from-victory`'s.
//
// WHY IT IS ITS OWN ITEM ALONGSIDE `screens.end-menu-returns-to-title-from-gameover`.
// That one confirms the `MENU` row; this one presses `back`. They are two ways to
// the same screen and a build commonly wires one, so the failed grade names which
// of the two a player is missing.
//
// THE SCREEN IS POSED, NOT REACHED. `setScreen` sets the field alone and runs no
// entry effect (`specs/instrumentation.md`): how a run reaches gameover is
// `waves.game-over-at-zero-lives`'s requirement, and reaching it through the wave rules would
// make this verdict depend on them.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, posed outright, because the first two
// cases of `back` would otherwise take precedence — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
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

it("returns to the title when back is pressed on the gameover screen", async () => {
  await startRun(h);
  await h.debug.setScreen("gameover");
  await h.debug.setMenuIndex(0);
  await h.debug.setArmed(null);
  await h.debug.setSelected(null);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.screen, "gameover", "the screen the press is made on");
  assertNull(before.build, "nothing armed, so back leaves the screen");
  assertNull(before.selected, "nothing selected, so back leaves the screen");

  await tapAction(h, "back");
  await h.advance(1);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen back leaves the gameover screen on (specs/screens.md)",
  );
});
