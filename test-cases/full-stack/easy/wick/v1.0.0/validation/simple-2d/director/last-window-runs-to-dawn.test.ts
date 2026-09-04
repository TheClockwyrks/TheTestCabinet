// director/last-window-runs-to-dawn — window 19 is the last, and its row keeps
// spawning until the night ends.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Windows"): "A window's row applies from its start
//     until the next window starts; window `19` is the last and runs until
//     dawn", and row 19 reads "| 19 | 9:30 | hound, shade, spider | 0.10 |
//     200 |".
//   - `specs/world.md` ("Timers"): an interval of `s` seconds is
//     `round(s × TICK_HZ)` ticks, so 0.10 s is 6 ticks.
//   - `specs/world.md` ("Fallen and dawn"): a run ends at dawn when "`tick`
//     equals `DAWN_TIME × TICK_HZ` (`36000`)", with `screen` `dawn`, and "A run
//     that has ended ticks no further."
//
// WHAT IS READ. From tick 35700, five seconds short of dawn, with the timer
// resting at 0: every spawn that lands must be 6 ticks after the one before,
// every type must be one of hound, shade, and spider, the last spawn must fall
// within one interval of dawn, and the run must end on tick 36000 with `screen`
// `dawn`. A build whose last window stops early leaves a gap before dawn, and
// one that reads a twentieth row past window 19 draws a type outside the row.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on: nothing moves, is
// removed, or is hit, so every enemy that appears is one the timer added and
// the count only rises. Fifty spawns land in five seconds, well inside the
// row's cap of 200, so the cap never holds one back.
//
// TOLERANCE. None: the interval, the dawn tick, and the types are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLessThanOrEqual } from "../assert";
import { DAWN_TICK, SPAWN_WINDOWS, ticksFor, type EnemyId } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** Row 19's interval as the timer rule counts it: 0.10 s is 6 ticks. */
const INTERVAL_TICKS = ticksFor(SPAWN_WINDOWS[19].interval);

const ROW = SPAWN_WINDOWS[19];

/** Where the clock is posed: five seconds of night left, deep in window 19. */
const OPENING_TICK = 35700;

/** Ticks driven: the whole of what is left, and a few past dawn that must not run. */
const BUDGET = DAWN_TICK - OPENING_TICK + 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns window 19's row every interval until the run ends at dawn", async () => {
  isolate(h);
  enable(h, "spawning");
  h.debug.setTick(OPENING_TICK);
  h.debug.setSpawnTimer(0);

  const spawnTicks: number[] = [];
  const drawn: EnemyId[] = [];
  const seen = new Set<number>();

  const trace = await captureReplay(h, "last", () =>
    h.trace(BUDGET, (snapshot) => snapshot.screen !== "playing"),
  );
  for (const snapshot of trace) {
    const fresh = snapshot.run.enemies.filter((enemy) => !seen.has(enemy.id));
    if (fresh.length === 0) continue;
    spawnTicks.push(snapshot.run.tick);
    for (const enemy of fresh) {
      seen.add(enemy.id);
      drawn.push(enemy.type);
    }
  }

  const ending = trace[trace.length - 1];
  assertEqual(ending.run.tick, DAWN_TICK, "the tick the run ended on");
  assertEqual(ending.screen, "dawn", "the screen the night ended on");

  for (let at = 1; at < spawnTicks.length; at += 1) {
    assertEqual(
      spawnTicks[at] - spawnTicks[at - 1],
      INTERVAL_TICKS,
      "ticks between consecutive spawns in window 19",
    );
  }
  for (const type of drawn) {
    assertContains(ROW.types, type, "the type of a spawn in window 19");
  }
  assertLessThanOrEqual(
    DAWN_TICK - spawnTicks[spawnTicks.length - 1],
    INTERVAL_TICKS,
    "ticks from the last spawn to dawn",
  );
});
