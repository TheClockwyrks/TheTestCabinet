// Meltdown — where this group's scenarios stand, and the two arrangements more
// than one of them poses. GROUP-LOCAL.
//
// Almost every item here is about an OPERATION rather than about a rule of the
// game, so the floor a check poses on must contribute nothing to the reading.
// Two constraints decide where a footprint may stand:
//
//   - Clear of both straight vent-to-exhaust corridors and of all four openings,
//     so a tower posed here lengthens neither route (`specs/floor.md` puts the
//     left corridor on rows `16..19` and the top corridor down columns `22..29`).
//     An item that WANTS a route lengthened — `unit-motion-gate-leaves-pathing` —
//     builds its wall in the corridor deliberately and says so.
//   - Far enough apart that two towers neither abut (which would conduct,
//     `specs/heat.md`) nor reach the same unit (the Lance's `12.0` tiles is the
//     longest range `specs/towers.md` gives, so the pairs used for a gate reading
//     are placed tens of tiles apart rather than six).
//
// THESE ARE GEOMETRY, NOT TOLERANCES. They say WHERE a footprint stands; every
// figure a check asserts is stated in that check, derived from what `specs/`
// fixes for it.

import { COLS, LEFT_VENT_ROWS, RIGHT_EXHAUST_ROWS } from "../../src/constants";
import { fail } from "../assert";
import {
  tileCenter,
  towerById,
  unitById,
  type Harness,
  type MeltdownSnapshot,
  type SurgeType,
  type Tile,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
} from "../harness";

/**
 * Footprint anchors clear of both corridors and of all four openings, six tiles
 * apart on both axes so nothing at two of them abuts even at a 4x4 footprint.
 *
 * A check wanting several towers that disturb neither route nor each other walks
 * this list.
 */
export const QUIET_SITES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 10, row: 4 },
  { col: 34, row: 4 },
  { col: 40, row: 4 },
  { col: 4, row: 10 },
  { col: 10, row: 10 },
  { col: 34, row: 10 },
  { col: 40, row: 10 },
  { col: 4, row: 24 },
  { col: 10, row: 24 },
  { col: 34, row: 24 },
  { col: 40, row: 24 },
];

/** The `index`-th quiet anchor, wrapping. */
export function quietSite(index: number): Tile {
  return QUIET_SITES[index % QUIET_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower puts that tower. */
export const QUIET_SITE: Tile = QUIET_SITES[0];

/**
 * The far anchor, for the second half of a two-tower reading.
 *
 * Thirty tiles east of {@link QUIET_SITE} on the same rows, which is more than
 * twice the `12.0` tiles of the longest range in `specs/towers.md`: a unit posed
 * beside either tower is out of the other's reach at every type and every level,
 * so the two readings a gate item takes cannot bleed into one another.
 */
export const FAR_SITE: Tile = { col: 34, row: 4 };

/**
 * The tile a target stands on for a tower anchored at `site`: three tiles east of
 * the anchor.
 *
 * Off the footprint at every size but well inside the `6.0` tiles `specs/towers.md`
 * gives the Arc, measured from the footprint's centre as `specs/combat.md`
 * requires — so a tower posed at `site` acquires it and no reading depends on how
 * far the range reaches.
 */
export function markTile(site: Tile): Tile {
  return { col: site.col + 3, row: site.row };
}

/**
 * The hp a mark is posed with when a check needs it to SURVIVE the drive.
 *
 * `specs/combat.md`'s hardest single shot is a level III Lance's
 * `43 * 1.6^2 * 3.5`, under `400` hp; ten thousand therefore outlasts any drive
 * this group runs, so a damage reading is a subtraction rather than a death.
 */
export const DURABLE_HP = 10_000;

/**
 * A stationary mark beside the tower anchored at `site`, and its id.
 *
 * Motion off so it cannot walk out of range or reach an exhaust while a reading
 * is taken; hp far above anything a shot removes so it cannot die.
 */
export function poseMarkFor(h: Harness, site: Tile): number {
  const at = markTile(site);
  const { x, y } = tileCenter(at.col, at.row);
  h.debug.addUnit("mote", "left");
  const surge = h.snapshot().surge;
  const id = surge[surge.length - 1].id;
  h.debug.setUnitPosition(id, x, y);
  h.debug.setUnitMotion(id, false);
  h.debug.setUnitMaxHp(id, DURABLE_HP);
  h.debug.setUnitHp(id, DURABLE_HP);
  return id;
}

/**
 * The tile a walker is posed on to cross an OPEN row: column `5` of the left
 * vent's second row.
 *
 * `specs/floor.md` puts the left vent on rows `16..19` and the right exhaust on
 * the same rows, so a unit standing on one of them with an empty floor between it
 * and the far wall walks a straight line — no turn, no diagonal, and nothing for
 * a step size to round differently.
 */
export const OPEN_ROW: Tile = { col: 5, row: LEFT_VENT_ROWS[1] };

/** The far end of that row, for a check that needs to know it is not reached. */
export const OPEN_ROW_EXIT: Tile = {
  col: COLS - 1,
  row: RIGHT_EXHAUST_ROWS[1],
};

/**
 * A unit of `type` walking under its own power from `tile`, and its id.
 *
 * `addUnit` enters it into the same pathing the spawner uses and
 * `setUnitPosition` recomputes its route from the tile the position falls in
 * (`specs/instrumentation.md`), so what follows is the game's own walk.
 */
export function poseWalkerAt(h: Harness, type: SurgeType, tile: Tile): number {
  h.debug.addUnit(type, "left");
  const surge = h.snapshot().surge;
  const id = surge[surge.length - 1].id;
  const { x, y } = tileCenter(tile.col, tile.row);
  h.debug.setUnitPosition(id, x, y);
  return id;
}

/**
 * The columns a wall is built across to lengthen a walker's route, and the four
 * anchors that build it.
 *
 * Two columns wide at `20` and `21` — clear of the top corridor, which
 * `specs/floor.md` puts on columns `22..29` — and eight rows tall from `14` to
 * `21`, which covers the whole of the left corridor's rows `16..19` and two rows
 * of clearance either side. A ground unit on the corridor must therefore leave
 * rows `14..21` before column `20` and return to the exhaust's rows `16..19`
 * after column `21`.
 */
export const WALL_ANCHORS: readonly Tile[] = [
  { col: 20, row: 14 },
  { col: 20, row: 16 },
  { col: 20, row: 18 },
  { col: 20, row: 20 },
];

/** Build that wall out of 2x2 towers of `type`, and hand back their ids. */
export function buildWall(h: Harness, type: TowerType = "arc"): number[] {
  return WALL_ANCHORS.map((anchor) => {
    h.debug.addTower(type, anchor.col, anchor.row, 0);
    const towers = h.snapshot().towers;
    return towers[towers.length - 1].id;
  });
}

/* -------------------------------------------------------------------------- */
/* Reading an entity a check just posed                                       */
/* -------------------------------------------------------------------------- */
//
// Every item here poses its own world and then reads one entity of it back, so
// "the entity is not on the roster" is a VERDICT rather than a missing
// precondition: `specs/instrumentation.md` appends an added entity to its roster
// and keeps its id for the entity's whole life. These two say that in the shape
// the runner renders, so a build whose roster lost the entity fails the item that
// reached for it rather than throwing a `TypeError` somewhere downstream.

/** The tower `id`, or a failure naming the roster that should have held it. */
export function readTower(
  snapshot: MeltdownSnapshot,
  id: number,
  context: string,
): TowerSnapshot {
  const found = towerById(snapshot, id);
  if (found === undefined) {
    return fail(
      `tower ${id} on the roster (${context}; specs/instrumentation.md, Identity)`,
      snapshot.towers.map((tower) => tower.id),
    );
  }
  return found;
}

/** The unit `id`, or a failure naming the roster that should have held it. */
export function readUnit(
  snapshot: MeltdownSnapshot,
  id: number,
  context: string,
): UnitSnapshot {
  const found = unitById(snapshot, id);
  if (found === undefined) {
    return fail(
      `unit ${id} on the roster (${context}; specs/instrumentation.md, Identity)`,
      snapshot.surge.map((unit) => unit.id),
    );
  }
  return found;
}
