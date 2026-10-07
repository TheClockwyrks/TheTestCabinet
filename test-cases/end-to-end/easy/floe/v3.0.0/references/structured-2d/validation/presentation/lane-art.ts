// presentation — the one arrangement every lane-item sprite point in this group
// shares: one item of one kind, held still on its own lane, and the draws the
// next frame issued. PRIVATE to `presentation/`.
//
// Six points read a lane item's art — the plow, the dogsled, the car, the pan and
// the two rafts — and each reads exactly one item on an otherwise empty strait.
// The harness's `poseLane` stops the lane before it adds anything, so the item
// sits on the column it was given for as long as the check runs and the draw's
// destination box can be held against the span specs/assets.md fixes.
//
// Nothing here asserts a verdict, except where the reading cannot be taken at
// all: an item the surface said it had added and that is not on the roster is
// named here rather than surfacing as a `TypeError` inside the check.

import { fail } from "../assert";
import {
  floeById,
  poseLane,
  vehicleById,
  type FloeItemSnapshot,
  type Harness,
  type ItemKind,
  type VehicleSnapshot,
} from "../harness";
import {
  isVehicleKind,
  laneArtCentre,
  spritesOfFrame,
  type Sprite,
} from "./sprites";

/** One lane item, held still, and the draws the frame after it issued. */
export interface LaneArt {
  /** Every `drawImage` of that frame, each matched against the seeded art. */
  sprites: Sprite[];
  /** The item as the build reports it: its left edge, its row, its length. */
  item: VehicleSnapshot | FloeItemSnapshot;
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
  kind: ItemKind,
  col: number,
): Promise<LaneArt> {
  const [id] = poseLane(h, row, kind, [col]);
  const sprites = await spritesOfFrame(h);
  const snapshot = h.snapshot();
  const item = isVehicleKind(kind)
    ? vehicleById(snapshot, id)
    : floeById(snapshot, id);
  if (item === undefined) {
    fail(
      `the ${kind} posed on row ${row} still on its roster ` +
        `(specs/instrumentation.md)`,
      `no item with id ${id}`,
    );
  }
  return { sprites, item, centre: laneArtCentre(item) };
}
