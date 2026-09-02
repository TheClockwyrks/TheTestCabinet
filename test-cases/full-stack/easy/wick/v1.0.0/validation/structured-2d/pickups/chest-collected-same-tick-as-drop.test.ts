// pickups/chest-collected-same-tick-as-drop — a chest dropped at the
// lamplighter is collected on the tick it dropped.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("One tick") orders the
// tick: phase 6, where a dying enemy's "drop ... land[s] at its center, at rest
// for this tick"; phase 8, "Every pickup meeting the collection condition is
// collected, this tick's drops included"; and phase 12, "a tick that collected
// a chest opens the chest overlay". ("Collection") gives the condition: "the
// distance between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", and `specs/enemies.md`
// ("Drops") gives an `elite` rank "One chest", the rank a mothwing carries. So
// an elite killed on the lamplighter's own center drops its chest at distance
// `0`, the same tick collects it, and `specs/progression.md` ("The chest
// overlay") ends that tick with "`chestResult` records it, and `screen` becomes
// `chest` with `menuIndex` `0`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so the only pickup in the
// world is the one the kill left and nothing else opens an overlay. The kill is
// a real one: a level-1 Oil Splash puddle posed on the elite's center overlaps
// it certainly and "pulses first on the next tick" whatever the driver switches
// hold (`specs/instrumentation.md`, `spawnPuddle`), and the elite's `hp` is
// posed to that row's `4` with `setEnemyHp`, "a real number above `0` and at
// most its `maxHp`", so the one tick this check runs takes it to `0`. Standing
// the elite on the lamplighter's center is what puts the chest at distance `0`;
// `enemyContact` is off, so standing there costs no health and the run cannot
// end on that tick, which would open no overlay at all.
//
// THE TOLERANCE. None: a pickup count, a screen name, a menu index, and whether
// a result was recorded are all exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { OIL_SPLASH_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no chest on the field and ends the drop's tick on the chest overlay", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const elite = placeEnemy(h, "mothwing", at.x, at.y);
  h.debug.setEnemyHp(elite, PULSE_DAMAGE);
  placePuddle(h, "oil-splash", at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "same");

  assertEqual(after.run.kills, opened.run.kills + 1, "the kills the tick made");
  assertEqual(
    after.run.pickups.length,
    0,
    "the pickups left in the snapshot of the tick that dropped a chest at the lamplighter (specs/world.md, One tick, phase 8)",
  );
  assertEqual(after.screen, "chest", "the screen the drop's tick left");
  assertNotNull(after.run.chestResult, "the chest result the tick recorded");
});
