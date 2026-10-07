// Wick — instrumentation/set-tick-leaves-the-rest: after `setTick`, the spawn
// timer, the fired events, every live entity, and the lamplighter stand
// exactly as they did before the call.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setTick(tick)`: "Nothing else changes: `spawnTimer`, `firedEvents`, and
// every live entity stay as they stand, and everything derived from the clock,
// `time`, `spawnWindow`, ... follows from the next tick on." So the run after
// the call is the run before it with `tick` replaced and the two clock-derived
// fields following.
//
// THE SCENE. An isolated run carried over the 60 s swarm with `events` on so
// `firedEvents` holds `[60]`, then the gnats cleared and one of everything
// placed: a moth, a bolt, a puddle, a gem, a bread, the lamplighter moved and
// hurt, the spawn timer posed. The whole `run` before is compared with the
// whole `run` after, structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ, spawnWindowOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const TICK_BEFORE_SWARM = 3599;
const POSED_TICK = 9000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes tick, time, and spawnWindow and nothing else", async () => {
  isolate(h);
  h.debug.setTick(TICK_BEFORE_SWARM);
  enable(h, "events");
  await advanceTicks(h, 1);
  h.debug.setEvents(false);
  h.debug.clearEnemies();
  h.debug.setPlayerPosition(120, -40);
  h.debug.setHp(55);
  h.debug.setSpawnTimer(0.7);
  placeEnemy(h, "moth", 300, 0);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placePuddle(h, "oil-splash", 50, 50);
  placeGem(h, "large", 400, 100);
  placePickup(h, "bread", -300, 0);
  const before = h.snapshot();
  assertEqual(
    before.run.firedEvents.length,
    1,
    "the event fired before the pose",
  );

  h.debug.setTick(POSED_TICK);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "held");

  assertDeepEqual(
    after.run,
    {
      ...before.run,
      tick: POSED_TICK,
      time: POSED_TICK / TICK_HZ,
      spawnWindow: spawnWindowOf(POSED_TICK / TICK_HZ),
    },
    "run after setTick, against the run before it",
  );
});
