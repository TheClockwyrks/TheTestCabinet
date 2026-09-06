// director/spawn-angle-varies — the angle a window spawn lands at is drawn,
// so it varies within a run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly over the full circle".
//   - `specs/enemies.md` ("The spawn director"): "The spawn angle and the type
//     choice are drawn at random as the rules below state".
//
// WHAT IS READ. Across thirty spawns of one run the angles about the
// lamplighter must not be all equal, which a build that spawns at a fixed
// angle fails. Nothing is posed for the angle, so every draw is the build's
// own; a posed angle is `instrumentation/set-next-spawn-angle`.
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
// it exactly, and thirty independent uniform draws all land within a millionth
// of a degree of the first with probability nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
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

/** How many spawns the reading is taken over. */
const SPAWNS = 30;

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

it("draws a spawn's angle at random rather than fixing it", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);
  const within = await collectSpawns(
    h,
    SPAWNS,
    SPAWNS * INTERVAL_TICKS + SWEEP_MARGIN,
  );
  await closeIn(h);
  captureStill(h, "angles");
  assertLength(within, SPAWNS, "spawns read from the run");

  const angles = anglesOf(within);
  const spread = angles.filter(
    (angle) => Math.abs(angularOffset(angles[0], angle)) > ANGLE_SEPARATION,
  );
  assertGreaterThan(
    spread.length,
    0,
    "spawn angles differing from the first, across thirty spawns",
  );
});
