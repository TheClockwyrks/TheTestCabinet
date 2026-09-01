// director/dark-never-despawns — the Dark is never removed by distance.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Despawning"): "every
// common enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`) units
// from the lamplighter's center is removed ... Elites and the Dark are outside
// this rule and stay on the field at any distance." The roster ("Elites and the
// Dark") gives the Dark its rank,
//
// | The Dark | `dark` | `dark` | 10000 | 170 | 50 | 40 | nothing | chase |
//
// and the paragraph under it says of the three that "each stays on the field
// however far the lamplighter travels, until it dies or the run ends".
//
// WHY 3000 UNITS. Two and a half times the `DESPAWN_DISTANCE` a common is
// removed past, so a build that applied the common's rule to the Dark
// removes it on the first tick and fails on the first reading. Sixty ticks is a
// second of game time, which also catches a build that despawns on a slower
// cadence of its own.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `despawning` alone,
// so the only rule that could remove anything is the one this point is about.
// `enemyMotion` is off, which is what holds it at 3000: a chaser moving at its
// own speed would walk inside the boundary and the point would decide nothing.
// The lamplighter stands at the origin and it stands on the `x` axis.
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

/** Two and a half times the distance a common is removed past. */
const FAR = 3000;

/** Sixty ticks, one second of game time. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the Dark 3000 units out across 60 ticks of despawning", async () => {
  await isolate(h, { on: ["despawning"] });
  const kept = await placeEnemy(h, "dark", FAR, 0);

  const after = await h.step(HELD_TICKS);
  await captureStill(h, "kept");

  assertEqual(
    enemyById(after, kept.id) !== undefined,
    true,
    `The Dark ${FAR} units from the lamplighter, after ${HELD_TICKS} ticks with despawning on`,
  );
});
