// maze-movement/reverse-anytime — the opposite direction is honored where the
// forager stands, without waiting for a tile center.
//
// specs/movement.md states it in the turning table: a desired direction that is
// "the opposite of the current heading" is honored "At once, wherever the forager
// stands", against the perpendicular's "At the next tile center the forager
// reaches". So the whole point of this check is the WHERE: the reversal has to be
// asked for at a point that is not a tile center, and the heading has to flip
// before the forager reaches the next one.
//
// SO THE REVERSAL IS ASKED FOR AT THE FARTHEST POINT FROM ANY CENTER. Seventy-five
// ticks of held travel is two tiles and a half at `FORAGER_SPEED`, which lands the
// forager on a tile boundary — half a tile from the center behind it and half a
// tile from the center ahead. A center-only build has nowhere to hide there, and
// the window the flip is watched over is short enough that the forager cannot
// reach the next center inside it, so a flip seen in that window can only be the
// reversal rule.
//
// ONE KEY AT A TIME. The forward key is RELEASED before the opposite goes down,
// which is both what a player does and the only thing specs/movement.md pins
// down: it defines a single desired direction the movement actions set and never
// says which of two simultaneously held keys wins. An earlier form of this check
// pressed the opposite while still holding the forward key and so rode on that
// unspecified tie-break, failing builds whose reversal is exactly right.
//
// AND THE POSITION IS READ A BEAT AFTER THE FLAG. specs/state.md keeps `dir` and
// `moving` as separate readings, and a build that flips its heading on the tick the
// action arrives and starts the return on the next conforms just as one that does
// both at once does. So the heading is read at the flip and the travel over the
// thirty ticks that follow it.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  DIR_KEY,
  requireForagerMotion,
  startPlaying,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { FathomSnapshot } from "../surface";

/**
 * The corridor: the forager starts on `F`, with room to run forward and room to
 * swim back through once it has turned around.
 *
 * specs/maze.md fixes no run length, so the corridor is posed rather than
 * hunted for, and the board it is stamped on carries no plankton, so swimming it
 * clears nothing.
 */
const CORRIDOR = ["..F..........."];

/** The heading the forager runs on before it is turned around. */
const FORWARD = "right" as const;

/** The heading the reversal asks for. */
const BACK = "left" as const;

/**
 * How long the forward run is held before the reversal, in ticks.
 *
 * Two tiles and a half at `FORAGER_SPEED` (`128`), where a tile is thirty ticks.
 * Deliberately not a whole number of tiles: that would park the forager on a
 * center, which is the one place a turn is unremarkable. A boundary is the point
 * of a tile FARTHEST from any center, which is where the rule under test has
 * nothing to lean on.
 */
const FORWARD_TICKS = 75;

/**
 * How much corridor must lie between the reversal point and the next tile center
 * ahead, in logical units.
 *
 * The fixture's own claim, asserted rather than assumed: with this much room the
 * forager cannot reach a center inside the window the flip is watched over, so a
 * flip seen there cannot be a center-taken turn wearing the reversal's name.
 */
const CENTER_CLEARANCE = 12;

/**
 * How long the flip is watched for, in ticks.
 *
 * Eight ticks is `1/15 s` and `8.5` units of travel at `FORAGER_SPEED` — less
 * than the `CENTER_CLEARANCE` above, so the forager provably does not reach a
 * tile center inside it. A build that has not reversed by then has not honored
 * the opposite "at once", so this is a hard bound and a build that waits for the
 * center FAILS here rather than being waited on.
 */
const REVERSE_MAX_TICKS = 8;

/** Ticks watched after the flip, to see the return actually under way. */
const BACK_TICKS = 30;

/** How far the forager must have come back over those ticks, in logical units. */
const BACK_MIN = TILE / 2;

/** Ticks the reverse key stays down past the last reading, purely for the clip. */
const TAIL_TICKS = 60;

/** The nearest tile center strictly ahead of `x` along the `+x` axis. */
function nextCenterAhead(x: number, origin: number, tile: number): number {
  const index = Math.floor((x - origin - tile / 2) / tile) + 1;
  return origin + index * tile + tile / 2;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reverses the forager where it stands, without waiting for a tile center", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, CORRIDOR);
  const start = board.mark("F");
  await h.debug.setForagerTile(start.tx, start.ty);
  await h.debug.setForagerDir(FORWARD);
  // The forager is the SUBJECT, so it is not held to staying put; the guard still
  // catches a life lost, a predator loose, or the dive leaving live play.
  const guard = await sceneGuard(h, { foragerParked: false });

  const opening = h.snapshot();
  const grid = opening.grid;
  const home = centerOf(opening, start);

  const drive = await captureReplay(h, "reverse", async () => {
    const resting = h.snapshot();
    h.hold(DIR_KEY[FORWARD]);
    await h.advance(FORWARD_TICKS);
    const midway = h.snapshot();
    // One key at a time: let go of the forward key, then ask for the opposite.
    h.release(DIR_KEY[FORWARD]);
    h.hold(DIR_KEY[BACK]);

    let flipped: FathomSnapshot | null = null;
    for (
      let tick = 0;
      tick < REVERSE_MAX_TICKS && flipped === null;
      tick += 1
    ) {
      await h.advance(1);
      const snap = h.snapshot();
      if (snap.forager.dir === BACK) flipped = snap;
    }
    await h.advance(BACK_TICKS);
    const returning = h.snapshot();
    // Held on past every reading, so the clip shows the forager swimming back
    // the way it came rather than stopping where the verdict was taken.
    await h.advance(TAIL_TICKS);
    h.release(DIR_KEY[BACK]);
    return { resting, midway, flipped, returning };
  });

  requireSceneHeld(h.snapshot(), guard);

  // A forager that never got under way has no heading to reverse; whether a held
  // action moves it at all is `controls/move-*`'s verdict.
  requireForagerMotion(
    drive.resting,
    drive.midway,
    "get under way before the reversal",
  );
  assertEqual(
    drive.midway.forager.dir,
    FORWARD,
    `the forager's heading after ${FORWARD_TICKS} ticks of held travel from ` +
      `tile (${start.tx}, ${start.ty})`,
  );

  // The fixture's own claim: the reversal is asked for away from a tile center,
  // with room enough that none can be reached inside the window below.
  const ahead = nextCenterAhead(
    drive.midway.forager.x,
    grid.originX,
    grid.tile,
  );
  assertGreaterThanOrEqual(
    ahead - drive.midway.forager.x,
    CENTER_CLEARANCE,
    "logical units between the forager and the next tile center ahead when the " +
      `opposite direction was asked for, ${(drive.midway.forager.x - home.x).toFixed(2)} ` +
      "units along the run",
  );

  assertEqual(
    drive.flipped !== null,
    true,
    `the forager's heading became ${BACK} within ${REVERSE_MAX_TICKS} ticks of ` +
      "the opposite direction being asked for, which specs/movement.md honors " +
      "at once wherever it stands",
  );
  if (drive.flipped === null) return;

  assertLessThan(
    drive.flipped.forager.x,
    ahead,
    "the forager's x at the tick its heading flipped, against the x of the next " +
      "tile center ahead — a reversal is not taken at a center",
  );

  assertGreaterThanOrEqual(
    drive.flipped.forager.x - drive.returning.forager.x,
    BACK_MIN,
    `logical units travelled back the way it came in the ${BACK_TICKS} ticks ` +
      "after the heading flipped",
  );
});
