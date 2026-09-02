// Meltdown — one emitter, the movers against it, and the flow they drive.
// GROUP-LOCAL.
//
// Every item in this group asks what a Forge or a Sink does to the heat of an
// emitter it touches, and specs/heat.md resolves a frame as a SUM:
//
//   dH_T = (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / mass
//
// so the heat change a snapshot reports is never the mover's term on its own. Two
// of the other terms are in the way, and both of them move when a mover is posed:
//
//   - THE AIR TERM. "An edge-tile facing another tower sheds nothing to air", so
//     the face a mover stands against is a face taken OUT of the air term. A
//     reading that compared a floor with a mover against a floor without one would
//     be reading the air the mover blocked as well as the flow it drove.
//   - THE CONDUCTION TERM. Anything else posed beside the subject to hold that face
//     conducts with it unless it is at the subject's own heat, where the gradient
//     is zero and specs/heat.md has the two exchange nothing.
//
// SO THE FLOW IS READ AS A DIFFERENCE. {@link moverFlow} poses the same floor
// twice — once with the movers, once with an inert 2x2 wall standing at each
// mover's own anchor, at the subject's own heat — and hands back the difference of
// the two one-frame heat changes. The two floors have the same footprints on the
// same tiles, so they have identical air terms and no conduction at all, and what
// survives the subtraction is `forgeGain` or `sinkLoss` and nothing else. A build
// whose air cooling or whose conduction is wrong is graded on that by `heat/*`;
// this group grades the mover.
//
// ONE FRAME, ALWAYS. Both the Forge's flow and the Sink's depend on the subject's
// CURRENT heat, so over two frames the second is taken at a heat the first moved
// and the reading becomes an integral rather than the rate specs/heat.md states.
//
// THE MEASURED LEG RUNS LAST, so the picture left on the canvas when a check calls
// `captureStill` is the arrangement the item is about rather than its control.
//
// NOTHING HERE IS A TOLERANCE AND NOTHING HERE IS A THRESHOLD. This file says
// where a footprint stands and hands back a rate in heat-points per second; what
// that rate must come to is stated in the check that took it, derived from the
// figure specs/ fixes for it.

import { TOWER_DEFS, type EmitterDef } from "../constants";
import { fail } from "../assert";
import { isEmitter, sizeOf, type Tile } from "../geometry";
import {
  poseIdleTower,
  poseTower,
  seconds,
  startRun,
  towerOf,
  type Face,
  type Harness,
  type TowerType,
} from "../harness";

/**
 * Where the subject stands: a quiet anchor with room for a 2x2 neighbour flush
 * against every face of a footprint up to the Lance's 4x4, and another one beyond
 * that on the south side.
 *
 * Geometry, not a tolerance. A 4x4 subject here covers columns `8..11` and rows
 * `26..29`; its neighbours reach columns `6..13` and rows `24..31`, and a second
 * rank standing beyond one of those reaches row `33` to the south and row `22` to
 * the north. All of it is clear of the left vent's corridor (rows `16..19`) and the
 * top vent's (columns `22..29`), so nothing this group poses lengthens a route, and
 * all of it is on the grid (specs/floor.md gives 50 columns and 36 rows).
 */
export const MOVER_SITE: Tile = { col: 8, row: 26 };

/**
 * What stands in a mover's place in the control leg: a 2x2 emitter.
 *
 * It has to be 2x2, because both movers are (specs/towers.md), so the control
 * floor blocks exactly the tiles the measured floor blocks and classifies exactly
 * the same edge-tiles. It is posed at the subject's own heat, so it conducts
 * nothing.
 */
export const WALL: TowerType = "arc";

/** The frame every reading here is taken over, in seconds of game time. */
export const DT = seconds(1);

/** The emitter specs/towers.md tabulates under `type`. A mover is not one. */
function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** The thermal mass specs/towers.md gives an emitter. A mover has none. */
export function massOf(type: TowerType): number {
  return emitterDefOf(type).mass;
}

/** The redline specs/towers.md gives an emitter. An upgrade never moves it. */
export function redlineOf(type: TowerType): number {
  return emitterDefOf(type).redline;
}

/** The emitter a reading is taken on, and the heat it is posed at. */
export interface Subject {
  type: TowerType;
  heat: number;
}

/**
 * One tower posed beside the subject: what it is, and its footprint's top-left
 * tile.
 *
 * `level` moves a mover's own output alone (specs/towers.md). `heat` is for the
 * rare neighbour a check wants a GRADIENT against; leave it out and an emitter
 * neighbour carries the subject's own heat, which is the arrangement that
 * conducts nothing.
 */
export interface Neighbour {
  type: TowerType;
  col: number;
  row: number;
  level?: number;
  heat?: number;
}

/**
 * The top-left tile a 2x2 neighbour takes to sit flush against `face` of a
 * `subject` anchored at {@link MOVER_SITE}.
 *
 * A 2x2 covers two edge-tiles of the face it stands against, whatever the size
 * of the footprint it stands against, so `sharedEdges` is `2` at every subject
 * size on the roster (specs/heat.md, Faces, edge-tiles, and neighbours). The
 * size comes from `constants.ts`'s table rather than from a snapshot's own
 * `size`, so a build that reported the wrong footprint is not walled according
 * to its own mistake.
 */
export function faceAnchor(subject: TowerType, face: Face): Tile {
  const size = sizeOf(subject);
  const { col, row } = MOVER_SITE;
  if (face === "N") return { col, row: row - 2 };
  if (face === "S") return { col, row: row + size };
  if (face === "W") return { col: col - 2, row };
  return { col: col + size, row };
}

/**
 * Pose one subject at {@link MOVER_SITE} with `neighbours` around it, run exactly
 * one frame, and hand back the subject's heat change over it in heat-points per
 * SECOND.
 *
 * The subject is idle (`poseIdleTower`), so its guns add no `shotGain` and what
 * moves its heat is air, conduction and the movers alone. A mover is posed with
 * `poseTower` and never with `setTowerHeat`: a mover carries no heat at all
 * (specs/heat.md), so there is no heat on one to pose.
 */
export async function heatRate(
  h: Harness,
  subject: Subject,
  neighbours: readonly Neighbour[],
): Promise<number> {
  startRun(h);
  const id = poseIdleTower(
    h,
    subject.type,
    MOVER_SITE.col,
    MOVER_SITE.row,
    0,
    subject.heat,
  );
  for (const near of neighbours) {
    if (isEmitter(near.type)) {
      poseIdleTower(
        h,
        near.type,
        near.col,
        near.row,
        0,
        near.heat ?? subject.heat,
      );
    } else {
      const mover = poseTower(h, near.type, near.col, near.row);
      if (near.level !== undefined && near.level !== 1) {
        h.debug.setTowerLevel(mover, near.level);
      }
    }
  }
  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  return (towerOf(h.snapshot(), id).heat - opened) / DT;
}

/**
 * The flow the MOVERS among `neighbours` drive into the subject, in heat-points
 * per second, with every other term of the frame subtracted away.
 *
 * The control floor is the same floor with a {@link WALL} at each mover's anchor;
 * every emitter already in `neighbours` stands in both legs exactly as it was
 * given. See the note at the head of this file for why the difference is the
 * mover's term and nothing else.
 */
export async function moverFlow(
  h: Harness,
  subject: Subject,
  neighbours: readonly Neighbour[],
): Promise<number> {
  const control = neighbours.map((near) =>
    isEmitter(near.type)
      ? near
      : { type: WALL, col: near.col, row: near.row, heat: near.heat },
  );
  const walled = await heatRate(h, subject, control);
  const measured = await heatRate(h, subject, neighbours);
  return measured - walled;
}
