// instrumentation/set-tick-leaves-the-rest — after `setTick`, spawnTimer,
// firedEvents, every live entity, and the lamplighter stand exactly as they
// did before the call.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setTick`: "Nothing
// else changes: `spawnTimer`, `firedEvents`, and every live entity stay as
// they stand". specs/enemies.md: "a clock the debug surface poses changes the
// timer on no tick of its own".
//
// THE POSE. The busy night gives one of everything and a posed spawn timer;
// `firedEvents` cannot be posed, so the scripted swarm at 60 s is fired the
// real way, the clock posed to the tick before it and one tick run with
// `events` on, which also puts the swarm's gnats on the field. Then the clock
// is posed to 4500 and the whole of `run` but the three clock-derived fields
// is compared, entry for entry, against the reading before the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { EVENTS, SWARM_SIZE, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  enable,
  type Harness,
} from "../harness";
import { poseBusyNight, withoutClock } from "./helpers";

const SWARM_TICK = EVENTS[0].time * TICK_HZ;
const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves everything but the clock exactly as it stood", async () => {
  poseBusyNight(h);
  h.debug.setTick(SWARM_TICK - 1);
  enable(h, "events");
  const fired = await h.tick(1);
  disable(h, "events");
  assertDeepEqual(fired.run.firedEvents, [EVENTS[0].time], "the swarm fired");
  assertLength(fired.run.enemies, 4 + SWARM_SIZE, "the gnats the swarm added");
  const before = h.snapshot();

  h.debug.setTick(POSED_TICK);
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "held");

  assertEqual(after.run.tick, POSED_TICK, "run.tick at the pose");
  assertDeepEqual(
    withoutClock(after.run),
    withoutClock(before.run),
    "run, but for tick, time, and spawnWindow, across setTick",
  );
});
