// Wick — instrumentation/set-spawn-timer: `setSpawnTimer(0.5)` on `playing`
// reads back 0.5, and with `spawning` on the next window spawn lands on the
// 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setSpawnTimer(seconds)`: "Sets `spawnTimer` to `seconds`, at least `0`."
// `specs/world.md`, "Timers": "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on" — 30 ticks for
// 0.5 s. `specs/enemies.md`, "The spawn timer": "if spawnTimer is due and
// aliveCommons < cap: spawn one enemy"; window 0 holds moths with a cap of 20.
//
// THE DRIVE. An isolated run at tick 0 (window 0, no window change ahead
// within the drive) with the field empty, the timer posed, and `spawning`
// turned on: no enemy through 29 ticks, one on the 30th.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICKS = ticksOf(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the posed timer back and spawns when it is due", async () => {
  isolate(h);
  h.debug.setSpawnTimer(POSED_SECONDS);
  assertEqual(
    h.snapshot().run.spawnTimer,
    POSED_SECONDS,
    "run.spawnTimer after setSpawnTimer(0.5)",
  );
  enable(h, "spawning");

  const { early, due } = await captureReplay(h, "timer", async () => {
    const early = await advanceTicks(h, DUE_TICKS - 1);
    const due = await advanceTicks(h, 1);
    return { early, due };
  });

  assertLength(early.run.enemies, 0, `enemies after ${DUE_TICKS - 1} ticks`);
  assertLength(due.run.enemies, 1, `enemies on the ${DUE_TICKS}th tick`);
});
