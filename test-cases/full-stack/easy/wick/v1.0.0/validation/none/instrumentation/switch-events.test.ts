// Wick — instrumentation/switch-events: with `setEvents(false)` and the clock
// carried across tick 3600, no gnat swarm spawns and 60 is left out of
// `firedEvents`, and the event never fires once the switch is back on.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setEvents(on)` | `events` | ... | No scripted event fires; an
// event whose tick passes while the switch is off never fires."
// specs/enemies.md — "Scripted events": the first is the gnat swarm at "1:00 |
// 60", and "an event whose tick passes while `events` is off ... never fires".
//
// WHY THE WORLD IS POSED AS IT IS. The clock is posed ten ticks short of the
// swarm's tick and the run stepped across it with the switch off and every
// other faculty held, so the only thing that could put a gnat on the field is
// the event; then the switch is turned on and the run stepped for a second,
// so a build that fires a missed event late is caught.

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
const TICKS_BEFORE = 10;
const HELD_TICKS = 20;
const RESUMED_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the scripted events while off, and never fires the missed one", async () => {
  await isolate(h);
  await h.debug.setTick(SWARM.tick - TICKS_BEFORE);

  const held = await h.step(HELD_TICKS);
  assertEqual(
    held.run.tick > SWARM.tick,
    true,
    "the clock carried past the swarm's tick",
  );
  assertLength(enemiesOf(held, "gnat"), 0, "gnats while the switch is off");
  assertEqual(
    held.run.firedEvents.includes(SWARM.seconds),
    false,
    `${SWARM.seconds} in firedEvents while off`,
  );

  await h.debug.setEvents(true);
  const resumed = await h.step(RESUMED_TICKS);
  await captureStill(h, "held");
  assertLength(
    enemiesOf(resumed, "gnat"),
    0,
    "gnats once the switch is back on",
  );
  assertEqual(
    resumed.run.firedEvents.includes(SWARM.seconds),
    false,
    `${SWARM.seconds} in firedEvents once the switch is back on`,
  );
});
