// instrumentation/set-enemy-hp-rejects-out-of-range — on a hound with maxHp
// 120, `setEnemyHp(id, 0)` and `setEnemyHp(id, 121)` each throw and leave hp
// as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyHp`: "a
// real number above `0` and at most its `maxHp`; anything else is invalid,
// since death is decided by the tick"; an invalid argument "throws rather than
// guessing what was meant".
//
// THE POSE. An isolated run, a hound with hp posed to a figure between the
// bounds, each refused call, and the whole snapshot against the reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const HELD_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses 0 and a value above maxHp", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "hound", 300, 0);
  h.debug.setEnemyHp(id, HELD_HP);
  const before = h.snapshot();

  for (const hp of [0, ENEMIES.hound.hp + 1]) {
    assertThrows(() => h.debug.setEnemyHp(id, hp), `setEnemyHp(id, ${hp})`);
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after setEnemyHp(id, ${hp}) was refused`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
