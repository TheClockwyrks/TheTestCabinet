// director/window-spawns-land — with `spawning` on, the director puts an enemy
// on the field early in a fresh run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn director"): the director "runs on every
//     tick of the `playing` screen ... the spawn timer counts and spawns while
//     `spawning` is on".
//   - `specs/enemies.md` ("The spawn timer"): "`spawnTimer` ... is set to `0`
//     when a run starts", and "if `spawnTimer` is due and `aliveCommons` <
//     `cap`: spawn one enemy of a type chosen uniformly from the window's
//     types, at a spawn point". "A spawn therefore lands on the first tick of a
//     run".
//   - `specs/enemies.md` ("Windows"): window 0 applies from 0:00 with an
//     interval of 1.00 s and a cap of 20, so a fresh run's field has room.
//
// WHAT IS READ. Whether an enemy is on the field within the first 120 ticks of
// a fresh run, two whole window-0 intervals: the coarsest reading of the
// director there is, and the one a build that never spawns fails.
//
// WHY THE NIGHT IS POSED AS IT IS. The run is emptied and every switch is held
// but `spawning`, so the enemy that appears can only have come from the spawn
// timer: nothing was posed on the field, no scripted event fires, and nothing
// moves or is removed.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. None: the sweep is a whole count of ticks, and the reading is
// whether the field holds an enemy.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn } from "./stage";

/** Two of window 0's intervals: 120 ticks, the span the item allows. */
const LANDING_TICKS = 2 * ticksFor(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts an enemy on the field within the first 120 ticks of a run", async () => {
  isolate(h);
  enable(h, "spawning");

  const landed = await h.until((snapshot) => snapshot.run.enemies.length > 0, {
    maxTicks: LANDING_TICKS,
  });
  await closeIn(h);
  captureStill(h, "spawned");

  assertEqual(landed.hit, true, "an enemy on the field within 120 ticks");
  assertGreaterThan(
    landed.snapshot.run.enemies.length,
    0,
    "enemies the director spawned",
  );
});
