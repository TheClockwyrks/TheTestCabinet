// Meltdown — screens/esc-resumes — Escape on the pause screen returns to play, with the
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
import { assertDeepEqual, assertEqual } from "../assert";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
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

it("returns to play when Escape is pressed on the pause screen", async () => {
  const { debug } = h;
  await startRun(h);
  const site = freeSite(0);
  const tower = await poseTower(h, "arc", site.col, site.row);
  const unit = await poseWalker(h, "mote", "left");

  await debug.setArmed(null);
  await debug.setSelected(null);
  await debug.setScreen("paused");
  await debug.setMenuIndex(0);
  await h.advance(1);

  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the scenario is posed on");
  assertEqual(paused.build, null, "nothing armed, so back leaves the screen");
  assertEqual(
    paused.selected,
    null,
    "nothing selected, so back leaves the screen",
  );
  assertDeepEqual(
    [paused.towers.map((t) => t.id), paused.surge.map((u) => u.id)],
    [[tower], [unit]],
    "the floor the pause was opened over",
  );

  await tapAction(h, "back");
  await h.advance(1);
  await captureStill(h, "resumed");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    "the screen back leaves the pause menu on (specs/screens.md, paused)",
  );
  assertDeepEqual(
    [after.towers.map((t) => t.id), after.surge.map((u) => u.id)],
    [[tower], [unit]],
    "the two rosters the resume left standing, which specs/screens.md keeps " +
      "exactly as they were",
  );
});
