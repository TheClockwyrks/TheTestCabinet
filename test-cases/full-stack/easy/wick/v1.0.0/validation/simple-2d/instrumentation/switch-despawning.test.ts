// instrumentation/switch-despawning — with `setDespawning(false)`, a moth
// posed 1300 units from the lamplighter stays alive across 60 ticks; with the
// switch back on it is removed on the next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `despawning`: on, "Commons beyond `DESPAWN_DISTANCE` are
// removed"; off, "Nothing is removed by distance". specs/enemies.md,
// "Despawning": "Each tick `despawning` is on, every common enemy whose center
// is farther than `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's
// center is removed".
//
// THE POSE. An isolated run, a moth at 1300 units with `enemyMotion` off so
// it cannot walk back inside the distance. Sixty ticks with the switch off
// leave it; one tick with the switch on removes it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertUndefined } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const POSED_DISTANCE = DESPAWN_DISTANCE + 100;
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the distant moth while off and removes it on the next tick when on", async () => {
  isolate(h);
  const moth = spawnEnemyAt(h, "moth", POSED_DISTANCE, 0);

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "held");
  assertDefined(
    enemyById(held, moth),
    "the moth after 60 ticks with despawning off",
  );

  enable(h, "despawning");
  const after = await h.tick(1);
  assertUndefined(
    enemyById(after, moth),
    "the moth after one tick with despawning on",
  );
});
