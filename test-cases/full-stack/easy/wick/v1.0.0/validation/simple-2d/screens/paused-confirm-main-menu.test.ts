// screens/paused-confirm-main-menu — MAIN MENU on paused abandons the run.
//
// WHAT THIS DECIDES. One thing: `confirm` on the pause menu's second item
// leaves the game on `title` with `menuIndex` 0 and the idle run, so the paused
// night is abandoned rather than kept behind the title. The menu's other item
// is `paused-confirm-resume`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): the item table, "`MAIN MENU` | Abandons the run and
//   returns to `title` with `menuIndex = 0`", with `PAUSE_ITEMS` "`RESUME`,
//   `MAIN MENU`, in that order", and "`confirm` takes the highlighted item".
//   specs/state.md ("The idle run"): "`run` holds the values below whenever
//   `screen` is `title`, `howto`, or `almanac` ... leaving a run for the title
//   restores them", the table restated as `IDLE_RUN`.
//   specs/instrumentation.md (`setScreen`): "`title` | any | Discards the run
//   exactly as `TITLE` on an end screen or `MAIN MENU` on `paused` does: the
//   idle run."
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. An isolated `playing` run loaded with a clock, kills, a level, an
// enemy, and a gem, so the idle run read afterwards is a fact about what
// `MAIN MENU` discarded rather than about a run that held nothing; paused
// through `setScreen("paused")`, which enters the screen "Exactly as `pause`
// does" (specs/instrumentation.md). The second item is reached with the menu's
// own `ArrowDown`, which the surface poses no other way, and asserted before
// the `Enter` this point is about. The pressing frame ticks nothing, since
// `title` advances nothing (specs/ui.md).
//
// THE TOLERANCE. None: a screen name, a menu index, and the idle run's stored
// fields are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { IDLE_RUN, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  spawnGemAt,
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

it("returns to the title on the idle run", async () => {
  isolate(h, { level: 8 });
  spawnEnemyAt(h, "moth", 180, -140);
  spawnGemAt(h, "large", -240, 60);
  h.debug.setTick(11400);
  h.debug.setKills(97);
  h.debug.setScreen("paused");

  const wanted = PAUSE_ITEMS.indexOf("MAIN MENU");
  let staged = h.snapshot();
  for (let press = 0; press < wanted; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "paused", "the screen Enter is pressed on");
  assertEqual(staged.menuIndex, wanted, "the highlight resting on MAIN MENU");

  const after = await tap(h, "Enter");
  captureStill(h, "title");

  assertEqual(after.screen, "title", "the screen Enter left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at the title");
  assertDeepEqual(
    runFields(after.run),
    IDLE_RUN,
    "the run left behind, as specs/state.md's idle table fixes it",
  );
});
