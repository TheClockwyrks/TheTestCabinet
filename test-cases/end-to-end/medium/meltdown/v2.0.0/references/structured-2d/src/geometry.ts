// Meltdown — the floor's geometry, as arithmetic over the tile grid.
//
// `specs/floor.md` owns the tile-to-stage map and `src/constants.ts` holds it,
// so this module never restates a figure: it composes the constants into the
// questions the rest of the game asks. Which tiles a footprint covers, which
// tile a centre falls in, which tiles an opening opens onto, where a face's
// outside lies, and which tower — if any — owns a tile.
//
// Everything here is a pure function of its arguments and the state it is
// handed. Nothing is cached at module level.

import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  LEFT_VENT_ROWS,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  TILE,
  TOP_VENT_COLS,
  TOWER_DEFS,
  inBounds,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
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

/** An axis-aligned rectangle in logical stage units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four faces in the order a placement rotation turns them through. */
export const FACE_ORDER: readonly Face[] = ["N", "E", "S", "W"];

/** The tile a stage position falls in. It may be off the grid. */
export function tileAt(x: number, y: number): Tile {
  return {
    col: Math.floor((x - FLOOR_X0) / TILE),
    row: Math.floor((y - FLOOR_Y0) / TILE),
  };
}

/** The centre of a tile, in logical stage units. */
export function tileCentre(col: number, row: number): { x: number; y: number } {
  return { x: tileCX(col), y: tileCY(row) };
}

/** The index a tile takes in a row-major grid array. */
export function tileIndex(col: number, row: number): number {
  return row * COLS + col;
}

/** The footprint side, in tiles, of a tower of this type. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/** Every tile a `size x size` footprint anchored at `(col, row)` covers. */
export function footprintTiles(col: number, row: number, size: number): Tile[] {
  const tiles: Tile[] = [];
  for (let r = row; r < row + size; r += 1) {
    for (let c = col; c < col + size; c += 1) tiles.push({ col: c, row: r });
  }
  return tiles;
}

/** The rectangle a footprint covers, in logical stage units. */
export function footprintRect(col: number, row: number, size: number): Rect {
  return {
    x: tileLeft(col),
    y: tileTop(row),
    w: size * TILE,
    h: size * TILE,
  };
}

/**
 * The outside tile of each edge-tile along one face of a footprint, in order.
 * A face is one edge-tile long per tile of the footprint's side, and the tile
 * named is the one immediately OUTSIDE it, which is what decides whether that
 * edge sheds to air, conducts, or exchanges (specs/heat.md).
 */
export function faceOutsideTiles(
  col: number,
  row: number,
  size: number,
  face: Face,
): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < size; i += 1) {
    switch (face) {
      case "N":
        tiles.push({ col: col + i, row: row - 1 });
        break;
      case "S":
        tiles.push({ col: col + i, row: row + size });
        break;
      case "W":
        tiles.push({ col: col - 1, row: row + i });
        break;
      case "E":
        tiles.push({ col: col + size, row: row + i });
        break;
    }
  }
  return tiles;
}

/**
 * A tower's radiator faces in WORLD orientation: its local faces turned by its
 * placement rotation, `N -> E -> S -> W` per step (specs/towers.md).
 */
export function worldFaces(local: readonly Face[], rotation: number): Face[] {
  const steps = ((rotation % 4) + 4) % 4;
  return local.map((face) => {
    const index = FACE_ORDER.indexOf(face);
    return FACE_ORDER[(index + steps) % FACE_ORDER.length];
  });
}

/** The opening tiles of a vent, in order along the casing edge. */
export function ventTiles(vent: VentName): Tile[] {
  return vent === "left"
    ? LEFT_VENT_ROWS.map((row) => ({ col: 0, row }))
    : TOP_VENT_COLS.map((col) => ({ col, row: 0 }));
}

/** The opening tiles of an exhaust, in order along the casing edge. */
export function exhaustTiles(exhaust: ExhaustName): Tile[] {
  return exhaust === "right"
    ? RIGHT_EXHAUST_ROWS.map((row) => ({ col: COLS - 1, row }))
    : BOTTOM_EXHAUST_COLS.map((col) => ({ col, row: ROWS - 1 }));
}

/**
 * The midpoint of an exhaust opening's run of tile centres, which is the point
 * a flyer travels to (specs/mazing.md, Flyers ignore the maze).
 */
export function exhaustPoint(exhaust: ExhaustName): { x: number; y: number } {
  const tiles = exhaustTiles(exhaust);
  const first = tileCentre(tiles[0].col, tiles[0].row);
  const last = tileCentre(
    tiles[tiles.length - 1].col,
    tiles[tiles.length - 1].row,
  );
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
}

/** Whether a tile is one of the opening tiles of that exhaust. */
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
 * Which tower owns each tile, as a row-major grid of tower ids with `-1` for
 * open floor. Every tower blocks its whole footprint, whatever kind it is
 * (specs/mazing.md, Every tower is a wall).
 */
export function occupancy(towers: readonly TowerState[]): Int32Array {
  const owners = new Int32Array(COLS * ROWS).fill(-1);
  for (const tower of towers) {
    for (const tile of footprintTiles(
      tower.col,
      tower.row,
      sizeOf(tower.type),
    )) {
      if (inBounds(tile.col, tile.row)) {
        owners[tileIndex(tile.col, tile.row)] = tower.id;
      }
    }
  }
  return owners;
}

/** The blocked-tile mask a set of towers produces. */
export function blockedMask(towers: readonly TowerState[]): Uint8Array {
  const owners = occupancy(towers);
  const blocked = new Uint8Array(owners.length);
  for (let i = 0; i < owners.length; i += 1)
    blocked[i] = owners[i] >= 0 ? 1 : 0;
  return blocked;
}

/** Whether a point lies inside a rectangle, edges included. */
export function inRect(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}
