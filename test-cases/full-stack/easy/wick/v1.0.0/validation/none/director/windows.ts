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
// types are read two ways. Each type the row lists is posed in turn through
// `setNextSpawnType`, which specs/instrumentation.md gives the surface for this
// draw ("The next window spawn is of that type in place of the type drawn from
// the window's types"), and the spawn the next due tick lands must be of it: a
// build whose window cannot spawn one of the row's types fails on that type.
// Then `UNPOSED_DRAWS` spawns are drawn with nothing posed, each on its own due
// tick with the field cleared between so the cap never binds, and every one
// must be a type the row lists: a build that reaches into another window's
// roster fails on the first spawn outside it. The cap is read by posing
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
// live enemies of rank `common` other than gnats", and every spawn left standing
// counts toward the cap, so the field is cleared before each posed and unposed
// draw. Clearing is a pose of the field alone and decides nothing the check
// reads: which type each spawn is, is the draw the tick made.
//
// HOW THE CAP'S CROWD IS POSED. A row's cap runs to `200`, and each of those
// commons is posed through the build's own `window.__wick.spawnEnemy`, called
// the way any caller would call it; what one evaluation saves over one crossing
// per common is the round trips, exactly as `rollDrops` in `../pickups/stage`
// makes its calls.
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
  HANDLE,
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

/** How many spawns are drawn with nothing posed for the type. */
export const UNPOSED_DRAWS = 6;

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

/** One posed type and what the due tick spawned under it. */
export interface PosedSpawn {
  /** The type posed through `setNextSpawnType`. */
  posed: EnemyId;
  /** The type of the enemy the next due tick spawned. */
  spawned: EnemyId;
}

/** What one window's drive read. */
export interface WindowReading extends CadenceReading {
  /** Each of the row's types posed in turn, and what spawned under it. */
  posedTypes: PosedSpawn[];
  /** The type of each of the {@link UNPOSED_DRAWS} unposed spawns, in order. */
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

/** Clear the field, make the timer due, and read the type the next tick spawns. */
async function drawOne(h: Harness, label: string): Promise<EnemyId> {
  await h.debug.clearEnemies();
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();
  const after = await h.step(1);
  const arrivals = newEnemies(before, after);
  assertEqual(
    arrivals.length,
    1,
    `enemies the window spawned on a tick its timer was due (${label})`,
  );
  return arrivals[0]!.type;
}

/** Pose each of the row's types in turn and read what spawned under each. */
async function readPosedTypes(
  h: Harness,
  index: number,
): Promise<PosedSpawn[]> {
  const posedTypes: PosedSpawn[] = [];
  for (const posed of SPAWN_WINDOWS[index]!.types) {
    await h.debug.setNextSpawnType(posed);
    const spawned = await drawOne(h, `${posed} posed`);
    posedTypes.push({ posed, spawned });
  }
  return posedTypes;
}

/** Draw `UNPOSED_DRAWS` spawns with nothing posed, one per due tick. */
async function readUnposedTypes(h: Harness): Promise<EnemyId[]> {
  const types: EnemyId[] = [];
  for (let draw = 0; draw < UNPOSED_DRAWS; draw += 1) {
    types.push(await drawOne(h, `unposed draw ${draw + 1}`));
  }
  return types;
}

/**
 * Clear the field and stand `count` commons well clear of the spawn ring, all
 * through the build's own `spawnEnemy` inside one evaluation.
 */
async function poseCommons(h: Harness, count: number): Promise<void> {
  await h.debug.clearEnemies();
  await h.page.evaluate(
    ([handle, type, total, x, gap]) => {
      const api = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle];
      if (api === undefined) {
        throw new Error(`wick: the surface ${handle} is not installed`);
      }
      for (let held = 0; held < total; held += 1) {
        api.spawnEnemy!(type, x + held * gap, 0);
      }
    },
    [HANDLE, CAP_FILLER, count, FILLER_X, FILLER_GAP] as const,
  );
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
 * watches: the runs after it pose a crowd and clear the field between draws,
 * and neither is a picture of the window.
 */
export async function readWindow(
  h: Harness,
  index: number,
  film: (scenario: () => Promise<CadenceReading>) => Promise<CadenceReading>,
): Promise<WindowReading> {
  await isolate(h, { on: ["spawning"] });
  const cadence = await film(() => readCadence(h, index));
  const posedTypes = await readPosedTypes(h, index);
  const types = await readUnposedTypes(h);
  const cap = await readCap(h, index);
  return { ...cadence, posedTypes, types, ...cap };
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

  assertDeepEqual(
    reading.posedTypes.map((entry) => entry.posed),
    [...row.types],
    `the types posed for window ${index}, one per type the row lists`,
  );
  for (const { posed, spawned } of reading.posedTypes) {
    assertEqual(
      spawned,
      posed,
      `the type window ${index} spawned with ${posed} posed`,
    );
  }
  for (const [draw, type] of reading.types.entries()) {
    assertTrue(
      row.types.includes(type),
      `unposed spawn ${draw + 1} of window ${index} (${type}) among the row's types (${row.types.join(", ")})`,
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
