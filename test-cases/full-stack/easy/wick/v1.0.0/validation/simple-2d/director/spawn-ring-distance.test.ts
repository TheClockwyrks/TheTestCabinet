// director/spawn-ring-distance — every enemy the window timer spawns lands
// exactly `SPAWN_DISTANCE` from the lamplighter's center.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly over the full circle: x = player.x + cos(angle) *
//     SPAWN_DISTANCE; y = player.y + sin(angle) * SPAWN_DISTANCE".
//   - `specs/enemies.md` ("The life of an enemy"): "an enemy spawned on a tick
//     sits at its spawn point for that tick and first moves on the next", so
//     the tick a spawn appears on is where the distance is read.
//   - `specs/instrumentation.md` (`setPlayerPosition`): "Sets the lamplighter's
//     center to `(x, y)`."
//
// WHAT IS READ. Ten spawns in window 0, each read on the tick it appeared: the
// distance from the lamplighter's center to the spawn's center must be 760
// every time. The lamplighter is posed away from the origin first, so a build
// that measured the ring from the world origin rather than from the
// lamplighter misses by the whole of that offset.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on and the field is
// emptied after each spawn, so nothing moves the enemy off its spawn point
// before it is read and the cap never decides whether the next one lands. The
// angle is drawn at random and no check may expect a particular one, so the
// reading is the distance alone.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the distance: 760 through a cosine
// and a sine, then a hypotenuse, is a stated figure read back rather than a
// quantity integrated over ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SPAWN_DISTANCE,
  SPAWN_WINDOWS,
  ticksFor,
} from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, collectSpawns, poseWindow } from "./stage";

/** How many spawns the ring is read over. */
const SPAWNS = 10;

/** Where the lamplighter stands: off the origin, so the ring is read about it. */
const PLAYER_X = 400;
const PLAYER_Y = -250;

/** How far past the last expected spawn the sweep runs before giving up. */
const SWEEP_MARGIN = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every window spawn SPAWN_DISTANCE from the lamplighter", async () => {
  isolate(h);
  enable(h, "spawning");
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  poseWindow(h, 0);

  const interval = ticksFor(SPAWN_WINDOWS[0].interval);
  const spawns = await collectSpawns(
    h,
    SPAWNS,
    SPAWNS * interval + SWEEP_MARGIN,
  );
  await closeIn(h);
  captureStill(h, "ring");

  assertLength(spawns, SPAWNS, "spawns read on the ring");
  for (const spawn of spawns) {
    assertWithin(
      distance(spawn, spawn.player),
      SPAWN_DISTANCE,
      FIGURE_TOLERANCE,
      `the distance from the lamplighter to the spawn on tick ${spawn.tick}`,
    );
  }
});
