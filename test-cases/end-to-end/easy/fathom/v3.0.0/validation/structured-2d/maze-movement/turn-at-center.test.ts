// maze-movement/turn-at-center — a perpendicular direction set mid-tile is
// buffered and taken at the next tile center, and nowhere else.
//
// specs/movement.md fixes both halves of this in one table and the paragraph
// under it. A desired direction "perpendicular to the current heading" is honored
// "at the next tile center the forager reaches, if the tile that way is open to
// it", and "The desired direction is buffered, so a direction set slightly before
// a junction is still the desired direction when the junction's center arrives,
// and the forager takes the turn there. A turn onto a perpendicular direction is
// taken at a tile center and nowhere else."
//
// So the scenario sets the turn WHILE THE FORAGER IS MID-TILE and asks three
// things of what follows: that the old heading survives the press, that the turn
// is taken at all, and that the point it is taken at is the junction's center.
// The third is read as the off-axis coordinate at the tick the heading flips —
// once the forager is heading down, its `x` stops changing, so `x` at that moment
// IS the point the turn was taken at.
//
// ONE KEY AT A TIME. The approach key is RELEASED before the perpendicular goes
// down. specs/movement.md defines a single desired direction that the movement
// actions set and says nothing about which of two simultaneously held keys wins,
// so a check that held both would be riding on a tie-break the specification
// deliberately left open: against a build that resolves it oldest-first the
// forager never turns at all, and the "not taken mid-tile" reading would then
// pass for exactly the wrong reason.
//
// THE CORNER IS POSED. Which junctions a board offers, and how much room sits
// either side of them, is the build's own design (specs/maze.md), and both arms
// run on PAST the junction, so a forager that never takes the turn swims straight
// on rather than being stopped by rock — the turn has to be the thing that moves
// it off the approach axis.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { poseCorner } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  DIR_KEY,
  startPlaying,
  type Harness,
} from "../harness";
import { denAll, requireSwim, sceneGuard, sceneHeld } from "../scene";
import type { FathomSnapshot } from "../surface";

/** Tiles of corridor each arm carries past the junction. */
const ARM = 5;

/**
 * How far past the approach tile's center the perpendicular is set, in logical
 * units.
 *
 * A quarter of a tile. Comfortably off the center it just left and comfortably
 * short of the half-tile boundary, so the press lands at a point the rule under
 * test forbids a turn at, which is the whole reason the check presses there.
 */
const BUFFER_AT = TILE / 4;

/** Hard bound on the approach, in ticks: a whole tile at `FORAGER_SPEED` is 30. */
const APPROACH_MAX_TICKS = 60;

/**
 * Ticks between the perpendicular going down and the heading being read, so a
 * build that acts on a key the moment it arrives has had its chance to.
 *
 * Two ticks is `1/60 s` and about two logical units of travel, so the forager is
 * still well inside the tile it was mid-way across.
 */
const SETTLE_TICKS = 2;

/**
 * Hard bound on the turn, in ticks.
 *
 * The junction center sits a little under three quarters of a tile ahead of the
 * press, which is about twenty ticks at `FORAGER_SPEED`. Sixty is triple that, so
 * a build that never takes the turn FAILS here rather than being waited on.
 */
const TURN_MAX_TICKS = 60;

/** Ticks watched after the turn, to see the new axis actually begin. */
const AXIS_TICKS = 30;

/** Ticks the turn key stays down past the last reading, purely for the clip. */
const TAIL_TICKS = 60;

/**
 * How far the off-axis coordinate may sit from the junction center's, in logical
 * units.
 *
 * The point's own bound: one unit. A turn taken at the center leaves the
 * off-axis coordinate exactly on it, and one tick of travel at `FORAGER_SPEED`
 * is `1.07` units, so a build that carries on past the center and turns a tick
 * later is outside this — which is what "at a tile center and nowhere else"
 * says.
 */
const CENTER_TOLERANCE = 1;

/** How far a coordinate sits from the nearest tile center on its axis. */
function offCenter(value: number, origin: number, tile: number): number {
  const within = ((((value - origin) % tile) + tile) % tile) - tile / 2;
  return Math.abs(within);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("buffers a perpendicular direction set mid-tile and takes the turn at the junction center", async () => {
  startPlaying(h);
  const corner = await poseCorner(h, { arm: ARM });
  const quiet = await denAll(h);
  // The forager is the SUBJECT here, so it is not held to staying put; the guard
  // still catches a life lost, a predator loose, or the dive leaving live play.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const opening = h.snapshot();
  const grid = opening.grid;
  const back = centerOf(opening, corner.back);
  const junction = centerOf(opening, corner.junction);
  const approachKey = DIR_KEY[corner.approach];
  const perpKey = DIR_KEY[corner.perp];

  const drive = await captureReplay(h, "turn", async () => {
    const resting = h.snapshot();
    // Swim up to the junction and stop a quarter of a tile past the last center.
    h.hold(approachKey);
    let approached = resting;
    for (let tick = 0; tick < APPROACH_MAX_TICKS; tick += 1) {
      await h.advance(1);
      approached = h.snapshot();
      if (approached.forager.x - back.x >= BUFFER_AT) break;
    }
    // One key at a time: let go of the approach, then buffer the turn.
    h.release(approachKey);
    h.hold(perpKey);
    await h.advance(SETTLE_TICKS);
    const midway = h.snapshot();

    // Watch every tick for the heading to flip, so the reading is the FIRST
    // moment the turn was taken rather than wherever a fixed wait happened to
    // land.
    let turned: FathomSnapshot | null = null;
    for (let tick = 0; tick < TURN_MAX_TICKS && turned === null; tick += 1) {
      await h.advance(1);
      const snap = h.snapshot();
      if (snap.forager.dir === corner.perp) turned = snap;
    }
    await h.advance(AXIS_TICKS);
    const along = h.snapshot();
    // Held on past every reading, so the clip shows the forager swimming down
    // the new arm rather than stopping at the moment the verdict was taken.
    await h.advance(TAIL_TICKS);
    h.release(perpKey);
    return { resting, approached, midway, turned, along };
  });

  assertNull(sceneHeld(h.snapshot(), guard), "the scenario held to the end");

  // Whether a held action carries the forager anywhere is `controls/move-*`'s
  // verdict; a forager that never reached the junction has no turn to take.
  requireSwim(
    drive.resting.forager,
    drive.approached.forager,
    "swim up to the junction the turn is taken at",
  );

  // The fixture's own claim: the turn was asked for AWAY from a tile center.
  assertGreaterThanOrEqual(
    offCenter(drive.approached.forager.x, grid.originX, grid.tile),
    BUFFER_AT,
    "logical units between the forager's center and the nearest tile center " +
      "when the perpendicular direction was set",
  );

  assertEqual(
    drive.midway.forager.dir,
    corner.approach,
    `the forager's heading ${SETTLE_TICKS} ticks after the perpendicular was ` +
      "set mid-tile, which specs/movement.md honors only at the next tile center",
  );

  assertEqual(
    drive.turned !== null,
    true,
    `the buffered turn onto ${corner.perp} was taken within ` +
      `${TURN_MAX_TICKS} ticks of being set`,
  );
  if (drive.turned === null) return;

  assertLessThanOrEqual(
    Math.abs(drive.turned.forager.x - junction.x),
    CENTER_TOLERANCE,
    `|x - the junction center's x| at the tick the heading became ` +
      `${corner.perp}, in logical units`,
  );

  assertGreaterThanOrEqual(
    drive.along.forager.y - drive.turned.forager.y,
    TILE / 2,
    `logical units travelled down the new arm in the ${AXIS_TICKS} ticks after ` +
      "the turn",
  );
});
