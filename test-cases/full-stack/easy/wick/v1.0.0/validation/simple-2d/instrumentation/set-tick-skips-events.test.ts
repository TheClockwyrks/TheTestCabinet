// instrumentation/set-tick-skips-events — with events on, `setTick(3700)`
// followed by ticks fires no gnat swarm and leaves 60 out of firedEvents.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setTick`: "A
// scripted event fires only on its exact tick, so a clock posed past an event
// never fires it". specs/enemies.md, "Scripted events": each "fires once per
// run, on exactly the tick the run clock equals its time (`tick == time *
// TICK_HZ`) ... an event ... which the debug surface's `setTick` skips over,
// never fires"; the first is the gnat swarm at 60 s, tick 3600.
//
// THE POSE. An isolated run with `events` alone on, the clock posed to 3700,
// past the swarm's tick and short of the next event at 120 s. Sixty ticks run;
// no gnat is on the field and `firedEvents` holds nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const POSED_TICK = 3700;
const RUN_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never fires the swarm the posed clock skipped", async () => {
  isolate(h);
  enable(h, "events");
  h.debug.setTick(POSED_TICK);

  const after = await h.tick(RUN_TICKS);
  captureStill(h, "skipped");

  assertLength(
    after.run.enemies,
    0,
    "the enemies after the skipped swarm's tick",
  );
  assertDeepEqual(after.run.firedEvents, [], "firedEvents, 60 left out");
});
