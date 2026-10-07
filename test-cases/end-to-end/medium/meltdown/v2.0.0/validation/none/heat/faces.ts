// Meltdown — the walled arrangements this group poses. GROUP-LOCAL.
//
// WHY IT IS HERE AND NOT IN `harness.ts`. Every figure in `specs/heat.md` is a
// rate per EDGE-TILE over a face, so the only way to read one flow on its own is
// to decide, face by face, what lies immediately outside a footprint's four
// sides. `boxIn` seals all four with one tower each; this seals exactly the
// sides a check names and leaves the rest on air, which is what an air check, a
// radiator check and a conduction check each need in a different combination.
// No other group needs that, so it lives beside the checks that do.
//
// WHAT A WALL IS FOR, AND WHY IT CARRIES A HEAT. A wall is scenery: an edge-tile
// facing another tower sheds nothing to air (`specs/heat.md`), so a walled face
// is a face taken out of the air term. A check that wants NO conduction through
// that face poses the wall at the SUBJECT's own heat, because two emitters at
// the same heat exchange nothing — a gradient of zero, not a gate, so the
// reading does not rest on `setTowerThermal` being honoured — and over one
// frame's two-phase resolution the wall's own cooling cannot reach the subject,
// since every term is computed from the heats the frame opened with. A check
// that wants conduction poses the wall at the heat whose difference it is
// measuring.
//
// THE SIZES COME FROM THE SPECIFICATION, never from a snapshot's own `size`: a
// build that reported a 3x3 Arc would otherwise be walled according to its own
// mistake and then graded on the arrangement that mistake produced.
//
// NOTHING HERE IS A TOLERANCE and nothing here is a threshold. This file says
// only where a footprint stands; what a reading must come to is stated in the
// check that takes it.

import type { Side, Tile, TowerType } from "../constants";
import { poseIdleTower, type Harness } from "../harness";
import { sizeOf } from "../thermal";

/** A footprint as a check posed it: what it is, and its top-left tile. */
export interface Footprint {
  type: TowerType;
  col: number;
  row: number;
}

/**
 * The top-left tile a `wall` footprint takes to sit flush against `side` of
 * `target`, covering that whole face.
 */
export function faceAnchor(
  target: Footprint,
  side: Side,
  wall: TowerType,
): Tile {
  const size = sizeOf(target.type);
  const reach = sizeOf(wall);
  if (side === "N") return { col: target.col, row: target.row - reach };
  if (side === "S") return { col: target.col, row: target.row + size };
  if (side === "E") return { col: target.col + size, row: target.row };
  return { col: target.col - reach, row: target.row };
}

/**
 * Pose one idle tower flush against each of `sides`, every one at `heat`, and
 * hand back their ids in the order the sides were given.
 *
 * `wall`'s footprint must be the same size as the target's, so each wall covers
 * its whole face and any two of them meet at a corner alone — the same rule
 * `boxIn` states, which this generalises to a subset of the four faces.
 */
export async function wallFaces(
  h: Harness,
  target: Footprint,
  sides: readonly Side[],
  options: { wall: TowerType; heat: number },
): Promise<number[]> {
  const ids: number[] = [];
  for (const side of sides) {
    const at = faceAnchor(target, side, options.wall);
    ids.push(
      await poseIdleTower(h, options.wall, at.col, at.row, {
        heat: options.heat,
      }),
    );
  }
  return ids;
}
