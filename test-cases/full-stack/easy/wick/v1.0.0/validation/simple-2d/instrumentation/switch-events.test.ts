// instrumentation/switch-events — with `setEvents(false)` and the clock
// carried across tick 3600, no gnat swarm spawns and 60 is left out of
// firedEvents, and the event never fires once the switch is back on.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `events` off: "No scripted event fires; an event whose tick
// passes while the switch is off never fires". specs/enemies.md, "Scripted
// events": each fires "on exactly the tick the run clock equals its time ...
// and only while `events` is on; an event whose tick passes while `events` is
// off ... never fires"; the first is the gnat swarm at 60 s.
//
// THE POSE. An isolated run (every switch off) with the clock posed ten ticks
// short of 3600 and twenty ticks run across it; then `events` on and sixty
// ticks more. The field stays empty and `firedEvents` stays empty throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { EVENTS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const SWARM_TICK = EVENTS[0].time * TICK_HZ;
const LEAD_TICKS = 10;
const CROSS_TICKS = 20;
const AFTER_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never fires the swarm whose tick passed with events off", async () => {
  isolate(h);
  h.debug.setTick(SWARM_TICK - LEAD_TICKS);

  const crossed = await h.tick(CROSS_TICKS);
  assertLength(
    crossed.run.enemies,
    0,
    "the field after the swarm's tick passed",
  );
  assertDeepEqual(crossed.run.firedEvents, [], "firedEvents with events off");

  enable(h, "events");
  const after = await h.tick(AFTER_TICKS);
  captureStill(h, "held");

  assertLength(after.run.enemies, 0, "the field with events back on");
  assertDeepEqual(after.run.firedEvents, [], "firedEvents with events back on");
});
