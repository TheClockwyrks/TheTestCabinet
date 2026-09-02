// Meltdown — a mover with the whole surge standing round it. GROUP-LOCAL.
//
// Two items in this group say the same thing about the two movers:
// specs/towers.md has both of them "never fire", and a tower that never fires
// reports `firing` false, holds no `targeting`, and tallies no kill and no damage
// for its whole life on the floor (specs/combat.md, what an emitter keeps). The
// arrangement that decides it is the same for both, so it is written once here.
//
// WHAT THE ARRANGEMENT HAS TO DO. A mover carries no range at all, so there is no
// distance at which it "would" fire and none at which it plainly would not; the
// only honest reading is to stand the WHOLE ROSTER of surge types close enough
// that every emitter on the roster would have opened fire, and watch the mover do
// nothing. specs/surge.md gives six types, one of which flies and one of which is
// immune to slowing, so posing all six leaves a build no type to have made an
// exception for.
//
// THE MARKS CANNOT WANDER AND CANNOT DIE. `poseTarget` takes each one's motion
// off, so it holds its tile for the whole watch, and gives it hp far past anything
// a shot on the roster removes, so a build that DOES fire leaves a reading rather
// than an empty roster.
//
// THE HP IS THE READING THAT MATTERS. `firing` false is what a build reports; the
// hp the marks still carry is what a build DID. The second catches a build that
// reports the flag correctly and resolves shots underneath it.
//
// NOTHING HERE IS A TOLERANCE. It hands back what the tower reported and what the
// surge lost; what those must come to is stated in the check that took them.

import { SURGE_TYPES } from "../constants";
import {
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  type Harness,
  type Tile,
  type TowerSnapshot,
  type TowerType,
} from "../harness";
import { MOVER_SITE, towerOf, unitOf } from "./bench";

/** Hp far past anything one shot on the roster removes, so nothing dies unasked. */
const MARK_HP = 10_000;

/**
 * Where each of the six marks stands, as an offset from the mover's anchor in
 * tiles.
 *
 * Geometry, not a tolerance. Every offset clears the mover's own 2x2 footprint
 * and puts the mark within four tiles of it — inside the shortest range on the
 * emitter roster (the Stutter's `5.0`) several times over, so a build that gave
 * its movers any range at all would find every one of them in it. They are spread
 * around the mover rather than stacked, so a build that fires on one type alone
 * still shows it.
 */
const MARK_OFFSETS: readonly Tile[] = [
  { col: 4, row: 0 },
  { col: -4, row: 0 },
  { col: 0, row: 4 },
  { col: 0, row: -4 },
  { col: 4, row: 4 },
  { col: -4, row: -4 },
];

/** What a watch found: the mover as it reported itself, and what the surge lost. */
export interface InertWatch {
  tower: TowerSnapshot;
  /** Hp removed from the six marks over the watch, summed. */
  hpRemoved: number;
}

/**
 * Pose one mover of `type` with one stationary unit of every surge type standing
 * round it, run for `watchSeconds` of game time, and read both.
 *
 * `startRun` empties both rosters and shuts the world gate, so the floor holds the
 * mover and the six marks and nothing else.
 */
export async function watchAmongTheSurge(
  h: Harness,
  type: TowerType,
  watchSeconds: number,
): Promise<InertWatch> {
  startRun(h);
  const id = poseTower(h, type, MOVER_SITE.col, MOVER_SITE.row);
  const marks = SURGE_TYPES.map((surge, i) =>
    poseTarget(
      h,
      surge,
      MOVER_SITE.col + MARK_OFFSETS[i].col,
      MOVER_SITE.row + MARK_OFFSETS[i].row,
      MARK_HP,
    ),
  );
  const opened = marks.map((mark) => unitOf(h.snapshot(), mark).hp);

  await h.advance(ticksFor(watchSeconds));

  const closed = h.snapshot();
  return {
    tower: towerOf(closed, id),
    hpRemoved: marks.reduce(
      (lost, mark, i) => lost + (opened[i] - unitOf(closed, mark).hp),
      0,
    ),
  };
}
