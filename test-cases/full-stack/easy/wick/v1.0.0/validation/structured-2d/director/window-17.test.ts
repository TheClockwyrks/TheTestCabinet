// director/window-17 — row 17 of SPAWN_WINDOWS, the window that starts at 8:30.
//
// THE SPEC LINE. `specs/enemies.md`, "Windows": "The night is divided into
// windows of `SPAWN_WINDOW` (`30`) seconds, and the current window's index is
// `min(19, floor(time / SPAWN_WINDOW))` ... `SPAWN_WINDOWS` holds one row per
// window in this order, each with the types a spawn chooses from, the seconds
// between spawns, and the most common enemies that may be alive for the
// director to add another." Row 17 reads `shade, hound, bat` at `0.15` seconds
// with a cap of `190`, and starts at 8:30 — tick 30600.
//
// THE THREE THINGS A ROW SAYS, AND HOW EACH IS READ.
//   - The interval. `specs/world.md` ("Timers"): "An interval of `s` seconds
//     anywhere in this specification is likewise `round(s × TICK_HZ)` ticks",
//     so `0.15` s is 9 ticks. The drive steps one tick at a time from the
//     window's first tick with the timer at 0 across two whole intervals, so
//     the ticks its three spawns land on are known exactly and compared as a
//     whole list.
//   - The types. Each of `shade, hound, bat` is posed in turn through
//     `setNextSpawnType`, which makes "The next window spawn ... of that type
//     in place of the type drawn from the window's types"
//     (`specs/instrumentation.md`, "Drawn outcomes"), and the next due tick
//     must spawn it: a build whose window cannot spawn one of the row's types
//     fails on that type. Six draws with nothing posed must each be one of the
//     row's types: a build that offers the wrong roster fails on the first
//     spawn outside it.
//     Each draw is posed on its own tick: the timer set to `0`, so the next
//     tick spawns, and the arrival cleared away.
//   - The cap. "if `spawnTimer` is due and `aliveCommons` < cap", with
//     `aliveCommons` "the number of live enemies of rank `common` other than
//     gnats" (`specs/enemies.md`, "The cap"). With exactly 190 counted commons
//     alive the condition is false on every tick, so no spawn lands.
//
// WHERE THE CLOCK IS POSED. On tick 30600, the window's first tick, so the tick
// driven next and the one before it are both inside the window and the timer's
// window-change reset is not what makes the first spawn land — the posed 0 is.
// The third spawn falls on tick 30619, and the 9 draws that follow end on
// tick 30628, inside the window, whose last tick is 32399.
//
// WHY EACH ARRIVAL IS CLEARED AWAY. `removeEnemy` "Removes enemy `id`. Nothing
// drops, nothing counts as a kill, and no cue plays"
// (`specs/instrumentation.md`), so `aliveCommons` stays at 0 through the first
// two readings and the cap has no part in them. The cap gets a world of its
// own, posed full.
//
// THE DRIVE. Two isolated worlds, each with `spawning` alone on: nothing moves,
// nothing is removed by distance, no scripted event fires, and every arrival is
// the timer's.
//
// THE TOLERANCE. None: whole ticks, type names, and a count of arrivals.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import { SPAWN_WINDOW, SPAWN_WINDOWS, TICK_HZ, ticksOf } from "../constants";
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
  drawPosedTypes,
  drawTypes,
  driveArrivals,
  fillCommons,
  poseWindow,
} from "./spawns";

/** Row 17 of SPAWN_WINDOWS, and its interval in whole ticks. */
const INDEX = 17;
const ROW = SPAWN_WINDOWS[INDEX];
const INTERVAL = ticksOf(ROW.interval);

/** The window's first tick, and the ticks its first three spawns are due on. */
const FIRST_TICK = INDEX * SPAWN_WINDOW * TICK_HZ;
const DUE_TICKS = Array.from(
  { length: CADENCE_SPAWNS },
  (_, i) => FIRST_TICK + 1 + i * INTERVAL,
);

/** Ticks driven for the cadence, and for the cap: at least a second of each. */
const CADENCE_TICKS = DUE_TICKS[CADENCE_SPAWNS - 1] - FIRST_TICK + 1;
const CAP_TICKS = Math.max(2 * INTERVAL, TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns row 17's types every 9 ticks and stops at its cap of 190", async () => {
  isolate(h);
  poseWindow(h, INDEX);
  enable(h, "spawning");
  const drive = await captureReplay(h, "window", () =>
    driveArrivals(h, CADENCE_TICKS, { removeOnArrival: true }),
  );
  const posed = await drawPosedTypes(h, INDEX);
  const drawn = await drawTypes(h);

  isolate(h);
  fillCommons(h, ROW.cap);
  poseWindow(h, INDEX);
  enable(h, "spawning");
  const capped = await driveArrivals(h, CAP_TICKS);

  assertDeepEqual(
    drive.arrivals.map((arrival) => arrival.tick),
    DUE_TICKS,
    `the ticks the director spawned on over ${CADENCE_TICKS} ticks of window ${INDEX}`,
  );
  for (const arrival of drive.arrivals) {
    assertContains(
      ROW.types,
      arrival.enemy.type,
      `the type of the spawn on tick ${arrival.tick}, from row ${INDEX} of SPAWN_WINDOWS`,
    );
  }
  assertDeepEqual(
    posed.map((entry) => entry.posed),
    [...ROW.types],
    `the types posed for window ${INDEX}, one per type row ${INDEX} lists`,
  );
  for (const entry of posed) {
    assertEqual(
      entry.spawned,
      entry.posed,
      `the type window ${INDEX} spawned with ${entry.posed} posed (specs/instrumentation.md, Drawn outcomes)`,
    );
  }
  assertLength(drawn, UNPOSED_DRAWS, "spawns drawn with nothing posed");
  for (const [at, type] of drawn.entries()) {
    assertContains(
      ROW.types,
      type,
      `the type of unposed draw ${at + 1} of ${UNPOSED_DRAWS}, from row ${INDEX} of SPAWN_WINDOWS`,
    );
  }
  assertEqual(
    capped.arrivals.length,
    0,
    `the spawns that landed over ${CAP_TICKS} ticks with the cap of ${ROW.cap} met`,
  );
});
