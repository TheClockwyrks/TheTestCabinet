// presentation — the one arrangement every lane-item sprite point in this group
// shares: one item of one kind, held still on its own lane, and the draws the
// next frame issued.
//
// Six points read a lane item's art — the plow, the dogsled, the car, the pan
// and the two rafts — and each reads exactly one item on an otherwise empty
// strait. `poseLane` stops the lane before it adds anything (see the harness),
// so the item sits on the column it was given for as long as the check runs and
// the draw's destination box can be held against the span specs/assets.md
// fixes.
//
// Nothing here asserts a verdict. It fails only when the item it was asked to
// pose never reached the roster, and then through the harness's own look-up,
// which names the entity the surface promised.

import { TILE, tileTop } from "../../src/constants";
import {
  floeOf,
  isVehicleKind,
  vehicleOf,
  type FloeKind,
  type Harness,
  type LaneItem,
  type VehicleKind,
  poseLane,
} from "../harness";
import { spritesOfFrame, type Sprite } from "./sprites";

/** One lane item, held still, and the draws the frame after it issued. */
export interface LaneArt {
  /** Every `drawImage` of that frame, each matched against the seeded art. */
  sprites: Sprite[];
  /** The item as the build reports it: its left edge, its row, its length. */
  item: LaneItem & { id: number; kind: string };
  /**
   * Where its art belongs: the centre of the box spanning the tiles it covers.
   *
   * specs/assets.md draws a lane item's frame from the item's own `x`, with its
   * top on its row's top edge and `32` units of width per tile it spans.
   */
  centre: { x: number; y: number };
}

/**
 * Lay one item of `kind` on `row` with its left edge on column `col`, hold the
 * lane still, and read the frame that follows.
 *
 * The caller has already opened a crossing, so the strait is otherwise empty:
 * this item is the only vehicle or floe on it.
 */
export async function laneArt(
  h: Harness,
  row: number,
  kind: VehicleKind | FloeKind,
  col: number,
): Promise<LaneArt> {
  const [id] = poseLane(h, row, kind, [col]);
  const sprites = await spritesOfFrame(h);
  const snapshot = h.snapshot();
  const item = isVehicleKind(kind)
    ? vehicleOf(snapshot, id)
    : floeOf(snapshot, id);
  return {
    sprites,
    item,
    centre: {
      x: item.x + (TILE * item.len) / 2,
      y: tileTop(item.row) + TILE / 2,
    },
  };
}
