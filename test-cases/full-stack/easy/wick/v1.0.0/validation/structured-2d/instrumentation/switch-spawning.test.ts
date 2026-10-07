// Wick — instrumentation/switch-spawning: with `setSpawning(false)`, the spawn
// timer holds where it stands across a window change and no window spawn
// lands; with the switch back on the timer counts and spawns resume.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `spawning` off: "The timer holds where it stands and no
// window spawn lands." `specs/enemies.md`, "The spawn timer": "While
// `spawning` is off the timer holds where it stands, a window change
// included"; on: the timer counts down and a due timer spawns. `specs/world.md`,
// "Timers": a timer counts down by `TICK_DT` a tick and is due at 0, so a held
// 0.3 s is due 18 ticks after counting resumes; "A timer held by one of the
// driver switches ... neither counts down nor is due until the switch is on
// again."
//
// THE DRIVE. An isolated run at tick 1795, five ticks short of window 1, the
// timer posed to 0.3 s, and 120 ticks with the switch off: the timer reads
// 0.3 and nothing spawned. Then the switch on: nothing through 17 ticks, one
// enemy on the 18th. Tick 1913 to 1933 sits inside window 1 (1800 to 3599),
// so no window change resets the timer on the way. `spawnTimer` is read exact
// while held, `REAL_EPS` after it has counted.

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

const START_TICK = 1795;
const HELD_TICKS = 120;
const POSED_SECONDS = 0.3;
const DUE_TICKS = ticksOf(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the timer and the spawns off, and resumes them on", async () => {
  isolate(h);
  h.debug.setTick(START_TICK);
  h.debug.setSpawnTimer(POSED_SECONDS);

  const { held, early, due } = await captureReplay(h, "held", async () => {
    const held = await advanceTicks(h, HELD_TICKS);
    enable(h, "spawning");
    const early = await advanceTicks(h, DUE_TICKS - 1);
    const due = await advanceTicks(h, 1);
    return { held, early, due };
  });

  assertEqual(held.run.spawnWindow, 1, "the window after the held ticks");
  assertEqual(
    held.run.spawnTimer,
    POSED_SECONDS,
    "spawnTimer held across 120 ticks and a window change",
  );
  assertLength(held.run.enemies, 0, "enemies spawned while spawning was off");
  assertLength(
    early.run.enemies,
    0,
    `enemies ${DUE_TICKS - 1} ticks after the switch came on`,
  );
  assertLength(
    due.run.enemies,
    1,
    `enemies on the ${DUE_TICKS}th tick after the switch came on`,
  );
});
