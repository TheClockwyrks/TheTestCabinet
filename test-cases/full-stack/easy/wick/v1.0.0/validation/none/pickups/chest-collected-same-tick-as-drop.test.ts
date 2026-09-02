// pickups/chest-collected-same-tick-as-drop — a chest dropped at the
// lamplighter is collected on the tick it dropped.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick") orders the tick:
// phase 6 kills, where a dying enemy's "drop ... land[s] at its center, at rest
// for this tick"; phase 8 pickups, "Every pickup meeting the collection
// condition is collected, this tick's drops included"; and phase 12 overlays,
// "a tick that collected a chest opens the chest overlay". specs/world.md
// ("Collection") gives the condition: "the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`", and specs/enemies.md gives a mothwing rank `elite`, whose
// drop specs/world.md lists as a chest. So an elite killed on the lamplighter's
// own center drops its chest at distance `0`, the same tick collects it, and
// specs/progression.md ("The chest overlay") ends that tick with "`chestResult`
// records it, and `screen` becomes `chest` with `menuIndex` `0`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so the only pickup in the
// world is the one the kill left and nothing else opens an overlay. The kill is
// the real one: the mothwing's health is posed down with `setEnemyHp`, which
// "Sets enemy `id`'s `hp` to `hp`, a real number above `0` and at most its
// `maxHp`" (specs/instrumentation.md), and a level-1 Ember bolt posed on its
// center carries `10` (specs/weapons.md), so the next tick's hit takes it below
// `0` — a hit resolves whatever `effectMotion` holds. `enemyContact` is off, so
// standing on the elite costs no health and the run cannot end on that tick,
// which would open no overlay.
//
// THE TOLERANCE. None: a pickup count, a screen name, a menu index, and whether
// a result was recorded are all exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** The health the elite is posed at: low enough for one level-1 bolt to end it. */
const POSED_HP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no chest on the field and ends the drop's tick on the chest overlay", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const elite = await placeEnemy(h, "mothwing", at.x, at.y);
  await h.debug.setEnemyHp(elite.id, POSED_HP);
  await placeProjectile(h, "ember", at.x, at.y, 0, 0, 0);

  const after = await h.step(1);
  await captureStill(h, "same");

  assertEqual(after.run.kills, opened.run.kills + 1, "the kills the tick made");
  assertEqual(
    after.run.pickups.length,
    0,
    "the pickups left in the tick's snapshot",
  );
  assertEqual(after.screen, "chest", "the screen the drop's tick left");
  assertNotNull(after.run.chestResult, "the chest result the tick recorded");
});
