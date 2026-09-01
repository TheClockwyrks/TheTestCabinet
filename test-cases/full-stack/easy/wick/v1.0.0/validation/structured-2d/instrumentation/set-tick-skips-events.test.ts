// Wick — instrumentation/set-tick-skips-events: a clock posed past an event
// never fires it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setTick(tick)`: "A scripted event fires only on its exact tick, so a clock
// posed past an event never fires it." `specs/enemies.md`, "Scripted events":
// "Each fires once per run, on exactly the tick the run clock equals its time
// (`tick == time * TICK_HZ` ...) ... an event ... which the debug surface's
// `setTick` skips over, never fires"; the 60 s event is a gnat swarm.
//
// THE DRIVE. An isolated run with `events` on and the clock posed to 3700,
// past tick 3600, then 60 ticks: no gnat on the field and `firedEvents` empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const POSED_TICK = 3700;
const DRIVE_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires no swarm and leaves 60 out of firedEvents", async () => {
  isolate(h);
  enable(h, "events");
  h.debug.setTick(POSED_TICK);
  const after = await advanceTicks(h, DRIVE_TICKS);
  captureStill(h, "skipped");

  assertDeepEqual(
    after.run.enemies,
    [],
    "enemies after ticks past the skipped swarm",
  );
  assertDeepEqual(
    after.run.firedEvents,
    [],
    "firedEvents after the skipped event",
  );
});
