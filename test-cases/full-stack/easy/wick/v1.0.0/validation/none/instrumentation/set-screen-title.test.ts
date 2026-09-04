// Wick — instrumentation/set-screen-title: `setScreen("title")` from `playing`
// enters `title` with `menuIndex` `0` and the idle run.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `title` row, "any | Discards the run exactly as `TITLE` on an end screen
// or `MAIN MENU` on `paused` does: the idle run"; and "Enters screen `name` ...
// with `menuIndex` `0`". The idle run is specs/state.md's, restated by
// `idleRun()`, `hurtFlash` `0` among its fields.
//
// WHY THE WORLD IS POSED AS IT IS. The run is given a clock, an enemy, and a
// contact hit off that enemy first, so "the idle run" after the call is a
// discard and not a run that was idle already, and the flash the hit armed is
// one more thing the discard has to clear. A rat's radius is 12 and
// `PLAYER_RADIUS` is 12 (specs/enemies.md, specs/world.md), so one posed 20
// units from the lamplighter's center overlaps and hits on the tick it stands
// there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  isolate,
  placeEnemyNear,
  poseScreen,
  type Harness,
} from "../harness";

/** How far from the lamplighter's center the rat is posed: 20, inside 12 + 12. */
const RAT_OFFSET = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards the run and enters title", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await h.debug.setTick(100);
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);
  const wounded = await h.step(1);
  assertNotEqual(wounded.run.hurtFlash, 0, "the flash the hit armed");

  const title = await poseScreen(h, "title");
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertEqual(title.menuIndex, 0, "menuIndex on entering title");
  assertDeepEqual(documentedRun(title.run), idleRun(), "the run on title");
});
