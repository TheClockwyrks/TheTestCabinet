// Wick — instrumentation/set-screen-title: `setScreen('title')` from `playing`
// enters `title` with `menuIndex` 0 and the idle run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `title` from any: "Discards the run exactly as
// `TITLE` on an end screen or `back` on `paused` does: the idle run", and the
// heading: "with `menuIndex` `0`". `specs/state.md`, "The idle run", is the
// table `IDLE_RUN` transcribes.
//
// THE POSE. An isolated run disturbed enough that a discard is told from a
// keep — kills, an enemy, a gem, a moved lamplighter — then the pose, read at
// the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the run and enters the title", async () => {
  isolate(h);
  h.debug.setKills(5);
  h.debug.setPlayerPosition(300, -120);
  placeEnemy(h, "moth", 200, 0);
  placeGem(h, "small", 100, 100);

  h.debug.setScreen("title");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "title");

  assertEqual(after.screen, "title", "screen after setScreen('title')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('title')");
  assertDeepEqual(after.run, IDLE_RUN, "run after setScreen('title')");
});
