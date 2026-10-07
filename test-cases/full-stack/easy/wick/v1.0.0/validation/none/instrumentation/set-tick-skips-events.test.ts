// Wick — instrumentation/set-tick-skips-events: with events on,
// `setTick(3700)` followed by ticks fires no gnat swarm and leaves 60 out of
// `firedEvents`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setTick(tick)`):
// "A scripted event fires only on its exact tick, so a clock posed past an
// event never fires it." specs/enemies.md — "Scripted events": each "fires once
// per run, on exactly the tick the run clock equals its time (`tick == time *
// TICK_HZ` ...)"; "an event ... which the debug surface's `setTick` skips over,
// never fires"; the first is the gnat swarm at 60 s, tick 3600.
//
// WHY THE WORLD IS POSED AS IT IS. The clock is posed a hundred ticks past the
// swarm's tick and the run stepped for a second with `events` on and every
// other faculty off, so the only thing that could put a gnat on the field is
// the event firing late.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { EVENTS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  enemiesOf,
  isolate,
  type Harness,
} from "../harness";

const SWARM = EVENTS[0]!;
const POSED_TICK = SWARM.tick + 100;
const STEPPED = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never fires an event the posed clock skipped over", async () => {
  await isolate(h, { on: ["events"] });
  await h.debug.setTick(POSED_TICK);
  const after = await h.step(STEPPED);
  await captureStill(h, "skipped");

  assertLength(enemiesOf(after, "gnat"), 0, "gnats after the skipped swarm");
  assertEqual(
    after.run.firedEvents.includes(SWARM.seconds),
    false,
    `${SWARM.seconds} in firedEvents`,
  );
});
