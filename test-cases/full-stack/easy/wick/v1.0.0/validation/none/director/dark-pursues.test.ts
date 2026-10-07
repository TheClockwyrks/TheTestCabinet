// director/dark-pursues — the Dark chases, at its own speed, on a heading it
// recomputes every tick.
//
// WHERE THE THRESHOLD COMES FROM. The roster (specs/enemies.md — "Elites and
// the Dark") gives the Dark its speed and its behavior,
// "| The Dark | `dark` | `dark` | 10000 | 170 | 50 | 40 | nothing | chase |",
// and ("Chase") states what a chaser does: "Each tick a chasing enemy
// recomputes its heading as the unit vector from its center to the
// lamplighter's center and advances one step along it. The heading is
// recomputed every tick, so a chaser turns with the lamplighter as it moves."
// One step is ("Movement") "`speed * TICK_DT` units", so `170 / 60`, 2.8333
// units a tick.
//
// WHY THE LAMPLIGHTER IS MOVED MID-DRIVE. A chaser walking at a lamplighter
// that never moves is indistinguishable from a drifter that spawned pointing at
// one, so the reading would decide nothing about the recomputation. The
// lamplighter is put somewhere else between the first tick and the second, with
// `setPlayerPosition(x, y)`, which "Sets the lamplighter's center to `(x, y)`.
// Nothing else moves", so the only thing that changed between the two ticks is
// what the Dark's heading is computed from. Each of the three ticks is then
// read against the positions of the tick it began: the step's length is
// `speed × TICK_DT` and its direction is the unit vector from where the Dark
// stood to where the lamplighter stood.
//
// WHY THE DARK IS SPAWNED RATHER THAN CARRIED TO. `spawnEnemy(type, x, y)`
// "Spawns one enemy of `type` ... through the real spawn path ... and its
// heading is the one `specs/enemies.md` gives a spawn at that point", so this
// is the same Dark the 9:00 event puts on the ring, posed where the check can
// watch it rather than at an angle the generator drew. Its spawn tick is
// excluded from the reading, because an enemy spawned on a tick "sits at its
// spawn point and first moves on the next" (specs/world.md — "One tick").
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `enemyMotion` alone.
// `enemyContact` is off, so the Dark closing on the lamplighter lands no hit
// and cannot end the run mid-reading; `spawning`, `events` and `despawning` are
// off, so nothing else arrives or leaves. The Dark starts 800 units out, well
// past the 52 its radius and the lamplighter's sum to, so it never reaches the
// lamplighter inside the span and the "centers coincide" case never arises.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position integrated on the tick
// is allowed, on a step of 2.8333 units and on the components of a unit vector.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, POSITION_TOL, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  player,
  unitToward,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** One step of the Dark: `170 × TICK_DT`. */
const STEP = ENEMIES.dark.speed * TICK_DT;

/** Where the Dark stands: far enough that it never reaches the lamplighter. */
const START = { x: 0, y: -800 };

/** Where the lamplighter is put after the first tick, so the heading must turn. */
const MOVED = { x: 800, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the Dark 170 × TICK_DT a tick toward wherever the lamplighter is", async () => {
  await isolate(h, { on: ["enemyMotion"] });
  const dark = await placeEnemy(h, "dark", START.x, START.y);

  const ticks = await captureReplay(h, "pursuit", async () => {
    const seen: WickSnapshot[] = [];
    seen.push(await h.snapshot());
    seen.push(await h.step(1));
    await h.debug.setPlayerPosition(MOVED.x, MOVED.y);
    seen.push(await h.snapshot());
    seen.push(await h.step(1));
    seen.push(await h.step(1));
    return seen;
  });

  const steps: [WickSnapshot, WickSnapshot][] = [
    [ticks[0]!, ticks[1]!],
    [ticks[2]!, ticks[3]!],
    [ticks[3]!, ticks[4]!],
  ];
  for (const [at, count] of steps.entries()) {
    const before = mustEnemy(count[0], dark.id);
    const after = mustEnemy(count[1], dark.id);
    const moved = { x: after.x - before.x, y: after.y - before.y };
    const toward = unitToward(before, player(count[0]));
    assertNear(
      Math.hypot(moved.x, moved.y),
      STEP,
      POSITION_TOL,
      `the Dark's step on tick ${at + 1} of the pursuit`,
    );
    assertNear(
      moved.x,
      toward!.x * STEP,
      POSITION_TOL,
      `the x of the Dark's step on tick ${at + 1} of the pursuit`,
    );
    assertNear(
      moved.y,
      toward!.y * STEP,
      POSITION_TOL,
      `the y of the Dark's step on tick ${at + 1} of the pursuit`,
    );
  }
});
