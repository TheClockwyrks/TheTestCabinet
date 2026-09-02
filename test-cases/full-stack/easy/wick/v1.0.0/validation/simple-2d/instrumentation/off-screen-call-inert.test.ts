// instrumentation/off-screen-call-inert — `setHp(10)`, `spawnEnemy('moth',
// 0, 0)`, `setTick(100)`, and `setWeapon(0, 'pin', 1)` issued on title, and
// `setPlayerPosition(5, 5)` issued on levelup, each leave the state exactly
// as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "A call on a screen the operation does not apply to leaves the state
// exactly as it was, and each operation names the screens it applies to";
// `setHp`, `setTick`, `setWeapon`, and `setPlayerPosition` apply "on a run
// screen", `spawnEnemy` "on `playing` and `paused`", and "A run screen ...
// means `playing` or `paused`".
//
// THE POSE. A fresh reset for the four title calls, and an isolated run with
// the overlay opened by a queued level-up and one tick for the fifth; each
// call, then the whole snapshot against the reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the state untouched by a call off its screens", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the four calls are issued on");
  const onTitle: readonly [string, () => void][] = [
    ["setHp(10)", () => h.debug.setHp(10)],
    ["spawnEnemy('moth', 0, 0)", () => h.debug.spawnEnemy("moth", 0, 0)],
    ["setTick(100)", () => h.debug.setTick(100)],
    ["setWeapon(0, 'pin', 1)", () => h.debug.setWeapon(0, "pin", 1)],
  ];
  for (const [what, call] of onTitle) {
    call();
    assertDeepEqual(h.snapshot(), title, `the snapshot after ${what} on title`);
  }

  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the fifth call is issued on",
  );
  h.debug.setPlayerPosition(5, 5);
  assertDeepEqual(
    h.snapshot(),
    overlay,
    "the snapshot after setPlayerPosition(5, 5) on levelup",
  );

  await h.tick(1);
  captureStill(h, "inert");
});
