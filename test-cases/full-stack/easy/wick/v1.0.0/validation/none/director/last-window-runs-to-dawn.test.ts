// director/last-window-runs-to-dawn — window 19 governs until the run ends.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Windows"): "A window's row
// applies from its start until the next window starts; window `19` is the last
// and runs until dawn", and its row reads
//
// | 19 | 9:30 | hound, shade, spider | 0.10 | 200 |
//
// so its interval is `round(0.10 × TICK_HZ)`, 6 ticks, by specs/world.md
// ("Timers"), and its cap is 200. The end is specs/enemies.md ("Dawn"): "On the
// tick the run clock reaches `DAWN_TIME` (`600`), tick `36000`, the night is
// over: the run ends with `screen = "dawn"`, whatever is alive and whatever the
// director had due."
//
// WHY TICK 35700. Five seconds of game time short of dawn: 300 ticks, fifty
// whole intervals of the row, all of them inside window 19 (which begins at
// tick 34200). A build that let window 19 lapse — that read a twentieth row, or
// stopped spawning past its own last boundary — spawns nothing across the span
// and fails; one that kept the row spawning to the last tick keeps the cadence
// all the way in. The cap cannot bind: fifty spawns against a cap of 200.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// the timer posed to `0`, so the first spawn lands on the first tick and the
// rest on the row's own rhythm. `enemyMotion`, `enemyContact` and `despawning`
// are off, so nothing that spawned can leave again or reach the lamplighter and
// end the run early; nothing but dawn can stop the night, which is what the
// last reading is about.
//
// THE TOLERANCE. Whole ticks and whole enemies, read exactly, and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { DAWN_TICK, SPAWN_WINDOWS, dueTicks, type EnemyId } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The last window's index. */
const LAST = SPAWN_WINDOWS.length - 1;

/** Row 19's own figures. */
const ROW = SPAWN_WINDOWS[LAST]!;

/** Five seconds of game time short of dawn. */
const FROM_TICK = DAWN_TICK - 300;

/** The ticks stepped: exactly the ones between the posed clock and dawn. */
const SPAN_TICKS = DAWN_TICK - FROM_TICK;

/** What the run to dawn saw. */
interface Run {
  /** The run-clock ticks a spawn landed on. */
  spawnTicks: number[];
  /** The types that spawned, each once. */
  types: EnemyId[];
  /** The state the last stepped frame left. */
  end: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns row 19's types every 6 ticks from 35700 until the run ends at dawn", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setTick(FROM_TICK);
  await h.debug.setSpawnTimer(0);

  const run = await captureReplay(h, "last", async () => {
    let previous = await h.snapshot();
    const spawnTicks: number[] = [];
    const types: EnemyId[] = [];
    for (let tick = 1; tick <= SPAN_TICKS; tick += 1) {
      const after = await h.step(1);
      for (const arrival of newEnemies(previous, after)) {
        spawnTicks.push(after.run.tick);
        if (!types.includes(arrival.type)) types.push(arrival.type);
      }
      previous = after;
    }
    return { spawnTicks, types, end: previous } satisfies Run;
  });

  const step = dueTicks(ROW.interval);
  const due: number[] = [];
  for (let tick = FROM_TICK + 1; tick <= DAWN_TICK; tick += step)
    due.push(tick);

  assertDeepEqual(
    run.spawnTicks,
    due,
    `the run-clock ticks window ${LAST} spawned on between tick ${FROM_TICK} and dawn`,
  );
  for (const type of run.types) {
    assertTrue(
      ROW.types.includes(type),
      `a spawned type (${type}) among window ${LAST}'s (${ROW.types.join(", ")})`,
    );
  }
  assertEqual(run.end.screen, "dawn", `the screen after tick ${DAWN_TICK}`);
  assertEqual(run.end.run.tick, DAWN_TICK, "the tick the run ended on");
});
