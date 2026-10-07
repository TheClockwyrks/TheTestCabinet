// director/elites-uncounted — the elites and the Dark are not counted against
// the spawn cap.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The cap"): "`aliveCommons` is the number of live
//     enemies of rank `common` other than gnats. Gnats, the elites, and the
//     Dark stand outside the cap: they are never counted against it, and they
//     spawn whether or not it is full."
//   - `specs/enemies.md` ("Elites and the Dark"): "each stands outside the
//     spawn cap".
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 with a cap of 20
//     and lists `moth` alone.
//
// WHAT IS READ. Nineteen moths, a mothwing, an owl, and the Dark: `aliveCommons`
// must read 19, and the next due tick must spawn, because 19 is under the cap
// of 20. A build that counted the three reads 22 and spawns nothing.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, so the three stand
// where they were posed and nothing removes them; `events` is off, so no
// scripted arrival adds another of them behind the reading.
//
// TOLERANCE. None: a count of enemies and one spawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { poseRing, poseWindow } from "./stage";

const ROW = SPAWN_WINDOWS[0];

/** Moths posed: one under the cap of 20, so one spawn has room. */
const MOTHS = ROW.cap - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the elites and the Dark out of aliveCommons and spawns over them", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);
  poseRing(h, "moth", MOTHS);
  spawnEnemyAt(h, "mothwing", 500, 0);
  spawnEnemyAt(h, "owl", 0, 500);
  spawnEnemyAt(h, "dark", -500, 0);

  const posed = h.snapshot();
  assertEqual(
    posed.run.aliveCommons,
    MOTHS,
    "aliveCommons over 19 moths, a mothwing, an owl, and the Dark",
  );
  assertEqual(posed.run.enemies.length, MOTHS + 3, "enemies on the field");

  const before = posed.run.nextId;
  const after = await h.tick(1);
  captureStill(h, "elites");

  assertGreaterThan(
    after.run.enemies.filter((enemy) => enemy.id >= before).length,
    0,
    "enemies spawned on the due tick with three uncounted enemies alive",
  );
});
