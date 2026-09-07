// director/window-0 — row 0 of `SPAWN_WINDOWS`: from 0:00 the director spawns
// moth every 1 s while fewer than 20 commons are alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Windows"): "`SPAWN_WINDOWS` holds one row per window
//     in this order, each with the types a spawn chooses from, the seconds
//     between spawns, and the most common enemies that may be alive for the
//     director to add another", and row 0 of that table reads "| 0 | 0:00 |
//     moth | 1.00 | 20 |". "A window's row applies from its start until
//     the next window starts".
//   - `specs/enemies.md` ("The spawn timer"): "if `spawnTimer` is due and
//     `aliveCommons` < `cap`: spawn one enemy of a type chosen uniformly from
//     the window's types, at a spawn point; `spawnTimer` = `interval`", with
//     "`interval` and `cap` ... the current window's", and "When the cap is
//     full the timer rests at `0`".
//   - `specs/instrumentation.md` ("Drawn outcomes", `setNextSpawnType(id)`):
//     "The next window spawn is of that type in place of the type drawn from
//     the window's types, and that spawn consumes it."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in this
//     specification is likewise `round(s × TICK_HZ)` ticks", so 1.00 s is 60
//     ticks.
//   - `specs/enemies.md` ("The cap"): "`aliveCommons` is the number of live
//     enemies of rank `common` other than gnats."
//
// WHAT IS READ. The row, in its three parts. With the clock posed into window 0
// and the spawn timer resting at `0`, the cadence is read over two whole
// intervals: three spawns land, one to a due tick, and every gap between
// consecutive spawns must be 60 ticks. Then the types are read two ways: each
// type the row lists is posed through `setNextSpawnType` and the spawn the next
// due tick lands must be of it, and six spawns are drawn with nothing posed,
// each on its own tick with the field emptied first, and every one must be a
// type the row lists. The row lists one type, so the posed reading poses `moth`
// once and every unposed draw must be a moth. Then the cap is read from both
// sides. The clock is posed back to the window's start and the field filled
// with 19 moths, one short of the row's cap: the next due tick must spawn,
// taking the field to 20. The clock is posed back once more and two intervals
// are driven at 20: no further spawn may land. No window edge falls inside any
// of these stretches.
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
// TOLERANCE. None: the interval is a whole count of ticks the timer rule fixes,
// and the types and the cap are counted exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import {
  CADENCE_SPAWNS,
  UNPOSED_DRAWS,
  closeIn,
  collectSpawns,
  drawPosedTypes,
  drawTypes,
  poseRing,
  poseWindow,
  spawnGaps,
  windowIntervalTicks,
} from "./stage";

/** The window this check reads: row 0, which applies from 0:00. */
const WINDOW = 0;

const ROW = SPAWN_WINDOWS[WINDOW];

/** The row's interval as the timer rule counts it: 1.00 s is 60 ticks. */
const INTERVAL_TICKS = windowIntervalTicks(WINDOW);

/** How far past the last expected spawn the cadence sweep runs before giving up. */
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

it("spawns window 0's types at its interval up to its cap", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, WINDOW);

  const spawns = await captureReplay(h, "window", async () => {
    const read = await collectSpawns(
      h,
      CADENCE_SPAWNS,
      (CADENCE_SPAWNS - 1) * INTERVAL_TICKS + SWEEP_MARGIN,
    );
    await closeIn(h);
    return read;
  });

  assertLength(
    spawns,
    CADENCE_SPAWNS,
    `spawns read over two intervals of window ${WINDOW}`,
  );
  for (const gap of spawnGaps(spawns)) {
    assertEqual(gap, INTERVAL_TICKS, "ticks between consecutive spawns");
  }
  for (const spawn of spawns) {
    assertContains(ROW.types, spawn.type, "the type of a spawn");
  }

  const posed = await drawPosedTypes(h, WINDOW);
  assertDeepEqual(
    posed.map((entry) => entry.posed),
    [...ROW.types],
    "the types posed, one per type the row lists",
  );
  for (const entry of posed) {
    assertEqual(
      entry.spawned,
      entry.posed,
      `the type spawned with ${entry.posed} posed`,
    );
  }
  const drawn = await drawTypes(h);
  assertLength(drawn, UNPOSED_DRAWS, "spawns drawn with nothing posed");
  for (const type of drawn) {
    assertContains(ROW.types, type, "the type of an unposed spawn");
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
