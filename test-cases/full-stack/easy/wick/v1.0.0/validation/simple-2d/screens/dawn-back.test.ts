// screens/dawn-back — back on dawn returns to the title screen.
//
// WHAT THIS DECIDES. One thing: a `back` press on `dawn` does what the
// `TITLE` item does, leaving the game on `title` with `menuIndex` 0 and the
// idle run. Which item the highlight rested on is beside the point: `back` is
// its own way out.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`back` does what `TITLE` does", and
//   `TITLE` "returns to `title` with `menuIndex = 0`".
//   specs/controls.md ("What each screen reads"): "`fallen`, `dawn` | none |
//   ... `back` returns to `title`; `mute`", and `back` is `Escape`.
//   specs/state.md ("The idle run"): "leaving a run for the title restores
//   them", the table restated as `IDLE_RUN`.
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. The run is loaded with a clock, kills, a
// level, and an enemy first, so the idle run read afterwards is a fact about
// what `back` discarded. No menu key is pressed on the way: the highlight rests
// where arriving left it.
//
// THE TOLERANCE. None: a screen name, a menu index, and the idle run's stored
// fields are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { IDLE_RUN } from "../constants";
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

it("returns to the title on the idle run when Escape is pressed on dawn", async () => {
  isolate(h, { level: 11 });
  spawnEnemyAt(h, "moth", 260, -60);
  h.debug.setTick(6000);
  h.debug.setKills(52);
  h.debug.setScreen("dawn");
  const before = h.snapshot();
  assertEqual(before.screen, "dawn", "the screen Escape is pressed on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen Escape left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at the title");
  assertDeepEqual(
    runFields(after.run),
    IDLE_RUN,
    "the run left behind, as specs/state.md's idle table fixes it",
  );
});
