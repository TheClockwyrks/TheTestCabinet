// Wick — instrumentation/snapshot-hurt-flash: `run.hurtFlash` is in the snapshot
// and reads the seconds left of the lamplighter's hurt flash — `HURT_FLASH`
// (`0.3`) on the tick a contact hit lands, `0` on a run that has taken none.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape"):
// "`hurtFlash: <number>, // seconds left of the hurt flash`", inside `run`, and
// "Every other field ... is read straight off the game's state, so what the
// snapshot reports is what the game holds". specs/world.md ("Contact damage"):
// "The lamplighter carries `hurtFlash`, a timer that counts down with the
// contact cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on which
// a contact hit lands", with "Seconds the hurt flash runs | `HURT_FLASH` |
// `0.3`". specs/state.md's idle run gives `hurtFlash` `0`, so a run that has
// taken no hit reads `0`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `enemyContact` alone
// released, and a rat posed 20 units from the lamplighter's center: a rat's
// radius is 12 and `PLAYER_RADIUS` is 12 (specs/enemies.md, specs/world.md), so
// it overlaps, and an enemy "spawns ... with ... `contactCooldown` `0`", a timer
// which "stays due on every tick until it is set again", so the hit lands on the
// first tick. The field is read before that tick as well, where nothing has hit,
// so the `HURT_FLASH` afterwards is the hit's.
//
// THE TOLERANCE. `FLOAT_TOL`, an absolute span in seconds: `0.3` is what the
// state carries and the allowance covers a build that arrives at it through an
// arithmetic of its own. The nearest wrong answer a conformant timer could hold
// is `HURT_FLASH − TICK_DT`, a sixtieth of a second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, HURT_FLASH } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
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

it("reads the seconds left of the hurt flash", async () => {
  const isolated = await isolate(h, { on: ["enemyContact"] });
  assertEqual(
    typeof isolated.run.hurtFlash,
    "number",
    "snapshot().run.hurtFlash",
  );
  assertEqual(
    isolated.run.hurtFlash,
    0,
    "run.hurtFlash on a run that has taken no hit",
  );

  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);
  const hit = await h.step(1);
  await captureStill(h, "flash");

  assertNear(
    hit.run.hurtFlash,
    HURT_FLASH,
    FLOAT_TOL,
    "run.hurtFlash on the tick a contact hit landed",
  );
});
