// director/window-7 — row 7 of `SPAWN_WINDOWS`: from 3:30 the director spawns
// wisp, spider, crow every 0.35 s while fewer than 90 commons are alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Windows"): "`SPAWN_WINDOWS` holds one row per
//     window in this order, each with the types a spawn chooses from, the
//     seconds between spawns, and the most common enemies that may be alive
//     for the director to add another", and row 7 of that table reads "| 7 |
//     3:30 | wisp, spider, crow | 0.35 | 90 |". "A window's row applies from
//     its start until the next window starts".
//   - `specs/enemies.md` ("The spawn timer"): "if `spawnTimer` is due and
//     `aliveCommons` < `cap`: spawn one enemy of a type chosen uniformly from
//     the window's types, at a spawn point; `spawnTimer` = `interval`", with
//     "`interval` and `cap` ... the current window's", and "When the cap is
//     full the timer rests at `0`".
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in
//     this specification is likewise `round(s × TICK_HZ)` ticks", so 0.35 s is
//     21 ticks.
//   - `specs/enemies.md` ("The cap"): "`aliveCommons` is the number of live
//     enemies of rank `common` other than gnats."
//
// WHAT IS READ. The row, in its three parts. With the clock posed into window
// 7 and the spawn timer resting at `0`, thirty spawns are read one at a time:
// every gap between consecutive spawns must be 21 ticks, every type drawn must
// be one the row lists, and every type the row lists must be drawn across the
// thirty. Then the cap is read from both sides. The clock is posed back to the
// window's start and the field filled with 89 moths, one short of the row's
// cap: the next due tick must spawn, taking the field to 90. The clock is
// posed back once more and two intervals are driven at 90: no further spawn
// may land. No window edge falls inside either stretch.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, so the timer is the
// only thing that can put an enemy on the field: no scripted event fires, no
// enemy moves or is removed by distance, nothing is hit, and the lamplighter
// stands still, so each spawn is read exactly where and when the director put
// it. The field is emptied after each spawn so the cap is never what decides
// whether the next one lands, and the cap is posed deliberately after them, as
// its own reading.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the recording closes with a drift that lets what spawned travel
// in. Every reading the assertions use is taken before that drift, and the
// drift cannot fail the item.
//
// TOLERANCE. None: the interval is a whole count of ticks the timer rule
// fixes, and the types and the cap are counted exactly. Thirty spawns is what
// makes the type reading honest, and no more than that: a uniform draw over
// three types misses one of them across thirty draws about once in sixty
// thousand runs.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import {
  closeIn,
  collectSpawns,
  poseRing,
  poseWindow,
  spawnGaps,
  spawnTypes,
  windowIntervalTicks,
} from "./stage";

/** The window this check reads: row 7, which applies from 3:30. */
const WINDOW = 7;

const ROW = SPAWN_WINDOWS[WINDOW];

/** The row's interval as the timer rule counts it: 0.35 s is 21 ticks. */
const INTERVAL_TICKS = windowIntervalTicks(WINDOW);

/** How many spawns the type reading is taken over. */
const SPAWNS = 30;

/** How far past the last expected spawn the sweep runs before giving up. */
const SWEEP_MARGIN = 4;

/** How long the full cap is held: two intervals, so two spawns are refused. */
const CAP_TICKS = 2 * INTERVAL_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns window 7's types at its interval up to its cap", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, WINDOW);

  const spawns = await captureReplay(h, "window", async () => {
    const read = await collectSpawns(
      h,
      SPAWNS,
      SPAWNS * INTERVAL_TICKS + SWEEP_MARGIN,
    );
    await closeIn(h);
    return read;
  });

  assertLength(spawns, SPAWNS, `spawns read in window ${WINDOW}`);
  for (const gap of spawnGaps(spawns)) {
    assertEqual(gap, INTERVAL_TICKS, "ticks between consecutive spawns");
  }
  for (const spawn of spawns) {
    assertContains(ROW.types, spawn.type, "the type of a spawn");
  }
  const drawn = spawnTypes(spawns);
  for (const type of ROW.types) {
    assertContains(drawn, type, `the types drawn across ${SPAWNS} spawns`);
  }

  h.debug.clearEnemies();
  poseWindow(h, WINDOW);
  poseRing(h, "moth", ROW.cap - 1);
  const room = await h.tick(1);

  assertLength(
    room.run.enemies,
    ROW.cap,
    "enemies after a due tick with one place left under the cap",
  );

  poseWindow(h, WINDOW);
  const capped = await h.tick(CAP_TICKS);

  assertEqual(capped.run.aliveCommons, ROW.cap, "the commons alive at the cap");
  assertLength(
    capped.run.enemies,
    ROW.cap,
    "enemies on the field after two intervals at the cap",
  );
});
