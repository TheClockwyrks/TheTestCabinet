// Fathom — the maze the trench is laid out on.
//
// It holds one layout at a time, in the alphabet `specs/state.md` reports, and
// answers everything the rest of the game asks of the ground: what a tile is,
// who may enter it, where a step in a direction lands with the wrap tunnel
// applied, the corridor flood a sonar wavefront travels, and the first step of
// the shortest corridor route between two tiles.
//
// The den, the gate and the wrap tunnel are read off whatever layout is
// standing rather than named beside it, because `setMaze`
// (`specs/instrumentation.md`) replaces the layout with a fixture that brings
// its own — or brings none at all, which the game then runs on as it stands.

import { GRID_COLS, GRID_ROWS } from "./constants";
import type { Cell, Dir, TileKind } from "./grid";
import { DIRS, cellIndex, inGrid, offsetOf } from "./grid";

/** Whether a tile may be entered, which each traveller answers for itself. */
export type TileTest = (tx: number, ty: number) => boolean;

const TILE_KINDS = new Set<string>(["#", ".", "g", "d"]);

function parse(layout: readonly string[]): TileKind[][] {
  if (layout.length !== GRID_ROWS) {
    throw new Error(
      `maze: expected ${GRID_ROWS} rows, received ${layout.length}`,
    );
  }
  const rows: TileKind[][] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    const source = layout[ty];
    if (source.length !== GRID_COLS) {
      throw new Error(
        `maze: row ${ty} has ${source.length} characters, expected ${GRID_COLS}`,
      );
    }
    const row: TileKind[] = [];
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const character = source[tx];
      if (!TILE_KINDS.has(character)) {
        throw new Error(
          `maze: unknown tile ${JSON.stringify(character)} at (${tx}, ${ty})`,
        );
      }
      row.push(character as TileKind);
    }
    rows.push(row);
  }
  return rows;
}

export class Maze {
  private rows: TileKind[][] = [];

  /** The row the wrap tunnel pierces, or `-1` on a layout that has none. */
  wrapRow = -1;

  /** The one den gate, or `null` on a layout that carries no den. */
  gate: Cell | null = null;

  /** Every den-interior tile, in reading order. */
  denTiles: readonly Cell[] = [];

  /** Where the forager rests when the maze is laid out. */
  start: Cell = { tx: 0, ty: 0 };

  constructor(layout: readonly string[], start?: Cell) {
    this.load(layout, start);
  }

  /**
   * Replaces the layout. Without a `start` the forager's resting place is the
   * first corridor tile in reading order, which is what a posed fixture gets.
   */
  load(layout: readonly string[], start?: Cell): void {
    const rows = parse(layout);

    let gate: Cell | null = null;
    let gates = 0;
    const denTiles: Cell[] = [];
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        const kind = rows[ty][tx];
        if (kind === "d") denTiles.push({ tx, ty });
        if (kind !== "g") continue;
        gates += 1;
        gate = { tx, ty };
      }
    }
    if ((gates > 0 || denTiles.length > 0) && gates !== 1) {
      throw new Error(
        `maze: a layout carrying den tiles needs exactly one gate, found ${gates}`,
      );
    }

    // The first row, if any, whose two border tiles are both corridor: the wrap
    // tunnel of a posed fixture, exactly as `specs/instrumentation.md` reads it.
    let wrapRow = -1;
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      if (rows[ty][0] !== "." || rows[ty][GRID_COLS - 1] !== ".") continue;
      wrapRow = ty;
      break;
    }

    this.rows = rows;
    this.gate = gate;
    this.denTiles = denTiles;
    this.wrapRow = wrapRow;

    if (start) {
      this.start = start;
      return;
    }
    const first = this.firstCorridor();
    if (!first) throw new Error("maze: the layout carries no corridor tile");
    this.start = first;
  }

  /** The layout, as the snapshot's `tiles` reports it. */
  toRows(): string[] {
    return this.rows.map((row) => row.join(""));
  }

  at(tx: number, ty: number): TileKind {
    return inGrid(tx, ty) ? this.rows[ty][tx] : "#";
  }

  isRock(tx: number, ty: number): boolean {
    return this.at(tx, ty) === "#";
  }

  isCorridor(tx: number, ty: number): boolean {
    return this.at(tx, ty) === ".";
  }

  isDen(tx: number, ty: number): boolean {
    return this.at(tx, ty) === "d";
  }

  isGate(tx: number, ty: number): boolean {
    return this.at(tx, ty) === "g";
  }

  /** The forager travels over corridor tiles and nothing else. */
  openToForager = (tx: number, ty: number): boolean => this.isCorridor(tx, ty);

  /** A predator adds the den chamber and its gate to the corridors. */
  openToPredator = (tx: number, ty: number): boolean => {
    const kind = this.at(tx, ty);
    return kind === "." || kind === "d" || kind === "g";
  };

  /** The first corridor tile in reading order, or `null` if there is none. */
  firstCorridor(): Cell | null {
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        if (this.rows[ty][tx] === ".") return { tx, ty };
      }
    }
    return null;
  }

  /** Whether a tile is one of the two mouths of the wrap tunnel. */
  isWrapMouth(tx: number, ty: number): boolean {
    return ty === this.wrapRow && (tx === 0 || tx === GRID_COLS - 1);
  }

  /**
   * The tile one step in `dir`, with the wrap tunnel joining the two mouths of
   * its pierced row as neighbors. Off any other border the step leaves the
   * grid, where every tile reads as rock.
   */
  step(tx: number, ty: number, dir: Dir): Cell {
    const { dtx, dty } = offsetOf(dir);
    let nx = tx + dtx;
    const ny = ty + dty;
    if (ty === this.wrapRow && dty === 0) {
      if (nx < 0) nx = GRID_COLS - 1;
      else if (nx >= GRID_COLS) nx = 0;
    }
    return { tx: nx, ty: ny };
  }

  /** Every direction out of a tile that leads somewhere `open` accepts. */
  exits(tx: number, ty: number, open: TileTest): Dir[] {
    const out: Dir[] = [];
    for (const dir of DIRS) {
      const next = this.step(tx, ty, dir);
      if (open(next.tx, next.ty)) out.push(dir);
    }
    return out;
  }

  /**
   * The autotile frame for a rock tile: a bitmask of which orthogonal sides are
   * rock too, `N = 1`, `E = 2`, `S = 4`, `W = 8`. Outside the grid counts as
   * rock, so the border merges rather than drawing an edge against nothing.
   */
  wallMask(tx: number, ty: number): number {
    let mask = 0;
    if (this.isRock(tx, ty - 1) || ty - 1 < 0) mask |= 1;
    if (this.isRock(tx + 1, ty) || tx + 1 >= GRID_COLS) mask |= 2;
    if (this.isRock(tx, ty + 1) || ty + 1 >= GRID_ROWS) mask |= 4;
    if (this.isRock(tx - 1, ty) || tx - 1 < 0) mask |= 8;
    return mask;
  }

  /**
   * The corridor flood a sonar wavefront travels, grouped by how many corridor
   * steps out each tile lies: index `d` holds every tile reached in exactly `d`
   * steps, and index `0` holds the origin alone. It bends around corners and
   * through junctions and enters no space rock seals off, which is the geometry
   * `specs/sensing.md` gives a pulse.
   */
  floodBuckets(origin: Cell, range: number): Cell[][] {
    const seen = new Set<number>([cellIndex(origin.tx, origin.ty)]);
    const buckets: Cell[][] = [[origin]];
    let frontier: Cell[] = [origin];
    for (let step = 0; step < range; step++) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        for (const dir of DIRS) {
          const to = this.step(cell.tx, cell.ty, dir);
          if (!this.isCorridor(to.tx, to.ty)) continue;
          const key = cellIndex(to.tx, to.ty);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(to);
        }
      }
      if (next.length === 0) break;
      buckets.push(next);
      frontier = next;
    }
    return buckets;
  }

  /**
   * The first step of a shortest route from `from` to `to` through tiles `open`
   * accepts, which is what a predator holding a fix steers by so it rounds the
   * rock between it and the tile it is driving at. `null` when it is already
   * there or no route exists.
   */
  firstStepToward(from: Cell, to: Cell, open: TileTest): Dir | null {
    if (from.tx === to.tx && from.ty === to.ty) return null;
    const seen = new Set<number>([cellIndex(from.tx, from.ty)]);
    const opening = new Map<number, Dir>();
    let frontier: Cell[] = [from];
    while (frontier.length > 0) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        const came = opening.get(cellIndex(cell.tx, cell.ty));
        for (const dir of DIRS) {
          const to2 = this.step(cell.tx, cell.ty, dir);
          if (!open(to2.tx, to2.ty)) continue;
          const key = cellIndex(to2.tx, to2.ty);
          if (seen.has(key)) continue;
          seen.add(key);
          // The route's opening move: the source's own neighbors are reached by
          // `dir`, and everything deeper inherits the move it was reached by.
          const opener = came ?? dir;
          if (to2.tx === to.tx && to2.ty === to.ty) return opener;
          opening.set(key, opener);
          next.push(to2);
        }
      }
      frontier = next;
    }
    return null;
  }
}
