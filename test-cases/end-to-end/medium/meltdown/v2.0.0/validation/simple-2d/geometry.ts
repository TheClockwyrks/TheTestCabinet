// Meltdown — the floor's geometry, as the CASE computes it. CASE-PROVIDED.
//
// Tile arithmetic over `src/constants.ts` — the figures the case seeds and a
// build is told not to edit — and nothing else. `thermal.ts`, `routes.ts` and
// `harness.ts` all rest on it, which is why it lives here rather than inside one
// of them.
//
// NOTHING HERE IMPORTS A BUILD MODULE. The build has geometry of its own, and a
// check that asked the build where its footprints and edge-tiles are would agree
// with the build about the wrong answer. What a check compares is the picture the
// build reports through `snapshot()` against the picture the specification's own
// figures produce, so this module is the second, independent one.

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
  tileCX,
  tileCY,
} from "../src/constants";
import type { ExhaustName, Face, TowerType, VentName } from "./surface";

/** A tile on the grid. */
export interface Tile {
  col: number;
  row: number;
}

/** A point in logical stage units. */
export interface Point {
  x: number;
  y: number;
}

/** The four faces in rotation order, so rotation `1` turns N into E. */
export const FACE_ORDER: readonly Face[] = ["N", "E", "S", "W"];

/** The footprint side, in tiles, of a tower of `type` (specs/towers.md). */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/** Whether `type` is one of the six emitters rather than a mover. */
export function isEmitter(type: TowerType): boolean {
  return TOWER_DEFS[type].kind === "emitter";
}

/**
 * The world faces a tower's radiator faces point at once its placement rotation
 * has turned them (specs/towers.md). A mover has none at any rotation.
 */
export function worldRadiators(type: TowerType, rotation: number): Face[] {
  const step = ((Math.trunc(rotation) % 4) + 4) % 4;
  return TOWER_DEFS[type].radiators.map(
    (face) => FACE_ORDER[(FACE_ORDER.indexOf(face) + step) % 4],
  );
}

/** Whether `(col, row)` is a tile of the grid at all. */
export function onGrid(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/** The centre of tile `(col, row)`, in logical stage units. */
export function tileCentre(col: number, row: number): Point {
  return { x: tileCX(col), y: tileCY(row) };
}

/** The tile a logical stage point falls in, which may be off the grid. */
export function tileAt(x: number, y: number): Tile {
  return {
    col: Math.floor((x - FLOOR_X0) / TILE),
    row: Math.floor((y - FLOOR_Y0) / TILE),
  };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.col === b.col && a.row === b.row;
}

/** A tile as `"col,row"`, for a set comparison or a failure message. */
export function tileKey(tile: Tile): string {
  return `${tile.col},${tile.row}`;
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

/** The centre of that footprint, in logical stage units. */
export function footprintCentreOf(
  type: TowerType,
  col: number,
  row: number,
): Point {
  const size = sizeOf(type);
  return {
    x: FLOOR_X0 + (col + size / 2) * TILE,
    y: FLOOR_Y0 + (row + size / 2) * TILE,
  };
}

/**
 * One perimeter edge-tile of a footprint: the face it lies on, and the tile
 * immediately outside it, which may be off the grid — the casing.
 *
 * One per tile of each of the four sides, so a 2x2 face is two edge-tiles and a
 * 4x4 face is four (specs/heat.md, Faces, edge-tiles, and neighbours).
 */
export interface EdgeTile {
  face: Face;
  outCol: number;
  outRow: number;
}

/** Every perimeter edge-tile of a footprint. */
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

/** The tiles the named vent opens onto (specs/floor.md). */
export function ventTiles(vent: VentName): Tile[] {
  return vent === "left"
    ? LEFT_VENT_ROWS.map((row) => ({ col: 0, row }))
    : TOP_VENT_COLS.map((col) => ({ col, row: 0 }));
}

/** The tiles the named exhaust opens onto (specs/floor.md). */
export function exhaustTiles(exhaust: ExhaustName): Tile[] {
  return exhaust === "right"
    ? RIGHT_EXHAUST_ROWS.map((row) => ({ col: COLS - 1, row }))
    : BOTTOM_EXHAUST_COLS.map((col) => ({ col, row: ROWS - 1 }));
}

/** The exhaust a unit that entered at `vent` is assigned for its whole life. */
export function exhaustOf(vent: VentName): ExhaustName {
  return vent === "left" ? "right" : "bottom";
}

/**
 * The midpoint of an exhaust opening's run of tile centres, which is the point a
 * flyer travels to (specs/mazing.md, Flyers ignore the maze).
 */
export function exhaustMidpoint(exhaust: ExhaustName): Point {
  const tiles = exhaustTiles(exhaust);
  const first = tileCentre(tiles[0].col, tiles[0].row);
  const last = tileCentre(
    tiles[tiles.length - 1].col,
    tiles[tiles.length - 1].row,
  );
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
}
