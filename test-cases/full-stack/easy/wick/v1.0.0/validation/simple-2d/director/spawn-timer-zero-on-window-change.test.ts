// director/spawn-timer-zero-on-window-change — the first tick of a new window
// zeroes the spawn timer, spawns, and sets the new window's interval.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "On every tick `spawning` is on,
//     in this order: if the window index differs from the previous tick's, the
//     window of tick − 1: spawnTimer = 0; spawnTimer counts down; if spawnTimer
//     is due and aliveCommons < cap: spawn one enemy ... spawnTimer =
//     interval".
//   - `specs/enemies.md` ("Windows"): "the current window's index is
//     `min(19, floor(time / SPAWN_WINDOW))`", with `SPAWN_WINDOW` (`30`)
//     seconds, so tick 1799 is window 0 and tick 1800 is window 1, whose
//     interval is 0.80 s.
//   - `specs/instrumentation.md` (`setSpawnTimer`): "Sets `spawnTimer` to
//     `seconds`, at least `0`."
//
// WHAT IS READ. The timer is posed to 0.5 at tick 1799 and one tick is run.
// Tick 1800 opens window 1, so the timer is zeroed rather than counted down
// from 0.5: an enemy must land on that tick, and the timer it leaves must read
// window 1's interval, 0.8. A build that counted the posed 0.5 down instead
// spawns nothing on that tick and reads 0.4833... .
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on over an empty field,
// so `aliveCommons` is 0 against window 1's cap of 30 and the cap cannot be
// what decides whether the spawn lands.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the interval the tick left in the
// timer, a stated figure read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, SPAWN_WINDOWS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, windowStartTick } from "./stage";

/** The last tick of window 0: 1799, one before window 1 opens. */
const EDGE_TICK = windowStartTick(1) - 1;

/** The timer posed mid-count, which the window change must discard. */
const POSED_TIMER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("zeroes the spawn timer on the first tick of a window", async () => {
  isolate(h);
  enable(h, "spawning");
  h.debug.setTick(EDGE_TICK);
  h.debug.setSpawnTimer(POSED_TIMER);

  const opened = await h.tick(1);
  await closeIn(h);
  captureStill(h, "reset");

  assertEqual(opened.run.tick, windowStartTick(1), "the tick reached");
  assertLength(opened.run.enemies, 1, "enemies on the window's first tick");
  assertWithin(
    opened.run.spawnTimer,
    SPAWN_WINDOWS[1].interval,
    FIGURE_TOLERANCE,
    "the spawn timer the window's first tick left",
  );
});
