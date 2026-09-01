// screens/fallen-title — TITLE on fallen returns to the title screen.
//
// WHAT THIS DECIDES. One thing: `confirm` on the end screen's second item
// leaves the game on `title` with `menuIndex` 0 and the idle run, so the ended
// night is let go of rather than kept behind the front door.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`confirm` takes the highlighted item:
//   ... `TITLE` returns to `title` with `menuIndex = 0`", with `END_ITEMS`
//   "`TRY AGAIN`, `TITLE`, in that order".
//   specs/state.md ("The idle run"): "`run` holds the values below whenever
//   `screen` is `title` or `howto` ... leaving a run for the title restores
//   them", the table restated as `IDLE_RUN`.
//   specs/instrumentation.md (`setScreen`): "`title` | any | Discards the run
//   exactly as `TITLE` on an end screen or `back` on `paused` does: the idle
//   run."
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. The run is loaded with a clock, kills, a
// level, and an enemy first, so the idle run read afterwards is a fact about
// what `TITLE` discarded. The second item is reached with the menu's own
// `ArrowDown`, which the surface poses no other way, and asserted before the
// `Enter` this point is about.
//
// THE TOLERANCE. None: a screen name, a menu index, and the idle run's stored
// fields are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS, IDLE_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
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

it("returns to the title on the idle run from the fallen screen", async () => {
  isolate(h, { level: 11 });
  spawnEnemyAt(h, "moth", 260, -60);
  h.debug.setTick(6000);
  h.debug.setKills(52);
  h.debug.setScreen("fallen");

  const wanted = END_ITEMS.indexOf("TITLE");
  let staged = h.snapshot();
  for (let press = 0; press < wanted; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "fallen", "the screen Enter is pressed on");
  assertEqual(staged.menuIndex, wanted, "the highlight resting on TITLE");

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
