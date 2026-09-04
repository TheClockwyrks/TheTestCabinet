// Meltdown — the walled arrangements this group poses. GROUP-LOCAL.
//
// WHY IT IS HERE AND NOT IN `harness.ts`. Every figure in specs/heat.md is a rate
// per EDGE-TILE over a face, so the only way to read one flow on its own is to
// decide, face by face, what lies immediately outside a footprint's four sides.
// `harness.ts`'s `boxIn` seals all four with one tower each; this seals exactly
// the sides a check names and leaves the rest on air, which is what an air check,
// a radiator check and a conduction check each need in a different combination.
// No other group needs that, so it lives beside the checks that do.
//
// WHAT A WALL IS FOR, AND WHY IT CARRIES A HEAT. A wall is scenery: an edge-tile
// facing another tower sheds nothing to air (specs/heat.md), so a walled face is
// a face taken out of the air term. A check that wants NO conduction through that
// face poses the wall at the SUBJECT's own heat, because two emitters at the same
// heat exchange nothing — a gradient of zero, not a gate, so the reading does not
// rest on `setTowerThermal` being honoured — and over one frame's two-phase
// resolution the wall's own cooling cannot reach the subject, since every term is
// computed from the heats the frame opened with. A check that wants conduction
// poses the wall at the heat whose difference it is measuring.
//
// THE SIZES COME FROM THE SPECIFICATION, never from a snapshot's own `size`: a
// build that reported a 3x3 Arc would otherwise be walled according to its own
// mistake and then graded on the arrangement that mistake produced. `sizeOf` is
// `geometry.ts`'s, over `constants.ts`'s table.
//
// NOTHING HERE IS A TOLERANCE and nothing here is a threshold. This file says
// only where a footprint stands; what a reading must come to is stated in the
// check that takes it.

import { sizeOf, type Tile } from "../geometry";
import {
  poseIdleTower,
  type Face,
  type Harness,
  type TowerType,
} from "../harness";

/** A footprint as a check posed it: what it is, and its top-left tile. */
export interface Footprint {
  type: TowerType;
  col: number;
  row: number;
}

/** The four faces, so a check can name every side or all but one. */
export const SIDES: readonly Face[] = ["N", "E", "S", "W"];

/**
 * The top-left tile a `wall` footprint takes to sit flush against `face` of
 * `target`, covering that whole face.
 */
export function faceAnchor(
  target: Footprint,
  face: Face,
  wall: TowerType,
): Tile {
  const size = sizeOf(target.type);
  const reach = sizeOf(wall);
  if (face === "N") return { col: target.col, row: target.row - reach };
  if (face === "S") return { col: target.col, row: target.row + size };
  if (face === "E") return { col: target.col + size, row: target.row };
  return { col: target.col - reach, row: target.row };
}

/**
 * Pose one idle tower flush against each of `faces`, every one at `heat`, and
 * hand back their ids in the order the faces were given.
 *
 * `wall`'s footprint must be the same size as the target's, so each wall covers
 * its whole face and any two of them meet at a corner alone — the same rule
 * `harness.ts`'s `boxIn` states, which this generalises to a subset of the four
 * faces.
 */
export function wallFaces(
  h: Harness,
  target: Footprint,
  faces: readonly Face[],
  options: { wall: TowerType; heat: number },
): number[] {
  return faces.map((face) => {
    const at = faceAnchor(target, face, options.wall);
    return poseIdleTower(h, options.wall, at.col, at.row, 0, options.heat);
  });
}
