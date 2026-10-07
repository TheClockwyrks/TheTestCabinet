// director/spawn-interval — between window edges, spawns land one interval
// apart and on no tick between.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "if `spawnTimer` is due and
//     `aliveCommons` < `cap`: spawn one enemy ... `spawnTimer` = `interval`",
//     and "A spawn therefore lands on the first tick of a run, on the first
//     tick of every window, and every `interval` seconds between."
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so window 0's
//     1.00 s interval is 60 ticks.
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 with an interval
//     of 1.00 and a cap of 20.
//
// WHAT IS READ. Five consecutive spawns in window 0, each read on the tick it
// appeared: the gaps between them must all be 60 ticks. Every tick of the
// stretch is read and the field is emptied after each spawn, so a tick that put
// nothing on the field is a tick no spawn landed on: the gaps are the whole
// record, and a build that spawned between them shows as a shorter gap.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, and the clock is
// posed to window 0's start so no window edge falls inside the stretch, which
// resets the timer under a rule of its own. The field is emptied after each
// spawn, so the cap of 20 is never what holds a spawn back.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the recording closes with a drift that lets what spawned travel
// in. Every reading the assertions use is taken before that drift, and the
// drift cannot fail the item.
//
// TOLERANCE. None: an interval is a whole count of ticks the timer rule fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, collectSpawns, poseWindow, spawnGaps } from "./stage";

/** Window 0's interval as the timer rule counts it: 1.00 s is 60 ticks. */
const INTERVAL_TICKS = ticksFor(SPAWN_WINDOWS[0].interval);

/** How many spawns the spacing is read over. */
const SPAWNS = 5;

/** How far past the last expected spawn the sweep runs before giving up. */
const SWEEP_MARGIN = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands spawns one interval apart and on no tick between", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);

  const spawns = await captureReplay(h, "interval", async () => {
    const read = await collectSpawns(
      h,
      SPAWNS,
      SPAWNS * INTERVAL_TICKS + SWEEP_MARGIN,
    );
    await closeIn(h);
    return read;
  });

  assertLength(spawns, SPAWNS, "spawns read in window 0");
  for (const gap of spawnGaps(spawns)) {
    assertEqual(gap, INTERVAL_TICKS, "ticks between consecutive spawns");
  }
});
