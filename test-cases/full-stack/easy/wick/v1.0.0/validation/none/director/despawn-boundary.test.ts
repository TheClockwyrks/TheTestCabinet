// director/despawn-boundary — a common at exactly `DESPAWN_DISTANCE` stays.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Despawning"): "every
// common enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`) units
// from the lamplighter's center is removed". Farther than, strictly, so a moth
// whose center is exactly 1200 units out is not removed however many ticks pass
// while it stands there. 1200 IS THE BOUNDARY and it is posed deliberately: a
// build that wrote "at least" for the rule removes it and fails here, while a
// build that wrote the stated rule keeps it.
//
// WHY SIXTY TICKS. The despawn test runs on every tick `despawning` is on
// (specs/world.md — "One tick", phase 10), so one tick would decide it; sixty
// is a second of game time, long enough that a build that despawns on a slower
// cadence of its own is caught by the same reading.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `despawning` alone.
// `enemyMotion` is off, which is what holds the moth ON the boundary: a moth
// that chased would step 100 × `TICK_DT` units inward on the first tick and the
// boundary would never be tested. The lamplighter stands at the origin and the
// moth on the `x` axis, so the distance is exactly 1200 with no rounding —
// both figures are whole.
//
// THE TOLERANCE. Presence, read exactly. The distance is posed, not measured.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** Sixty ticks, one second of game time. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a moth at exactly 1200 units across 60 ticks", async () => {
  await isolate(h, { on: ["despawning"] });
  const moth = await placeEnemy(h, "moth", DESPAWN_DISTANCE, 0);

  const after = await h.step(HELD_TICKS);
  await captureStill(h, "boundary");

  assertEqual(
    enemyById(after, moth.id) !== undefined,
    true,
    `the moth at exactly ${DESPAWN_DISTANCE} units, after ${HELD_TICKS} ticks with despawning on`,
  );
});
