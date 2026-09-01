// Wick — instrumentation/set-enemy-hp-rejects-out-of-range: on a hound with
// `maxHp` 120, `setEnemyHp(id, 0)` and `setEnemyHp(id, 121)` each throw and
// leave `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyHp(id, hp)`): "a real number above `0` and at most its `maxHp`;
// anything else is invalid, since death is decided by the tick"; "the call
// throws rather than guessing what was meant".
//
// WHY THE WORLD IS POSED AS IT IS. The two nearest figures outside the domain,
// `0` at the low end and one past the maximum at the high end; the hound's
// `hp` is read exactly across each refused call, and it must still be alive.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertRejects } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws at 0 and above maxHp, leaving hp as it was", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", 300, 0);
  assertEqual(hound.maxHp, ENEMIES.hound.hp, "the hound's maxHp");

  for (const posed of [0, hound.maxHp + 1]) {
    await assertRejects(
      () => h.debug.setEnemyHp(hound.id, posed),
      `setEnemyHp(id, ${posed})`,
    );
    const after = mustEnemy(await h.snapshot(), hound.id);
    assertEqual(
      after.hp,
      hound.hp,
      `the hound's hp after the refused setEnemyHp(id, ${posed})`,
    );
  }
  await captureStill(h, "refused");
});
