// Meltdown — the floor's geometry, as arithmetic over `src/constants.ts`.
//
// specs/floor.md owns the tile-to-stage map and `src/constants.ts` states it;
// nothing here restates a figure. What lives here is the derived geometry every
// other module asks for: which tiles a footprint covers, which tile a point
// falls in, which tiles an opening opens onto, and the perimeter EDGE-TILES the
// heat model classifies (specs/heat.md, Faces, edge-tiles, and neighbours).

import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  LEFT_VENT_ROWS,
  OPPOSITE,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  TILE,
  TOP_VENT_COLS,
  TOWER_DEFS,
  tileCX,
  tileCY,
  type ExhaustName,
  type Face,
  type TowerType,
  type VentName,
} from "./constants";
import type { TowerState } from "./game";

/** A tile on the grid. */
export interface Tile {
  readonly col: number;
  readonly row: number;
}

/** The four faces in rotation order, so rotation `1` turns N into E. */
export const FACE_ORDER: readonly Face[] = ["N", "E", "S", "W"];

/** The footprint side, in tiles, of a tower of `type`. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/** Whether a tower of `type` is one of the six emitters. */
export function isEmitter(type: TowerType): boolean {
  return TOWER_DEFS[type].kind === "emitter";
}

/**
 * The world faces a tower's radiator faces point at, once its placement
 * rotation has turned them (specs/towers.md). A mover has none at any rotation.
 */
export function worldRadiators(type: TowerType, rotation: number): Face[] {
  const step = ((rotation % 4) + 4) % 4;
  return TOWER_DEFS[type].radiators.map(
    (face) => FACE_ORDER[(FACE_ORDER.indexOf(face) + step) % 4],
  );
}

/** The index of tile `(col, row)` in a `COLS * ROWS` grid array. */
export function tileIndex(col: number, row: number): number {
  return row * COLS + col;
}

/** The tile a stage point falls in, which may be off the grid. */
export function tileAt(x: number, y: number): Tile {
  return {
    col: Math.floor((x - FLOOR_X0) / TILE),
    row: Math.floor((y - FLOOR_Y0) / TILE),
  };
}

/** The centre of tile `(col, row)`, on the stage. */
export function tileCentre(col: number, row: number): { x: number; y: number } {
  return { x: tileCX(col), y: tileCY(row) };
}

/** The tiles a tower of `type` anchored at `(col, row)` covers. */
export function footprintTiles(
  type: TowerType,
  col: number,
  row: number,
): Tile[] {
  const size = sizeOf(type);
  const tiles: Tile[] = [];
  for (let r = row; r < row + size; r += 1) {
    for (let c = col; c < col + size; c += 1) tiles.push({ col: c, row: r });
  }
  return tiles;
}

/** Whether `(col, row)` lies inside the footprint of `tower`. */
export function coversTile(
  tower: Pick<TowerState, "type" | "col" | "row">,
  col: number,
  row: number,
): boolean {
  const size = sizeOf(tower.type);
  return (
    col >= tower.col &&
    col < tower.col + size &&
    row >= tower.row &&
    row < tower.row + size
  );
}

/**
 * A tile-indexed map from tile to the INDEX of the tower standing on it in
 * `towers`, or `-1`. It is what "blocked" means everywhere else in the build.
 */
export function occupancy(towers: readonly TowerState[]): Int32Array {
  const map = new Int32Array(COLS * ROWS).fill(-1);
  towers.forEach((tower, index) => {
    for (const tile of footprintTiles(tower.type, tower.col, tower.row)) {
      if (
        tile.col >= 0 &&
        tile.col < COLS &&
        tile.row >= 0 &&
        tile.row < ROWS
      ) {
        map[tileIndex(tile.col, tile.row)] = index;
      }
    }
  });
  return map;
}

/** The tiles the named vent opens onto. */
export function ventTiles(vent: VentName): Tile[] {
  return vent === "left"
    ? LEFT_VENT_ROWS.map((row) => ({ col: 0, row }))
    : TOP_VENT_COLS.map((col) => ({ col, row: 0 }));
}

/** The tiles the named exhaust opens onto. */
export function exhaustTiles(exhaust: ExhaustName): Tile[] {
  return exhaust === "right"
    ? RIGHT_EXHAUST_ROWS.map((row) => ({ col: COLS - 1, row }))
    : BOTTOM_EXHAUST_COLS.map((col) => ({ col, row: ROWS - 1 }));
}

/** The exhaust a unit that entered at `vent` is assigned for its whole life. */
export function exhaustOf(vent: VentName): ExhaustName {
  return OPPOSITE[vent];
}

/** Whether `(col, row)` is one of the named exhaust's opening tiles. */
export function isExhaustTile(
  exhaust: ExhaustName,
  col: number,
  row: number,
): boolean {
  return exhaustTiles(exhaust).some(
    (tile) => tile.col === col && tile.row === row,
  );
}

/**
 * The midpoint of an exhaust opening's run of tile centres, which is the point
 * a flyer travels to (specs/mazing.md, Flyers ignore the maze).
 */
export function exhaustMidpoint(exhaust: ExhaustName): {
  x: number;
  y: number;
} {
  const tiles = exhaustTiles(exhaust);
  const first = tileCentre(tiles[0].col, tiles[0].row);
  const last = tileCentre(
    tiles[tiles.length - 1].col,
    tiles[tiles.length - 1].row,
  );
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
}

/** One perimeter edge-tile of a footprint: the face it lies on, and the tile
 * immediately outside it, which may be off the grid (the casing). */
export interface EdgeTile {
  readonly face: Face;
  readonly outCol: number;
  readonly outRow: number;
}

/**
 * Every perimeter edge-tile of a footprint, one per tile of each of its four
 * sides, so a 2x2 face is two edge-tiles and a 4x4 face is four
 * (specs/heat.md).
 */
export function edgeTiles(
  type: TowerType,
  col: number,
  row: number,
): EdgeTile[] {
  const size = sizeOf(type);
  const edges: EdgeTile[] = [];
  for (let i = 0; i < size; i += 1) {
    edges.push({ face: "N", outCol: col + i, outRow: row - 1 });
    edges.push({ face: "S", outCol: col + i, outRow: row + size });
    edges.push({ face: "W", outCol: col - 1, outRow: row + i });
    edges.push({ face: "E", outCol: col + size, outRow: row + i });
  }
  return edges;
}
