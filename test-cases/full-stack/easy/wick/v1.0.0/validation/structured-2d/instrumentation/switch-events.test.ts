// Wick — instrumentation/switch-events: with `setEvents(false)` and the clock
// carried across tick 3600, no gnat swarm spawns, 60 is left out of
// `firedEvents`, and the event never fires once the switch is back on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `events` off: "No scripted event fires; an event whose tick
// passes while the switch is off never fires." `specs/enemies.md`, "Scripted
// events": the 60 s event is a gnat swarm of `SWARM_SIZE` gnats, and "an event
// whose tick passes while `events` is off ... never fires."
//
// THE DRIVE. An isolated run at tick 3590 with `events` off, 20 ticks across
// 3600, then the switch on and 60 more ticks: no enemy at either read and
// `firedEvents` empty at both.

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

const START_TICK = 3590;
const ACROSS_TICKS = 20;
const AFTER_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the swarm out and never fires it afterwards", async () => {
  isolate(h);
  h.debug.setTick(START_TICK);
  const crossed = await advanceTicks(h, ACROSS_TICKS);
  enable(h, "events");
  const later = await advanceTicks(h, AFTER_TICKS);
  captureStill(h, "held");

  assertDeepEqual(
    crossed.run.enemies,
    [],
    "enemies after crossing tick 3600 with events off",
  );
  assertDeepEqual(
    crossed.run.firedEvents,
    [],
    "firedEvents after crossing with events off",
  );
  assertDeepEqual(
    later.run.enemies,
    [],
    "enemies after the switch came back on",
  );
  assertDeepEqual(
    later.run.firedEvents,
    [],
    "firedEvents after the switch came back on",
  );
});
