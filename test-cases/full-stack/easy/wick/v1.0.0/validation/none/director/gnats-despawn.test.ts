// director/gnats-despawn — a gnat despawns by distance like any other common.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Despawning"): "every
// common enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`) units
// from the lamplighter's center is removed ... Gnats are common and despawn the
// same way." The gnat's rank is the roster's ("All ten are rank `common`"), and
// the swarm section repeats it: "Swarm gnats ... despawn by distance like any
// common enemy."
//
// WHY THIS IS ITS OWN POINT. The gnat is the one common that stands OUTSIDE
// another of the director's rules — "`aliveCommons` is the number of live
// enemies of rank `common` other than gnats" — so a build that read that
// exception as a general one and excused gnats from despawning too fails here
// and passes `despawn-beyond-distance`. 1300 is comfortably past the boundary,
// which `despawn-boundary` is the point about.
//
// WHEN IT HAPPENS is specs/world.md ("One tick", phase 10): the despawn runs on
// the tick, so a gnat posed before a tick is gone at the end of it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `despawning` alone.
// `enemyMotion` is off, so the gnat is where it was posed when the distance is
// tested; the lamplighter stands at the origin and the gnat on the `x` axis.
//
// THE TOLERANCE. Presence, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** Comfortably past the boundary the despawn rule states. */
const OUT = 1300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a gnat 1300 units out on the next tick", async () => {
  await isolate(h, { on: ["despawning"] });
  const gnat = await placeEnemy(h, "gnat", OUT, 0);

  const after = await h.step(1);
  await captureStill(h, "gnat");

  assertEqual(
    enemyById(after, gnat.id),
    undefined,
    `the gnat ${OUT} units from the lamplighter, after one tick with despawning on`,
  );
});
