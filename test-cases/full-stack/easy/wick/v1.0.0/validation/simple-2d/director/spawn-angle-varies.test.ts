// director/spawn-angle-varies — the angle a window spawn lands at is drawn from
// the seeded generator, so it varies within a run and follows the seed between
// runs.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly from the seeded generator".
//   - `specs/enemies.md` ("The spawn director"): "Its randomness, the spawn
//     angle and the type choice, is drawn from the game's seeded generator."
//   - `specs/instrumentation.md` ("A deterministic core"): "The game holds one
//     pseudo-random generator, seeded by `reset` ... every random draw comes
//     from it: a spawn's angle and type"; `reset`: "`options.seed` seeds the
//     generator".
//
// WHAT IS READ. Two readings of the one draw. Across thirty spawns from one
// seed the angles about the lamplighter must not be all equal, which a build
// that spawns at a fixed angle fails. Then two runs from two different seeds
// must place their first spawn at different angles, which a build that draws
// its angles from something other than the seeded generator fails.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on and the field is
// emptied after each spawn, so every angle read belongs to a spawn the timer
// placed on the tick it was read and the cap never intervenes. The lamplighter
// stands still, so the angle is measured about one fixed center.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `ANGLE_SEPARATION` (1e-6 degrees) separates two angles that were
// drawn from two that are the same figure: a build that fixes its angle repeats
// it exactly, and two independent uniform draws land within a millionth of a
// degree of each other about five times in a thousand million.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { DEFAULT_SEED, SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  angleAbout,
  angularOffset,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, collectSpawns, poseWindow, type Spawn } from "./stage";

/** How many spawns the within-a-run reading is taken over. */
const SPAWNS = 30;

/** The second seed: far from `DEFAULT_SEED` (1), and a whole number in range. */
const OTHER_SEED = 987654321;

/** How far apart two angles must be, in degrees, to have been drawn apart. */
const ANGLE_SEPARATION = 1e-6;

/** How far past the last expected spawn a sweep runs before giving up. */
const SWEEP_MARGIN = 4;

const INTERVAL_TICKS = ticksFor(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The angles the spawns landed at, about the lamplighter of their tick. */
function anglesOf(spawns: readonly Spawn[]): number[] {
  return spawns.map((spawn) => angleAbout(spawn.player, spawn));
}

/** Collect `want` window-0 spawns from a run laid with `seed`. */
async function spawnsFromSeed(seed: number, want: number): Promise<Spawn[]> {
  isolate(h, { seed });
  enable(h, "spawning");
  poseWindow(h, 0);
  return collectSpawns(h, want, want * INTERVAL_TICKS + SWEEP_MARGIN);
}

it("draws a spawn's angle at random, and from the seed", async () => {
  const within = await spawnsFromSeed(DEFAULT_SEED, SPAWNS);
  await closeIn(h);
  captureStill(h, "angles");
  assertLength(within, SPAWNS, "spawns read from the first seed");

  const angles = anglesOf(within);
  const spread = angles.filter(
    (angle) => Math.abs(angularOffset(angles[0], angle)) > ANGLE_SEPARATION,
  );
  assertGreaterThan(
    spread.length,
    0,
    "spawn angles differing from the first, across thirty spawns of one seed",
  );

  const other = await spawnsFromSeed(OTHER_SEED, 1);
  assertLength(other, 1, "the first spawn of a run from the other seed");
  const between = Math.abs(angularOffset(angles[0], anglesOf(other)[0]));
  assertGreaterThan(
    between,
    ANGLE_SEPARATION,
    "degrees between the first spawn angles of two seeds",
  );
});
