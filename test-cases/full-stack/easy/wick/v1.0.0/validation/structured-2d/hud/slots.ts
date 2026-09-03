// hud — how the twelve slots are found on a frame the build drew.
//
// Nothing here asserts anything. `specs/ui.md` gives the HUD "`WEAPON_SLOTS`
// (`6`) slots in slot order, each held weapon as its icon with one pip per level
// held, and an empty slot visibly empty", and `specs/assets.md` fixes the file
// each icon is produced at, so a slot is found by the PRODUCED FILE the frame
// blitted into it: the harness attributes every blit to the file its bytes were
// served from. Where the slots sit, how large they are, and what an empty one
// looks like are the build's, and nothing here reads any of them.

import { ICON_PATHS, type OfferId } from "../constants";
import { blitCenter, blitsFrom, type Blit } from "../harness";

/** Every blit of `id`'s produced icon, oldest first. */
export function iconBlits(blits: readonly Blit[], id: OfferId): Blit[] {
  return blitsFrom(blits, ICON_PATHS[id]);
}

/**
 * Where `id`'s icon landed, in device pixels, or `null` where the frame drew
 * it nowhere. The LAST blit of it, because that is the one a player sees.
 */
export function iconAt(
  blits: readonly Blit[],
  id: OfferId,
): { x: number; y: number } | null {
  const drawn = iconBlits(blits, id);
  return drawn.length === 0 ? null : blitCenter(drawn[drawn.length - 1]);
}

/** Which of `ids` the frame drew an icon for, in the order `ids` names them. */
export function iconsDrawn(
  blits: readonly Blit[],
  ids: readonly OfferId[],
): OfferId[] {
  return ids.filter((id) => iconBlits(blits, id).length > 0);
}

/**
 * Whether `points` run in the order given, along whichever axis they are laid
 * out on.
 *
 * `specs/ui.md` fixes no layout, so a row of slots and a column of them are the
 * same requirement; the axis the points are more spread along is the one they
 * are ordered on, and the order a player reads is increasing along it — left to
 * right across a row, top to bottom down a column.
 */
export function inOrder(points: readonly { x: number; y: number }[]): boolean {
  if (points.length < 2) return true;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const across = Math.max(...xs) - Math.min(...xs);
  const down = Math.max(...ys) - Math.min(...ys);
  const along = across >= down ? xs : ys;
  return along.every((value, at) => at === 0 || value > along[at - 1]);
}
