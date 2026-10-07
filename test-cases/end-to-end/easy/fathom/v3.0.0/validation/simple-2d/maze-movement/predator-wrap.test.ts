// maze-movement/predator-wrap — a hunter crosses the tunnel on the same terms.
//
// specs/maze.md gives the tunnel to every body rather than to the forager alone:
// "The two mouths, `(0, row)` and `(35, row)`, are neighbors of each other. A
// character travelling left off the left mouth arrives on the right mouth ... The
// crossing is one ordinary step. Travelling from one mouth's center to the
// other's covers `TILE` (`32`) units, the same ground as any step between
// neighbors, at the speed the character was already making." And "a character's
// center stays inside the maze region, `x` within `[64, 1216]`".
//
// THIS READS THE BUILD'S OWN BOARD, as `maze-movement.wrap-tunnel` does: the
// claim is about the tunnel the build cut for itself, so the pierced row is found
// in the layout rather than stamped into it.
//
// HOW THE HUNTER IS SENT THROUGH THE SEAM. Not by wandering, which picks at
// random among the open directions at every junction (specs/predators.md) and
// would leave the crossing to chance; and not with its mind switched off, which
// leaves it deciding nothing and therefore carrying nothing out
// (specs/instrumentation.md), so it would never travel at all. It is sent by the
// build's OWN routing: the forager is stood on the far side of the tunnel and the
// hunter posed into `"chase"`, which fixes on the forager's tile, and
// specs/predators.md then has it take "the first step of a shortest corridor
// route" there. Across the seam that route is three steps; the long way round the
// row is thirty-odd. So a build whose tunnel joins the two mouths sends its
// hunter through it, and one whose tunnel does not is measured going the long way
// and fails.
//
// IT STARTS INSIDE THE CORRIDOR, NOT ON THE MOUTH TILE, for the same reason the
// forager's crossing does: what the rule names is travel already under way
// arriving at the seam, and a body posed at rest ON the border would be asked a
// question about turning rather than about the tunnel.
//
// HOW THE `TILE` OF GROUND IS MEASURED, AND WHY NOT AS A DISTANCE. Folding the
// wrap out of the position stream makes the ground between the two mouth centers
// come to `32` units almost however the build implements the seam — a build that
// snaps the hunter onto the far mouth still reads as `32`. What such a build
// loses is TIME. So the crossing is measured as the ticks between the two mouth
// centers, taken at the pace the same build was making on the way in.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { PREDATOR_SPEED, TICK_HZ } from "../constants";
import { clearWorld } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { isCorridor, wrapRows } from "../maze";

/** The hunter this point sends through the seam, and its roster index. */
const KIND = "lanternjaw";
const HUNTER = 0;

/**
 * How far inside the left mouth the hunter starts, in tiles.
 *
 * One tile, which is the tile specs/maze.md's no-dead-ends rule guarantees is
 * open beside a mouth: enough to be under way at the seam, and no further than a
 * conforming maze owes this check.
 */
const APPROACH = 1;

/**
 * How far the crossing may sit from `TILE`, in logical units.
 *
 * The point's own bound: two units. One tick of travel at `PREDATOR_SPEED`
 * (`116`) is under a unit, so this is a tick and a bit of slack around a
 * `32`-unit step — room for where a build hands over inside a tick, not for a
 * seam that stalls or skips.
 */
const CROSSING_TOLERANCE = 2;

/**
 * How far outside the maze region a center may stray, in logical units.
 *
 * specs/maze.md states the bound outright, so this is slack for the binary
 * representation of a float and nothing else.
 */
const EDGE_EPSILON = 0.01;

/**
 * How many ticks of ordinary travel the crossing's pace is compared against.
 *
 * "At the speed the character was already making" is about the moment before the
 * seam, so the pace is taken from the last tenth of a second of corridor travel
 * rather than from the whole approach.
 */
const PACE_TICKS = 10;

/** One tick of the drive, as this check reads it. */
interface Step {
  x: number;
  ty: number;
}

/**
 * The tick, as a fraction, at which `x` fell to `target` between two samples.
 *
 * Linear between two consecutive ticks, which is exact for travel at a constant
 * speed and is the only thing a reading at tick granularity can say about a
 * moment between two of them.
 */
function crossingTick(
  from: Step,
  to: Step,
  index: number,
  target: number,
): number {
  const drop = from.x - to.x;
  if (drop <= 0) return index;
  return index - 1 + (from.x - target) / drop;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a hunter across the wrap tunnel in one ordinary step", async () => {
  const opening = await startPlaying(h);
  const grid = opening.grid;
  const pierced = wrapRows(opening);
  assertGreaterThan(
    pierced.length,
    0,
    "the layout pierces a row at both borders, which is the wrap tunnel " +
      "specs/maze.md requires every maze to carry",
  );
  if (pierced.length === 0) return;
  const row = pierced[0];

  assertEqual(
    isCorridor(opening, APPROACH, row),
    true,
    `the tile inland of the left mouth on row ${row} is open corridor; ` +
      "specs/maze.md leaves no dead end, so a mouth has one",
  );

  // The far side of the seam: where the hunter is routed to, one step past the
  // far mouth so the crossing is finished before anything can meet it there.
  const beyond = grid.cols - 2;
  assertEqual(
    isCorridor(opening, beyond, row),
    true,
    `the tile inland of the right mouth on row ${row} is open corridor; ` +
      "specs/maze.md leaves no dead end, so a mouth has one",
  );

  // The board is emptied of everything but the forager, so the crossing is the
  // only thing happening on it. The LAYOUT is the build's own, because where the
  // pierced row runs is what this point reads.
  await clearWorld(h);
  h.debug.setForagerTile(beyond, row);
  h.debug.addPredator(KIND, APPROACH, row);
  h.debug.setPredatorReleased(HUNTER, true);
  h.debug.setPredatorState(HUNTER, "chase");

  const span = grid.cols * grid.tile;
  const frameLeft = grid.originX;
  const frameRight = frameLeft + span;
  const leftMouth = frameLeft + grid.tile / 2;
  const rightMouth = frameLeft + (grid.cols - 1) * grid.tile + grid.tile / 2;
  /**
   * Three times the ticks a conforming crossing takes, as a hard bound: two
   * tiles of travel at `PREDATOR_SPEED`, trebled.
   */
  const budget = Math.ceil((3 * 2 * grid.tile * TICK_HZ) / PREDATOR_SPEED);

  const drive = await captureReplay(h, "wrap", async () => {
    const first = h.snapshot();
    const steps: Step[] = [
      { x: first.predators[HUNTER].x, ty: first.predators[HUNTER].ty },
    ];
    let wrapped = -1;
    let arrived = -1;
    for (let tick = 0; tick < budget && arrived < 0; tick += 1) {
      await h.advance(1);
      const hunter = h.snapshot().predators[HUNTER];
      if (hunter === undefined) break;
      steps.push({ x: hunter.x, ty: hunter.ty });
      const at = steps.length - 1;
      if (wrapped < 0 && steps[at].x - steps[at - 1].x > span / 2) wrapped = at;
      if (wrapped >= 0 && steps[at].x <= rightMouth) arrived = at;
    }
    return { steps, wrapped, arrived };
  });

  // The wrap taken out of the stream, so a step across the seam reads as a step
  // rather than as a leap the width of the maze.
  const folded: number[] = [];
  for (let at = 1; at < drive.steps.length; at += 1) {
    let step = drive.steps[at - 1].x - drive.steps[at].x;
    if (step < -span / 2) step += span;
    else if (step > span / 2) step -= span;
    folded.push(step);
  }

  assertBetween(
    Math.min(...drive.steps.map((step) => step.x)),
    frameLeft - EDGE_EPSILON,
    frameRight + EDGE_EPSILON,
    "the least x the hunter's center reached over the crossing, against the " +
      `maze region [${String(frameLeft)}, ${String(frameRight)}]`,
  );
  assertBetween(
    Math.max(...drive.steps.map((step) => step.x)),
    frameLeft - EDGE_EPSILON,
    frameRight + EDGE_EPSILON,
    "the greatest x the hunter's center reached over the crossing, against " +
      `the maze region [${String(frameLeft)}, ${String(frameRight)}]`,
  );

  assertEqual(
    drive.wrapped >= 0,
    true,
    `travelling off the mouth at (0, ${String(row)}) carried the hunter to ` +
      `the far border within ${String(budget)} ticks`,
  );
  if (drive.wrapped < 0) return;

  assertEqual(
    drive.steps[drive.wrapped].ty,
    row,
    "the row the hunter came out on, which specs/maze.md fixes as the row it " +
      "went in on",
  );
  assertBetween(
    drive.steps[drive.wrapped].x,
    frameRight - grid.tile - EDGE_EPSILON,
    frameRight + EDGE_EPSILON,
    "the x the hunter came out at, against the span of the far mouth tile " +
      `(${String(grid.cols - 1)}, ${String(row)})`,
  );

  assertEqual(
    drive.arrived >= 0,
    true,
    `the hunter reached the far mouth's center within ${String(budget)} ticks ` +
      "of leaving the near one",
  );
  if (drive.arrived < 0) return;

  let leaving = -1;
  for (let at = 1; at <= drive.wrapped; at += 1) {
    if (drive.steps[at].x <= leftMouth) {
      leaving = crossingTick(
        drive.steps[at - 1],
        drive.steps[at],
        at,
        leftMouth,
      );
      break;
    }
  }
  assertEqual(
    leaving >= 0,
    true,
    `the hunter passed the near mouth's center (x ${String(leftMouth)}) on ` +
      "its way out",
  );
  if (leaving < 0) return;
  const landing =
    drive.arrived === drive.wrapped
      ? drive.wrapped
      : crossingTick(
          drive.steps[drive.arrived - 1],
          drive.steps[drive.arrived],
          drive.arrived,
          rightMouth,
        );

  // The pace this same build was making on the way in, so "at the speed the
  // character was already making" is asked of the build rather than of a figure.
  const inbound = folded
    .slice(0, Math.max(1, Math.floor(leaving)))
    .filter((step) => step > 0)
    .slice(-PACE_TICKS);
  const pace =
    inbound.length > 0
      ? inbound.reduce((total, step) => total + step, 0) / inbound.length
      : 0;
  assertGreaterThan(
    pace,
    0,
    "the hunter was travelling before it reached the seam, so the pace the " +
      "crossing is measured at is a reading of something",
  );
  assertLessThanOrEqual(
    Math.abs((landing - leaving) * pace - grid.tile),
    CROSSING_TOLERANCE,
    "|ground covered from one mouth's center to the other - TILE| in logical " +
      `units, taken as the ${(landing - leaving).toFixed(2)} ticks between ` +
      `them at the ${pace.toFixed(3)} units a tick this build was making ` +
      "travelling in",
  );
  assertLessThanOrEqual(
    Math.max(...folded),
    pace + grid.tile / 2,
    "the largest single tick of travel over the whole drive, against the pace " +
      "travelling in — the hunter travels through the seam rather than " +
      "skipping across it",
  );
});
