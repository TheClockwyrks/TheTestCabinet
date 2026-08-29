// maze-movement/wrap-tunnel — the two mouths of the pierced row are one step
// apart, and the forager swims across rather than being teleported.
//
// `specs/maze.md` fixes the crossing in three sentences: "The two mouths,
// `(0, row)` and `(35, row)`, are neighbors of each other. A character travelling
// left off the left mouth arrives on the right mouth, and one travelling right off
// the right mouth arrives on the left mouth, on the same row." — "The crossing is
// one ordinary step. Travelling from one mouth's center to the other's covers
// `TILE` (`32`) units, the same ground as any step between neighbors, at the speed
// the character was already making. Nothing stops at the border." — "Position is
// carried across rather than snapped … a character's center stays inside the maze
// region, `x` within `[64, 1216]`."
//
// THIS IS ONE OF THE FEW POINTS THAT READS THE BUILD'S OWN BOARD. Every other
// scenario in this suite poses the geometry it is about, but a posed fixture would
// prove only that the build honors a tunnel it was handed; the claim here is about
// the tunnel the build cut for itself, so the row is found in the layout rather
// than stamped into it.
//
// AND IT STARTS INSIDE THE CORRIDOR, NOT ON THE MOUTH TILE. What the point names
// is "traveling off one mouth" — a crossing that continues travel already under
// way. Posed AT the border tile at rest, the wrap would have to engage from a
// standing start on the seam itself, which is the turning rule's question rather
// than the tunnel's: a build that carries a MOVING forager across perfectly could
// sit on the mouth tile forever and fail this point for a reason it is not about.
//
// HOW THE `TILE` OF GROUND IS MEASURED, AND WHY NOT AS A DISTANCE. Folding the
// wrap out of the position stream makes the ground between the two mouth centers
// come to `32` units almost however the build implements the seam, because the
// fold itself supplies whatever the build dropped — a build that snaps the forager
// onto the far mouth's center still reads as `32`. What such a build actually
// loses is TIME: it reaches the far center in half the ticks. So the crossing is
// measured as the ticks between the two mouth centers, taken at the pace the same
// build was making on the way in. A build that stalls at the seam reads long; one
// that skips reads short; one that swims across reads `32`.

import { afterEach, beforeEach } from "vitest";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import { ARROW_KEY } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import { isCorridor, wrapRows } from "../maze";
import {
  check,
  denAll,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
  unmetPrecondition,
} from "../scene";

/**
 * How far inside the left mouth the forager starts, in tiles.
 *
 * One tile is enough to be under way at the seam; two is preferred so the clip
 * opens on a moment of ordinary swimming. More than that only lengthens the clip,
 * and `specs/maze.md` leaves the corridor route between the mouths to the build,
 * so a long straight approach is not something a conforming maze owes this check.
 */
const MAX_APPROACH = 2;

/** The heading that carries the forager off the left mouth. */
const OUT = "left" as const;

/**
 * How far the crossing may sit from `TILE`, in logical units.
 *
 * The point's own bound: two units. One tick of travel at `FORAGER_SPEED` is
 * `1.07` units, so this is a tick and a bit of slack around a `32`-unit step —
 * room for where a build hands over inside a tick, not for a seam that stalls or
 * skips.
 */
const CROSSING_TOLERANCE = 2;

/**
 * How far outside the maze region the forager's center may stray, in logical
 * units.
 *
 * `specs/maze.md` states the bound outright, so this is slack for the binary
 * representation of a float and nothing else.
 */
const EDGE_EPSILON = 0.01;

/** Ticks the key stays down past the crossing, purely for the clip. */
const TAIL_TICKS = 60;

/** One tick's travel at `FORAGER_SPEED`, in ticks per tile: 30 at 128 units/s. */
const TICKS_PER_TILE = 30;

/**
 * How many ticks of ordinary swimming the crossing's pace is compared against.
 *
 * "At the speed the character was already making" (`specs/maze.md`) is about the
 * moment before the seam, so the pace is taken from the last tenth of a second of
 * corridor travel rather than from the whole approach: a build whose speed varies
 * along the run is `maze-movement/constant-speed`'s to fail, and reading the pace
 * right up against the mouth keeps that fault out of this verdict.
 */
const PACE_TICKS = 10;

/** What one tick of the drive left behind. */
interface Step {
  x: number;
  tx: number;
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

check(
  "carries the forager across the wrap tunnel in one ordinary step",
  async () => {
    const opening = await startPlaying(h);
    const grid = opening.grid;
    const pierced = wrapRows(opening);
    assertEqual(
      pierced.length > 0,
      true,
      "the layout pierces a row at both borders, which is the wrap tunnel " +
        "specs/maze.md requires every maze to carry",
    );
    if (pierced.length === 0) return;
    // The first pierced row, which is the one specs/instrumentation.md names as the
    // wrap tunnel of a layout. Whether a board pierces exactly ONE row is a
    // structural claim about the layout rather than about the crossing.
    const row = pierced[0];

    // The corridor running inland from the left mouth, as far as this build offers.
    let approach = 0;
    while (approach < MAX_APPROACH && isCorridor(opening, approach + 1, row)) {
      approach += 1;
    }
    if (approach === 0) {
      // Nothing can swim into a mouth with no open tile beside it, so the scenario
      // the point describes cannot be staged. A conforming maze always offers one:
      // the mouth's north and south neighbors are border rock, and the no-dead-ends
      // rule needs a second connection besides the far mouth, which leaves the tile
      // inland as the only candidate. `maze/no-dead-ends` is the point that says so.
      unmetPrecondition(
        `the left wrap mouth on row ${row} has no open corridor tile beside it to ` +
          "swim in from, so it is a dead end and cannot be entered the way this " +
          "point describes — see maze/no-dead-ends",
      );
    }

    const quiet = await denAll(h);
    await h.debug.setForagerTile(approach, row);
    await h.debug.setForagerDir(OUT);
    // The forager is the SUBJECT, so it is not held to staying put; the guard still
    // catches a life lost, a predator loose, or the dive leaving live play.
    const guard = await sceneGuard(h, quiet, { foragerParked: false });

    const span = grid.cols * grid.tile;
    const frameLeft = grid.originX;
    const frameRight = frameLeft + span;
    const leftMouth = frameLeft + grid.tile / 2;
    const rightMouth = frameLeft + (grid.cols - 1) * grid.tile + grid.tile / 2;
    /** Three times the ticks a conforming crossing takes, as a hard bound. */
    const budget = (approach + 2) * TICKS_PER_TILE * 3;

    const drive = await captureReplay(h, "wrap", async () => {
      const first = await h.snapshot();
      const steps: Step[] = [
        { x: first.forager.x, tx: first.forager.tx, ty: first.forager.ty },
      ];
      await h.hold(ARROW_KEY[OUT]);
      let wrapped = -1;
      let arrived = -1;
      for (let tick = 0; tick < budget && arrived < 0; tick += 1) {
        await h.advance(1);
        const f = (await h.snapshot()).forager;
        steps.push({ x: f.x, tx: f.tx, ty: f.ty });
        const at = steps.length - 1;
        if (wrapped < 0 && steps[at].x - steps[at - 1].x > span / 2)
          wrapped = at;
        if (wrapped >= 0 && steps[at].x <= rightMouth) arrived = at;
      }
      const last = await h.snapshot();
      // Held on past the crossing, so the clip shows the forager swimming on out of
      // the far mouth rather than stopping where the verdict was taken.
      await h.advance(TAIL_TICKS);
      await h.release(ARROW_KEY[OUT]);
      return { first, steps, wrapped, arrived, last };
    });

    requireSceneHeld(await h.snapshot(), guard);

    // A forager that never got under way never reached the seam; whether a held
    // action moves it at all is `controls/move-*`'s verdict.
    requireSwim(
      drive.first.forager,
      drive.last.forager,
      "swim off the left mouth of the wrap tunnel",
    );

    // Every folded step of the drive: the wrap taken out, so the crossing tick
    // reads as a step rather than as a leap the width of the maze.
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
      "the least x the forager's center reached over the crossing, against the " +
        `maze region [${frameLeft}, ${frameRight}]`,
    );
    assertBetween(
      Math.max(...drive.steps.map((step) => step.x)),
      frameLeft - EDGE_EPSILON,
      frameRight + EDGE_EPSILON,
      "the greatest x the forager's center reached over the crossing, against " +
        `the maze region [${frameLeft}, ${frameRight}]`,
    );

    assertEqual(
      drive.wrapped >= 0,
      true,
      `swimming ${OUT} off the mouth at (0, ${row}) carried the forager to the ` +
        `far border within ${budget} ticks`,
    );
    if (drive.wrapped < 0) return;

    // THE ARRIVAL IS READ AS A ROW AND A POSITION, NOT AS A TILE INDEX. `tx` is
    // "the tile whose bounds contain its center" (specs/state.md), and a center
    // that lands exactly on the far border sits on the boundary of the last tile's
    // bounds, where builds legitimately differ. The row is unambiguous, and so is
    // whether the center came out inside the far mouth tile's own span.
    assertEqual(
      drive.steps[drive.wrapped].ty,
      row,
      "the row the forager came out on, which specs/maze.md fixes as the row it " +
        "went in on",
    );
    assertBetween(
      drive.steps[drive.wrapped].x,
      frameRight - grid.tile - EDGE_EPSILON,
      frameRight + EDGE_EPSILON,
      "the x the forager came out at, against the span of the far mouth tile " +
        `(${grid.cols - 1}, ${row})`,
    );

    assertEqual(
      drive.arrived >= 0,
      true,
      `the forager reached the far mouth's center within ${budget} ticks of ` +
        "leaving the near one",
    );
    if (drive.arrived < 0) return;

    // The tick each mouth's center was passed at, read off the raw positions so
    // nothing about how the seam was implemented is assumed.
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
      `the forager passed the near mouth's center (x ${leftMouth}) on its way out`,
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
    const swimming = folded
      .slice(0, Math.max(1, Math.floor(leaving)))
      .filter((step) => step > 0);
    const inbound = swimming.slice(-PACE_TICKS);
    const pace =
      inbound.length > 0
        ? inbound.reduce((total, step) => total + step, 0) / inbound.length
        : 0;
    assertLessThanOrEqual(
      Math.abs((landing - leaving) * pace - grid.tile),
      CROSSING_TOLERANCE,
      `|ground covered from one mouth's center to the other - TILE| in logical ` +
        `units, taken as the ${(landing - leaving).toFixed(2)} ticks between them ` +
        `at the ${pace.toFixed(3)} units a tick this build was making swimming in`,
    );

    assertLessThanOrEqual(
      Math.max(...folded),
      pace + grid.tile / 2,
      "the largest single tick of travel over the whole drive, against the pace " +
        "swimming in — the forager swims through the seam rather than skipping " +
        "across it",
    );
  },
);
