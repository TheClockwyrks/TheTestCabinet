// Wick — instrumentation/set-tick-leaves-the-rest: after `setTick`,
// `spawnTimer`, `firedEvents`, every live entity, and the lamplighter stand
// exactly as they did before the call.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setTick(tick)`):
// "Nothing else changes: `spawnTimer`, `firedEvents`, and every live entity
// stay as they stand". The comparison is exact equality of the documented run
// with the three clock fields (`tick`, `time`, `spawnWindow`) set aside, since
// those are what the call is for.
//
// WHY THE WORLD IS POSED AS IT IS. Each thing the sentence names is given a
// value that is not its idle one before the call: a spawn timer, a fired event
// (the first swarm, run for real on its tick), one entity of every kind, and a
// lamplighter moved, turned, and hurt. A pose that quietly rebuilt the run
// around the new clock would lose at least one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { EVENTS } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const BEFORE_FIRST_EVENT = EVENTS[0]!.tick - 1;
const POSED_TICK = 9000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing but the clock", async () => {
  await isolate(h);
  await h.debug.setTick(BEFORE_FIRST_EVENT);
  await h.debug.setEvents(true);
  await h.step(1); // the swarm fires: `firedEvents` holds 60, gnats are alive
  await h.debug.setEvents(false);
  await h.debug.setSpawnTimer(0.7);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  await h.debug.setPlayerPosition(300, -120);
  await h.debug.setFacing("left");
  await h.debug.setHp(40);
  const before = await h.snapshot();
  assertNotEqual(before.run.firedEvents.length, 0, "an event fired before the pose");

  await h.debug.setTick(POSED_TICK);
  const after = await h.snapshot();
  await captureStill(h, "held");

  assertEqual(after.run.tick, POSED_TICK, "the posed tick");
  const rest = documentedRun(after.run);
  rest.tick = before.run.tick;
  rest.time = before.run.time;
  rest.spawnWindow = before.run.spawnWindow;
  assertDeepEqual(
    rest,
    documentedRun(before.run),
    "the run beside the clock, before and after setTick",
  );
});
