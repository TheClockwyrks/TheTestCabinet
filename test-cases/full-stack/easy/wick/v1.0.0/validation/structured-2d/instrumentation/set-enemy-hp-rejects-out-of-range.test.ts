// Wick — instrumentation/set-enemy-hp-rejects-out-of-range: on a hound with
// `maxHp` 120, `setEnemyHp(id, 0)` and `setEnemyHp(id, 121)` each throw and
// leave hp as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyHp(id, hp)`: "a real number above `0` and at most its `maxHp`;
// anything else is invalid, since death is decided by the tick"; an invalid
// argument throws.
//
// THE POSE. An isolated run with a hound, each call, and the whole snapshot
// compared with the one before them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws at 0 and above maxHp, changing nothing", async () => {
  isolate(h);
  const id = placeEnemy(h, "hound", 300, 0);
  const before = h.snapshot();

  assertThrows(() => h.debug.setEnemyHp(id, 0), "setEnemyHp(id, 0)");
  assertThrows(
    () => h.debug.setEnemyHp(id, ENEMIES.hound.hp + 1),
    "setEnemyHp(id, 121)",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(after, before, "snapshot after the refused calls");
});
