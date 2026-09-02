// screens/paused-back-abandons — back on paused abandons the run.
//
// WHAT THIS DECIDES. One thing: a `back` press on `paused` leaves the game on
// `title` with `menuIndex` 0 and the idle run, so the paused night is abandoned
// rather than kept behind the title.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`back` abandons the run and returns to `title`
//   with `menuIndex = 0`."
//   specs/state.md ("The idle run"): "`run` holds the values below whenever
//   `screen` is `title` or `howto` ... leaving a run for the title restores
//   them", the table restated as `IDLE_RUN`.
//   specs/instrumentation.md (`setScreen`): "`title` | any | Discards the run
//   exactly as `TITLE` on an end screen or `back` on `paused` does: the idle
//   run."
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. An isolated `playing` run loaded with a clock, kills, a level, an
// enemy, and a gem, so the idle run read afterwards is a fact about what `back`
// discarded rather than about a run that held nothing; paused through
// `setScreen("paused")`, which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md); then one real `Escape` press over one frame,
// which ticks nothing, since `title` advances nothing (specs/ui.md).
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
  isolate(h, { level: 9 });
  spawnEnemyAt(h, "moth", 220, 40);
  spawnGemAt(h, "medium", 0, 300);
  h.debug.setTick(9000);
  h.debug.setKills(64);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen Escape is pressed on");

  const after = await tap(h, "Escape");
  captureStill(h, "abandoned");

  assertEqual(after.screen, "title", "the screen Escape left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at the title");
  assertDeepEqual(
    runFields(after.run),
    IDLE_RUN,
    "the run left behind, as specs/state.md's idle table fixes it",
  );
});
