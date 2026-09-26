// screens/esc-resumes — Escape on the pause screen returns to play, with the
// floor exactly as it was left.
//
// THE RULE. `specs/screens.md`, on `paused`: "`back` resumes, returning to
// `playing` with the floor exactly as it was left, which is what `RESUME` does."
// `specs/controls.md` resolves `back` in a stated order, and this is its fourth
// case: with nothing armed and nothing selected and the screen not `playing`,
// what applies is "leave the current screen, as `specs/screens.md` states".
//
// WHY IT IS ITS OWN ITEM. `controls.esc-pauses` reads only the OPENING — what
// `back` does on the `playing` screen — and `screens.pause-resume` reads what
// confirming the `RESUME` row does. Neither presses `back` on the pause screen,
// so without this item the fourth case of the back order is stated and never
// driven, and a build that pauses on Escape and then strands the player on the
// pause menu grades clean.
//
// THE FLOOR IS READ ON BOTH SIDES, because "exactly as it was left" is half the
// rule. A tower and a unit are posed before the pause, and both rosters are read
// back after the resume: a build that resumed by restarting the run reads two
// empty rosters, and one that resumed by rebuilding the floor reads different
// ids.
//
// THE PAUSE SCREEN IS POSED, NOT REACHED, because how it is reached is
// `controls.esc-pauses`'s and `controls.pause-key`'s requirement. What is graded
// here is the press made ON it.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, posed outright, because the first two
// cases of `back` would otherwise take precedence — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `back` to. */
const BACK = BINDINGS.back[0];

/**
 * The anchor the tower stands on: a quiet interior tile, clear of both vents'
 * corridors and of the panel's strip (specs/floor.md).
 *
 * Where it stands is arrangement rather than a figure this check compares
 * against, and it is stated here rather than taken from another group's own site
 * table: nothing outside this suite decides where this tower goes.
 */
const SITE = { col: 4, row: 4 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to play when Escape is pressed on the pause screen", async () => {
  startRun(h);
  const tower = poseTower(h, "arc", SITE.col, SITE.row);
  const unit = poseWalker(h, "mote", "left");

  h.debug.setArmed(null);
  h.debug.setSelected(null);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(0);
  await h.advance(1);

  const paused = h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "posing: the screen the press is made on (specs/screens.md)",
  );
  assertNull(
    paused.build,
    "posing: nothing is armed, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );
  assertNull(
    paused.selected,
    "posing: nothing is selected, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    [paused.towers.map((t) => t.id), paused.surge.map((u) => u.id)],
    [[tower], [unit]],
    "posing: the floor the pause was opened over",
  );

  await h.tap(BACK);
  captureStill(h, "resumed");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `${BACK} on the pause menu: the screen it resumes to (specs/screens.md)`,
  );
  assertDeepEqual(
    [after.towers.map((t) => t.id), after.surge.map((u) => u.id)],
    [[tower], [unit]],
    "the two rosters the resume left standing, which specs/screens.md keeps " +
      "exactly as they were",
  );
});
