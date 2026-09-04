// amber/drifter-speed — a drifter holds `DRIFTER_SPEED` along a corridor.
//
// specs/gameplay.md: a drifter travels "at `DRIFTER_SPEED` (`64` logical units
// per second), half the forager's speed". The figure is half of the bluff at the
// center of the game: specs/gameplay.md has a wandering Lanternjaw drift at the
// same rate so the two amber lights are alike "in look and in motion", and a
// drifter moving at any other pace is told from a Lanternjaw across the maze
// without ever committing to it.
//
// THE PACE IS MEASURED AS PATH, NOT AS DISPLACEMENT. A drifter "changes direction
// at tile centers", so a straight line between two samples cuts every corner it
// turned. The window below sums the ground covered tick by tick, and is measured
// on a ring wide enough that a stretch of four tiles spans a turn or two at most —
// what a single right-angle turn taken inside one tick costs the sum is a
// fraction of a unit, well inside the two percent this point allows.
//
// THE WORLD HOLDS THE FORAGER AND ONE DRIFTER. `poseApart` empties the board, so
// the roster is gone, no plankton stand on it, and — because specs/gameplay.md
// admits drifters at the gate only "while plankton remain in the maze" — the
// cadence lets none in. The drifter measured is the one this check spawned.
//
// AND IT PATROLS A RING OF ITS OWN, across solid rock from the forager, so it
// cannot arrive and be eaten before the window is up.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { DRIFTER_SPEED, FORAGER_SPEED, TICK_HZ, TILE } from "../constants";
import { poseApart, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type FathomSnapshot,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { ticksFor } from "../constants";

/**
 * The ring the drifter patrols, in tiles along its top edge.
 *
 * Twelve, so the window below sits mostly on straight corridor: a ring this size
 * runs some thirty tiles round, and four tiles of travel across it meets a corner
 * once or twice rather than every half second.
 */
const RING = 12;

/** How far that sealed ring stands from the forager's room, in tiles. */
const APART = 14;

/** The stretch the pace is measured over, in tiles. The item asks for four. */
const MEASURED_TILES = 4;

/**
 * Ticks the window covers.
 *
 * The ticks `DRIFTER_SPEED` (`64`) takes to cover `MEASURED_TILES` tiles, which
 * is two seconds at the specification's own figure. A build travelling slower
 * simply covers less ground inside it, which is what the reading then says.
 */
const PACE_TICKS = ticksFor((MEASURED_TILES * TILE) / DRIFTER_SPEED);

/** Ticks of drifting the clip carries after the window, for a readable tail. */
const TAIL_TICKS = ticksFor(1);

/**
 * How far a measured pace may sit from `DRIFTER_SPEED`, in logical units per
 * second.
 *
 * The review item's own bound: two percent of the `64` specs/gameplay.md fixes.
 */
const PACE_TOLERANCE = DRIFTER_SPEED * 0.02;

/** One bonus drifter, as the snapshot reports it. */
type Drifter = FathomSnapshot["drifters"][number];

/** The drifter nearest a point, which is the one a previous sample followed. */
function drifterNear(
  snapshot: FathomSnapshot,
  to: { x: number; y: number } | null,
): Drifter | null {
  if (snapshot.drifters.length === 0) return null;
  if (to === null) return snapshot.drifters[0];
  return snapshot.drifters.reduce((best, one) =>
    Math.hypot(one.x - to.x, one.y - to.y) <
    Math.hypot(best.x - to.x, best.y - to.y)
      ? one
      : best,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wanders at DRIFTER_SPEED, half the forager's own speed", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING });
  await parkForager(h, rooms.near);
  await spawnDrifter(h, rooms.far);
  const guard = await sceneGuard(h);

  const measured = await captureReplay(h, "pace", async () => {
    let previous = drifterNear(await h.snapshot(), null);
    let path = 0;
    let held = previous !== null;
    for (let tick = 0; tick < PACE_TICKS; tick += 1) {
      await h.advance(1);
      const now = drifterNear(await h.snapshot(), previous);
      if (now === null || previous === null) {
        held = false;
        previous = now;
        continue;
      }
      path += Math.hypot(now.x - previous.x, now.y - previous.y);
      previous = now;
    }
    await h.advance(TAIL_TICKS);
    return { path, held, end: await h.snapshot() };
  });

  requireSceneHeld(measured.end, guard);
  assertEqual(
    measured.held,
    true,
    "the drifter was in the list at every tick of the window, so the ground " +
      "summed below is one creature's own path",
  );

  const speed = (measured.path * TICK_HZ) / PACE_TICKS;
  assertGreaterThanOrEqual(
    measured.path,
    MEASURED_TILES * TILE * 0.9,
    `logical units of corridor the drifter covered over the window, against ` +
      `the ${String(MEASURED_TILES)} tiles this point measures across`,
  );
  assertLessThanOrEqual(
    Math.abs(speed - DRIFTER_SPEED),
    PACE_TOLERANCE,
    `how far the drifter's pace sits from DRIFTER_SPEED (${String(DRIFTER_SPEED)}), ` +
      `which is half the forager's FORAGER_SPEED (${String(FORAGER_SPEED)}), ` +
      `measured as ground covered along its own path over ${String(PACE_TICKS)} ticks`,
  );
});
