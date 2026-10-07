// Wick — instrumentation/switch-despawning: with `setDespawning(false)`, a
// moth posed 1300 units from the lamplighter stays alive across 60 ticks; with
// the switch back on it is removed on the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `despawning`: on, "Commons beyond `DESPAWN_DISTANCE` are
// removed"; off, "Nothing is removed by distance". `specs/enemies.md`,
// "Despawning": "Each tick `despawning` is on, every common enemy whose center
// is farther than `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's
// center is removed". "turning one back on resumes that faculty from the next
// tick".
//
// THE DRIVE. An isolated run, `enemyMotion` off so the moth stays 1300 out,
// 60 ticks with `despawning` off, then the switch on and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertUndefined } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_DISTANCE = DESPAWN_DISTANCE + 100;
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a distant moth while off and removes it on the next tick when on", async () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", POSED_DISTANCE, 0);
  const held = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "held");
  assertDefined(
    enemyById(held, moth),
    `the moth after ${HELD_TICKS} ticks with despawning off`,
  );

  enable(h, "despawning");
  const next = await advanceTicks(h, 1);
  assertUndefined(
    enemyById(next, moth),
    "the moth on the first tick with despawning on",
  );
});
