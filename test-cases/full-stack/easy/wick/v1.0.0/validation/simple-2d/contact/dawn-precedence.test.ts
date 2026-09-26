// contact/dawn-precedence — a tick on which the clock reaches 36000 AND hp falls
// to 0 or below ends the run at dawn, not fallen.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "Dawn is checked
// first, so a tick on which both conditions hold ends the run at dawn."
//
// THE POSE. An isolated night with enemyContact on: the clock posed to 35999
// through setTick so the next tick reaches 36000; hp posed to 1 through setHp;
// one moth, whose damage is 5 (specs/enemies.md), posed 5 units along +x
// inside the 22 its radius 10 plus PLAYER_RADIUS sum to, held there with
// enemyMotion off. Its cooldown is 0 at spawn, so its hit lands on that same
// tick, in phase 7, and leaves hp at −4 before phase 11 reads both conditions.
//
// WHY THE HIT IS CHECKED TOO. The item is about the ORDER of two endings that
// both hold, so the scenario has to have reached both: a moth that never hit
// would leave the dawn ending standing alone and prove nothing about
// precedence. hp at or below 0 after the tick is that check.
//
// THE TOLERANCE. None: the screen is discrete, and the hit is read as hp at
// or below 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy whose hit lands on the dawn tick: damage 5, radius 10. */
const TYPE = "moth";

/** Where the moth is posed: 5 units along +x, inside the overlap. */
const OFFSET = 5;

/** The hp posed: below the moth's damage, so its hit meets the fallen condition. */
const POSED_HP = 1;

/** The last tick of the night, one short of dawn. */
const POSED_TICK = DAWN_TICK - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run at dawn when the dawn tick's hit also takes hp below 0", async () => {
  isolate(h);
  enable(h, "enemyContact");
  h.debug.setTick(POSED_TICK);
  h.debug.setHp(POSED_HP);
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "precedence");

  assertEqual(after.run.tick, DAWN_TICK, "the clock reached dawn on the tick");
  assertLessThanOrEqual(
    after.run.player.hp,
    0,
    "the moth's hit landed on the same tick, so both conditions held",
  );
  assertEqual(after.screen, "dawn", "screen when dawn and falling coincide");
});
