// director/elites-uncounted — the elites and the Dark stand outside the spawn
// cap.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The cap"):
// "`aliveCommons` is the number of live enemies of rank `common` other than
// gnats. Gnats, the elites, and the Dark stand outside the cap: they are never
// counted against it, and they spawn whether or not it is full." The roster
// ("Elites and the Dark") gives the three their ranks — mothwing and owl
// `elite`, the Dark `dark` — and says of them that "each stands outside the
// spawn cap". Row 0 of `SPAWN_WINDOWS` reads "| 0 | 0:00 | moth | 1.00 | 20 |",
// so the cap is 20 and the type is `moth`.
//
// WHY NINETEEN AND THREE. Nineteen moths leave exactly one place under the cap
// of 20, so the spawn that follows proves the director found room. A build that
// counted the three by rank rather than excluding them reads 22 against 20 and
// spawns nothing. This is the point `gnats-uncounted` is not: the gnat is a
// common the cap excludes by name, and these three are excluded by rank.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// the timer posed to `0`, so the next tick is due by specs/world.md ("Timers").
// `enemyMotion`, `enemyContact` and `despawning` are off, so nothing moves,
// nothing hits, and nothing is removed by distance; the elites and the Dark are
// outside the despawn rule anyway, and the moths are inside it, so holding it
// keeps the posed count exact. Everything stands well outside the spawn ring.
//
// THE TOLERANCE. Whole counts and a type name, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS, UNCAPPED_ENEMY_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** Row 0's cap and its one type. */
const ROW = SPAWN_WINDOWS[0]!;

/** One place under the cap. */
const MOTHS = ROW.cap - 1;

/** Where the posed enemies stand: well outside the spawn ring. */
const FILLER_X = 2000;

/** The gap between them, so no two share a point. */
const FILLER_GAP = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads aliveCommons 19 with a mothwing, an owl and the Dark alive", async () => {
  await isolate(h, { on: ["spawning"] });
  for (let at = 0; at < MOTHS; at += 1) {
    await h.debug.spawnEnemy("moth", FILLER_X + at * FILLER_GAP, 0);
  }
  for (const [at, id] of UNCAPPED_ENEMY_IDS.entries()) {
    await h.debug.spawnEnemy(id, -FILLER_X - at * 100, 0);
  }
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();

  const after = await h.step(1);
  await captureStill(h, "elites");

  assertEqual(
    before.run.aliveCommons,
    MOTHS,
    `aliveCommons with ${MOTHS} moths, a mothwing, an owl and the Dark alive`,
  );
  const arrivals = newEnemies(before, after);
  assertEqual(arrivals.length, 1, "enemies the next due tick spawned");
  assertEqual(arrivals[0]!.type, ROW.types[0]!, "the type it spawned");
});
