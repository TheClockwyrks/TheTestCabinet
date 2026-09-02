// controls/panel — the anchors, the readings and the drives this group takes
// again and again.
//
// Every entry is a PLACE, a READING or a DRIVE, never a threshold: `FREE_SITES`
// says where a scenario stands, `requireControl` names a rectangle the panel owed
// and did not report, `heldPreview` names a preview the build did not hold,
// `tapTile` presses a tile of the floor, and `movePointerTo` moves the pointer
// without pressing anything. Every figure a check asserts stays in the check that
// asserts it.
//
// Local to this group on purpose. `building/` keeps its own copies of the quiet
// anchors and of the preview readings because it poses a different question with
// them — placement arithmetic rather than which input reached the action — and
// two small local files are cheaper than a shared one both groups have to agree
// about while their agents are writing them side by side.

import { LEFT_VENT_ROWS } from "../constants";
import { fail } from "../assert";
import { tileCentre, type Tile } from "../geometry";
import {
  clickAt,
  type BuildSnapshot,
  type Harness,
  type MeltdownSnapshot,
  type RectSnapshot,
} from "../harness";

/**
 * Footprint anchors that are quiet in both senses: clear of all four openings
 * and of both straight vent-to-exhaust corridors, so a tower posed at one
 * lengthens neither route; and six tiles apart on both axes, so towers at two of
 * them do not abut even at the Lance's 4x4 footprint and neither conducts with
 * the other.
 *
 * The left corridor runs along rows `16..19` and the top corridor down columns
 * `22..29` (specs/floor.md, The openings), and every anchor below keeps the whole
 * of a 4x4 footprint out of both. Nothing in this group is ABOUT the floor's
 * routes or a tower's neighbours, so every scenario here stands on one of these
 * and reads only the input path it is for.
 */
export const FREE_SITES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 10, row: 4 },
  { col: 16, row: 4 },
  { col: 4, row: 10 },
  { col: 10, row: 10 },
  { col: 16, row: 10 },
  { col: 4, row: 24 },
  { col: 10, row: 24 },
  { col: 16, row: 24 },
];

/** The `index`-th quiet anchor, wrapping. */
export function freeSite(index: number): Tile {
  return FREE_SITES[index % FREE_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower in it puts that tower. */
export const FREE_SITE: Tile = FREE_SITES[0];

/** The first row of the left corridor, for a failure that names it. */
export const CORRIDOR_ROW = LEFT_VENT_ROWS[0];

/** The four panel controls the snapshot reports as `null` when they are not drawn. */
type OptionalControl = "rotate" | "cancel" | "upgrade" | "sell";

/**
 * The hit rectangle the panel reported for a control that is DRAWN right now, or
 * the failure that it reported none.
 *
 * specs/instrumentation.md reports `rotate` and `cancel` as `null` only "when no
 * placement is armed" and `upgrade` and `sell` as `null` only "when no tower is
 * selected", and specs/hud.md draws each in exactly the state its check poses. So
 * a scenario that armed a placement, or selected a tower, and then found no
 * rectangle has found a control the panel owes and does not offer — which is a
 * verdict about the build, not an absent value for the check to reason about.
 */
export function requireControl(
  snapshot: MeltdownSnapshot,
  control: OptionalControl,
  doing: string,
): RectSnapshot {
  const rect = snapshot.controls[control];
  if (rect === null) {
    return fail(
      `a hit rectangle for the ${control} control, which the panel draws in ` +
        `the state this scenario posed (${doing}; specs/hud.md, ` +
        `specs/instrumentation.md)`,
      null,
    );
  }
  return rect;
}

/**
 * The held build preview, or the failure that the build holds none.
 *
 * specs/building.md, Arming a type: arming holds a preview. A check that armed a
 * type and found `build` null has found a build that does not hold one, and says
 * so rather than reading a field off nothing.
 */
export function heldPreview(h: Harness, doing: string): BuildSnapshot {
  const build = h.snapshot().build;
  if (build === null) {
    return fail(
      `a held build preview (${doing}; specs/building.md, Arming a type)`,
      null,
    );
  }
  return build;
}

/**
 * Press and release the pointer at the centre of a tile of the floor, through the
 * ENGINE's own pointer input.
 *
 * The path a player's finger takes: `clickAt` moves the pointer there, presses,
 * runs the frame it is down for, releases, and runs the frame the release
 * resolves on — which is the "press and release inside one region" that
 * specs/controls.md answers as one interaction with that region.
 */
export function tapTile(h: Harness, col: number, row: number): Promise<void> {
  const at = tileCentre(col, row);
  return clickAt(h, at.x, at.y);
}

/**
 * Move the pointer to a logical stage point through the ENGINE's own pointer
 * input, and run the one frame that delivers the sample.
 *
 * Nothing is pressed and nothing is released, so nothing is armed, built or
 * selected: this is the move alone, which is what specs/controls.md gives the
 * preview and the shop hover. The frame is not optional — the engine queues a
 * pointer sample and the game reads it inside its next `update` — and exactly one
 * frame passes, so nothing a caller is counting moves.
 */
export async function movePointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.point("move", x, y);
  await h.advance(1);
}
