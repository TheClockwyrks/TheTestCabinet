// director/gnats-uncounted — gnats stand outside the spawn cap.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The cap"):
// "`aliveCommons` is the number of live enemies of rank `common` other than
// gnats. Gnats, the elites, and the Dark stand outside the cap: they are never
// counted against it". specs/instrumentation.md reports the same field as "how
// many of `enemies` have `rank` `common` in `ENEMIES` and are not `gnat`, the
// count `specs/enemies.md` holds against the cap". Row 0 of `SPAWN_WINDOWS`
// reads "| 0 | 0:00 | moth | 1.00 | 20 |", so the cap is 20 and the type is
// `moth`.
//
// WHY NINETEEN AND THIRTY. Nineteen moths leave exactly one place under the cap
// of 20, so the spawn that follows proves the director found room; thirty gnats
// are half again the whole cap, so a build that counted them reads 49 against
// 20 and spawns nothing. The two readings — the reported count and the spawn —
// separate a build whose snapshot merely subtracts gnats from one whose
// director does.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// the timer posed to `0`, so the next tick is due by specs/world.md ("Timers").
// `enemyMotion`, `enemyContact` and `despawning` are off, so no gnat drifts
// away, none is removed by distance, and the posed count is exactly the count
// the tick reads. Every posed enemy stands well outside the spawn ring, so the
// enemy the tick adds is told from them by its id alone.
//
// THE TOLERANCE. Whole counts and a type name, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
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

/** Half again the whole cap, so a build that counted them could not spawn. */
const GNATS = 30;

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

it("reads aliveCommons 19 with 30 gnats alive, and spawns on the next due tick", async () => {
  await isolate(h, { on: ["spawning"] });
  for (let at = 0; at < MOTHS; at += 1) {
    await h.debug.spawnEnemy("moth", FILLER_X + at * FILLER_GAP, 0);
  }
  for (let at = 0; at < GNATS; at += 1) {
    await h.debug.spawnEnemy("gnat", -FILLER_X - at * FILLER_GAP, 0);
  }
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();

  const after = await h.step(1);
  await captureStill(h, "gnats");

  assertEqual(
    before.run.aliveCommons,
    MOTHS,
    `aliveCommons with ${MOTHS} moths and ${GNATS} gnats alive`,
  );
  const arrivals = newEnemies(before, after);
  assertEqual(arrivals.length, 1, "enemies the next due tick spawned");
  assertEqual(arrivals[0]!.type, ROW.types[0]!, "the type it spawned");
});
