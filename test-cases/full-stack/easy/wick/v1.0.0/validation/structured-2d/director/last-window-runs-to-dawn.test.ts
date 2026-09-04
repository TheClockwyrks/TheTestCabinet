// director/last-window-runs-to-dawn — the last window has no successor.
//
// THE SPEC LINE. `specs/enemies.md`, "Windows": "A window's row applies from
// its start until the next window starts; window `19` is the last and runs
// until dawn." The index is `min(19, floor(time / SPAWN_WINDOW))`, so the
// `min` is what holds the last row in force: window 19 starts at 9:30, tick
// 34200, and the night ends at dawn on tick 36000
// (`specs/enemies.md`, "Dawn"), 1800 ticks later — a whole window's length
// again. Row 19 offers `hound, shade, spider` at an interval of `0.10` seconds
// with a cap of `200`, and `specs/world.md` ("Timers") makes that interval
// `round(0.1 × 60)` = 6 ticks.
//
// WHAT A BUILD MIGHT DO INSTEAD. Index past the last row and read nothing, and
// so stop spawning for the final half-minute of the night — the half-minute
// the whole run has been building toward. So the reading is taken over the
// last 300 ticks: every one of the 50 spawns due in them, on its exact tick,
// with the type each takes.
//
// THE DRIVE. The isolated world with the clock posed to 35700 and the timer at
// 0, `spawning` alone on, stepped one tick at a time to tick 36000. Fifty
// spawns is far under the cap of 200, so nothing the cap does is in the way,
// and `enemyMotion` and `enemyContact` are off, so the run reaches dawn rather
// than ending fallen under fifty hounds. Dawn itself is read at the end: the
// run ends there, which is what "until dawn" means.
//
// THE TOLERANCE. None: whole ticks, type names, and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import { DAWN_TICK, SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals } from "./spawns";

/** Row 19: the types it offers and its interval in whole ticks. */
const ROW = SPAWN_WINDOWS[19];
const INTERVAL = ticksOf(ROW.interval);

/** Where the clock is posed, and the ticks from there to dawn. */
const FROM_TICK = 35_700;
const TICKS = DAWN_TICK - FROM_TICK;

/** The ticks a spawn is due on: the first tick driven, then every interval. */
const DUE_TICKS: number[] = [];
for (let tick = FROM_TICK + 1; tick <= DAWN_TICK; tick += INTERVAL) {
  DUE_TICKS.push(tick);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns row 19's types every 6 ticks from tick 35700 until the run ends at dawn", async () => {
  isolate(h);
  h.debug.setTick(FROM_TICK);
  h.debug.setSpawnTimer(0);
  enable(h, "spawning");

  const drive = await captureReplay(h, "last", () => driveArrivals(h, TICKS));

  assertDeepEqual(
    drive.arrivals.map((arrival) => arrival.tick),
    DUE_TICKS,
    `the ticks the director spawned on over the last ${TICKS} ticks of the night`,
  );
  for (const arrival of drive.arrivals) {
    assertContains(
      ROW.types,
      arrival.enemy.type,
      `the type of the spawn on tick ${arrival.tick}, from row 19 of SPAWN_WINDOWS`,
    );
  }
  assertEqual(drive.snapshot.screen, "dawn", "the screen the drive ended on");
  assertEqual(drive.snapshot.run.tick, DAWN_TICK, "the tick the run ended on");
});
