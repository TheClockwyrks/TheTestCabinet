// director/windows — the drive the twenty window checks share.
//
// Each of `SPAWN_WINDOWS`' twenty rows states three figures, and each window's
// check reads all three off one posed window: the seconds between spawns, the
// types a spawn chooses from, and the most commons that may be alive for the
// director to add another. The drive is identical from row to row, so it lives
// once here and each check names its row and its numbers.
//
// WHERE THE DRIVE COMES FROM. specs/enemies.md ("The spawn timer") states the
// order the director runs in on every tick `spawning` is on:
//
//   if the window index differs from the previous tick's, the window of tick − 1:
//     spawnTimer = 0
//   spawnTimer counts down
//   if spawnTimer is due and aliveCommons < cap:
//     spawn one enemy of a type chosen uniformly from the window's types,
//     at a spawn point
//     spawnTimer = interval
//
// with "`interval` and `cap` ... the current window's". Two consequences the
// drive rests on. The clock is posed to the window's FIRST tick, so every tick
// the drive runs falls inside the window and the window of the tick before each
// is the same window, which is the condition under which the reset above never
// fires and the row alone decides what happens. And a timer posed to `0` is due
// on the next tick, by specs/world.md ("Timers"): "A timer is due on every tick
// on which it is `0` after its count-down".
//
// THE THREE PARTS. The interval is read as a cadence: the ticks a spawn lands
// on across two whole intervals, which the timer rule fixes at `1`, `1 + k` and
// `1 + 2k` with `k` = `round(interval × TICK_HZ)`, and no tick between. The
// types are read across thirty spawns, each posed by clearing the field and
// setting the timer to `0` so the next tick spawns, so the cap never binds and
// every draw is the window's own; every draw must be one of the row's types,
// and each of them must come up at least once. The cap is read by posing
// exactly `cap` commons alive and running two whole intervals: nothing spawns,
// and the timer rests at `0`, as "When the cap is full the timer rests at `0`"
// states. That reading is one-sided on its own — a build whose cap is BELOW the
// row's satisfies it too — so the cap is read from underneath as well: `cap − 1`
// commons alive and one due tick, on which exactly one enemy must arrive, since
// the rule spawns while "`aliveCommons` is below `cap`" and `cap − 1` is below
// `cap` by the row's own figure. The pair of readings pins the cap from both
// sides, so each row's own check decides that row's figure.
//
// WHY THE FIELD IS CLEARED BETWEEN SPAWNS. `aliveCommons` is "the number of
// live enemies of rank `common` other than gnats", and rows 0 to 9 cap it below
// thirty, so thirty spawns left standing would hit the cap and stop the timer.
// Clearing is a pose of the field alone and decides nothing the check reads:
// which type each spawn is, is the draw the tick made.
//
// WHAT IS HELD. `spawning` alone, so nothing despawns, no scripted event fires,
// nothing moves, nothing touches the lamplighter and no weapon is held. Every
// figure here is `SPAWN_WINDOWS`' own or derived from it by the rules quoted
// above.

import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertTrue,
} from "../assert";
import {
  SPAWN_WINDOWS,
  TIMER_TOL,
  dueTicks,
  windowStartTick,
  type EnemyId,
} from "../constants";
import {
  isolate,
  newEnemies,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** How many spawns the type reading draws. */
export const TYPE_DRAWS = 30;

/** The common posed to fill the cap: rank `common` and not a gnat, so it counts. */
export const CAP_FILLER: EnemyId = "moth";

/** Where the posed commons stand: far enough out to sit clear of the ring. */
const FILLER_X = 2000;

/** The gap between them, so no two share a point. */
const FILLER_GAP = 4;

/** What the cadence run read. */
export interface CadenceReading {
  /** The 1-based ticks of the cadence run on which a spawn landed. */
  spawnTicks: number[];
  /** How many enemies each of those ticks spawned. */
  spawnCounts: number[];
  /** The state the cadence run ended on, for the picture. */
  cadence: WickSnapshot;
}

/** What one window's drive read. */
export interface WindowReading extends CadenceReading {
  /** The type of each of the {@link TYPE_DRAWS} posed spawns, in order. */
  types: EnemyId[];
  /** How many enemies landed across the run at the cap. */
  spawnsAtCap: number;
  /** `aliveCommons` with the cap posed full. */
  aliveAtCap: number;
  /** `spawnTimer` after the run at the cap. */
  timerAtCap: number;
  /** How many enemies landed on one due tick with `cap − 1` commons alive. */
  spawnsUnderCap: number;
  /** `aliveCommons` with one fewer common than the cap posed. */
  aliveUnderCap: number;
}

/** The ticks a cadence run covers: two whole intervals and two ticks over. */
export function cadenceTicks(index: number): number {
  return dueTicks(SPAWN_WINDOWS[index]!.interval) * 2 + 2;
}

/** Pose the clock at the first tick of window `index` with the timer due. */
async function poseWindow(h: Harness, index: number): Promise<void> {
  await h.debug.setTick(windowStartTick(index));
  await h.debug.setSpawnTimer(0);
}

/** Read the cadence: which of the next `cadenceTicks(index)` ticks spawned. */
async function readCadence(h: Harness, index: number): Promise<CadenceReading> {
  await poseWindow(h, index);
  let previous = await h.snapshot();
  const spawnTicks: number[] = [];
  const spawnCounts: number[] = [];
  let cadence = previous;
  for (let tick = 1; tick <= cadenceTicks(index); tick += 1) {
    const after = await h.step(1);
    const arrivals = newEnemies(previous, after);
    if (arrivals.length > 0) {
      spawnTicks.push(tick);
      spawnCounts.push(arrivals.length);
    }
    previous = after;
    cadence = after;
  }
  return { spawnTicks, spawnCounts, cadence };
}

/** Draw `TYPE_DRAWS` spawns, one per tick, with the field cleared between. */
async function readTypes(h: Harness): Promise<EnemyId[]> {
  const types: EnemyId[] = [];
  for (let draw = 0; draw < TYPE_DRAWS; draw += 1) {
    await h.debug.clearEnemies();
    await h.debug.setSpawnTimer(0);
    const before = await h.snapshot();
    const after = await h.step(1);
    const arrivals = newEnemies(before, after);
    assertEqual(
      arrivals.length,
      1,
      `enemies the window spawned on a tick its timer was due (draw ${draw + 1})`,
    );
    types.push(arrivals[0]!.type);
  }
  return types;
}

/** Clear the field and stand `count` commons well clear of the spawn ring. */
async function poseCommons(h: Harness, count: number): Promise<void> {
  await h.debug.clearEnemies();
  for (let held = 0; held < count; held += 1) {
    await h.debug.spawnEnemy(CAP_FILLER, FILLER_X + held * FILLER_GAP, 0);
  }
}

/**
 * Read the cap from both sides: `cap` commons alive across two whole intervals,
 * on which nothing may arrive and the timer must rest, and then `cap − 1`
 * commons alive across one due tick, on which exactly one enemy must arrive.
 */
async function readCap(
  h: Harness,
  index: number,
): Promise<
  Pick<
    WindowReading,
    | "spawnsAtCap"
    | "aliveAtCap"
    | "timerAtCap"
    | "spawnsUnderCap"
    | "aliveUnderCap"
  >
> {
  const cap = SPAWN_WINDOWS[index]!.cap;
  await poseCommons(h, cap);
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();
  const after = await h.step(cadenceTicks(index));

  await poseCommons(h, cap - 1);
  await h.debug.setSpawnTimer(0);
  const room = await h.snapshot();
  const spawned = await h.step(1);

  return {
    spawnsAtCap: newEnemies(before, after).length,
    aliveAtCap: before.run.aliveCommons,
    timerAtCap: after.run.spawnTimer,
    spawnsUnderCap: newEnemies(room, spawned).length,
    aliveUnderCap: room.run.aliveCommons,
  };
}

/**
 * Pose window `index` on an isolated night with `spawning` alone, and read the
 * three figures its row states.
 *
 * `film` wraps the cadence run alone, which is the part of the drive a reviewer
 * watches: the two runs after it pose two hundred commons and clear the field
 * thirty times, and neither is a picture of the window.
 */
export async function readWindow(
  h: Harness,
  index: number,
  film: (scenario: () => Promise<CadenceReading>) => Promise<CadenceReading>,
): Promise<WindowReading> {
  await isolate(h, { on: ["spawning"] });
  const cadence = await film(() => readCadence(h, index));
  const types = await readTypes(h);
  const cap = await readCap(h, index);
  return { ...cadence, types, ...cap };
}

/** Assert every figure of row `index` against what {@link readWindow} read. */
export function assertWindow(index: number, reading: WindowReading): void {
  const row = SPAWN_WINDOWS[index]!;
  const step = dueTicks(row.interval);

  assertDeepEqual(
    reading.spawnTicks,
    [1, 1 + step, 1 + 2 * step],
    `the ticks of window ${index} a spawn landed on, over two intervals of ${row.interval} s`,
  );
  assertDeepEqual(
    reading.spawnCounts,
    [1, 1, 1],
    `enemies each of window ${index}'s due ticks spawned`,
  );

  for (const [draw, type] of reading.types.entries()) {
    assertTrue(
      row.types.includes(type),
      `spawn ${draw + 1} of window ${index} (${type}) among the row's types (${row.types.join(", ")})`,
    );
  }
  for (const type of row.types) {
    assertTrue(
      reading.types.includes(type),
      `${type} among window ${index}'s ${TYPE_DRAWS} spawns (${[...new Set(reading.types)].join(", ")})`,
    );
  }

  assertEqual(
    reading.aliveAtCap,
    row.cap,
    `aliveCommons with window ${index}'s cap of ${row.cap} posed alive`,
  );
  assertEqual(
    reading.spawnsAtCap,
    0,
    `enemies window ${index} spawned across two intervals with its cap full`,
  );
  assertNear(
    reading.timerAtCap,
    0,
    TIMER_TOL,
    `spawnTimer after two intervals with window ${index}'s cap full`,
  );

  assertEqual(
    reading.aliveUnderCap,
    row.cap - 1,
    `aliveCommons with one fewer common than window ${index}'s cap of ${row.cap} posed alive`,
  );
  assertEqual(
    reading.spawnsUnderCap,
    1,
    `enemies window ${index} spawned on a due tick one under its cap of ${row.cap}`,
  );
}
