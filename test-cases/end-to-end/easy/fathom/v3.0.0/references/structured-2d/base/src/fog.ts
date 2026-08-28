// Fathom — the fog of war and the light that lifts it.
//
// `specs/sensing.md` puts every tile in one of three states: unrevealed,
// remembered, and lit. Memory lasts the whole maze; the lit set is rebuilt
// every step from whatever is shining this instant — the forager's own
// line-of-sight pocket, the tiles a sonar front is crossing, and the disc of a
// burning flare. This module holds both and answers what a tile is; deciding
// which sources shine is the game's.

import {
  GRID_COLS,
  GRID_ROWS,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import type { Cell } from "./grid";
import { cellAt, cellIndex, inGrid, tileCenterX, tileCenterY } from "./grid";
import type { Maze } from "./maze";

/** A tile's visibility, in the alphabet `specs/state.md` reports. */
export type Visibility = "u" | "r" | "l";

/** The light pocket's radius `V` at a brightness `G`. */
export function visionRadius(brightness: number): number {
  return VISION_MIN + VISION_GAIN * brightness;
}

/**
 * Whether the straight line between two tiles crosses rock before it arrives.
 * The walk is corner-safe: an exact diagonal through a corner is blocked when
 * both of its shoulders are rock, so light does not slip past a rock corner.
 */
export function lineOfSightClear(maze: Maze, from: Cell, to: Cell): boolean {
  let x = from.tx;
  let y = from.ty;
  const dx = Math.abs(to.tx - from.tx);
  const dy = Math.abs(to.ty - from.ty);
  const stepX = to.tx > from.tx ? 1 : -1;
  const stepY = to.ty > from.ty ? 1 : -1;
  let steps = dx + dy;
  let error = dx - dy;
  const dx2 = dx * 2;
  const dy2 = dy * 2;
  while (steps > 0) {
    if (error > 0) {
      x += stepX;
      error -= dy2;
    } else if (error < 0) {
      y += stepY;
      error += dx2;
    } else {
      if (maze.isRock(x + stepX, y) && maze.isRock(x, y + stepY)) return false;
      x += stepX;
      y += stepY;
      error -= dy2;
      error += dx2;
      steps -= 1;
    }
    steps -= 1;
    if (x === to.tx && y === to.ty) break;
    if (maze.isRock(x, y)) return false;
  }
  return true;
}

export class Fog {
  private readonly revealed: boolean[] = new Array<boolean>(
    GRID_COLS * GRID_ROWS,
  ).fill(false);

  private readonly litTiles = new Set<number>();

  private readonly bodyLit = new Set<number>();

  /** Back to a maze nothing has touched. */
  reset(): void {
    this.revealed.fill(false);
    this.litTiles.clear();
    this.bodyLit.clear();
  }

  /** Drops the lit set, which is rebuilt from every source each step. */
  clearLit(): void {
    this.litTiles.clear();
    this.bodyLit.clear();
  }

  /** Remembers a tile without lighting it this instant. */
  reveal(tx: number, ty: number): void {
    if (!inGrid(tx, ty)) return;
    this.revealed[cellIndex(tx, ty)] = true;
  }

  /**
   * Lights a tile this instant, which also remembers it. This is the light a
   * body standing on the tile is seen by: the forager's own pocket, and a
   * flare's disc.
   */
  light(tx: number, ty: number): void {
    if (!inGrid(tx, ty)) return;
    const key = cellIndex(tx, ty);
    this.revealed[key] = true;
    this.litTiles.add(key);
    this.bodyLit.add(key);
  }

  /**
   * Lights the ground alone, as a wavefront's crest does while it sweeps over
   * it. The tile is drawn at full brightness and remembered from then on, and
   * a body standing on it is not shown by it: a pulse leaves the amber lights
   * exactly as they were and marks a hunter through its own mark instead
   * (`specs/sensing.md`).
   */
  flash(tx: number, ty: number): void {
    if (!inGrid(tx, ty)) return;
    const key = cellIndex(tx, ty);
    this.revealed[key] = true;
    this.litTiles.add(key);
  }

  isRevealed(tx: number, ty: number): boolean {
    return inGrid(tx, ty) && this.revealed[cellIndex(tx, ty)];
  }

  isLit(tx: number, ty: number): boolean {
    return inGrid(tx, ty) && this.litTiles.has(cellIndex(tx, ty));
  }

  /** Whether a body standing on the tile is shown by the light on it. */
  showsBody(tx: number, ty: number): boolean {
    return inGrid(tx, ty) && this.bodyLit.has(cellIndex(tx, ty));
  }

  visibilityAt(tx: number, ty: number): Visibility {
    if (this.isLit(tx, ty)) return "l";
    return this.isRevealed(tx, ty) ? "r" : "u";
  }

  /**
   * The forager's own light: every tile whose center lies within `radius` of
   * `(x, y)` and whose line from the forager crosses no rock before it. The
   * light lands on the rock it reaches and stops there.
   */
  lightPocket(maze: Maze, x: number, y: number, radius: number): void {
    const origin = cellAt(x, y);
    const span = Math.ceil(radius / TILE) + 1;
    const limit = radius * radius;
    for (let ty = origin.ty - span; ty <= origin.ty + span; ty++) {
      if (ty < 0 || ty >= GRID_ROWS) continue;
      for (let tx = origin.tx - span; tx <= origin.tx + span; tx++) {
        if (tx < 0 || tx >= GRID_COLS) continue;
        const ox = tileCenterX(tx) - x;
        const oy = tileCenterY(ty) - y;
        if (ox * ox + oy * oy > limit) continue;
        if (!lineOfSightClear(maze, origin, { tx, ty })) continue;
        this.light(tx, ty);
      }
    }
  }

  /**
   * A flare's bloom: every tile whose center lies inside the disc, floor and
   * rock alike and straight through whatever rock lies between.
   */
  lightDisc(x: number, y: number, radius: number): void {
    const origin = cellAt(x, y);
    const span = Math.ceil(radius / TILE) + 1;
    const limit = radius * radius;
    for (let ty = origin.ty - span; ty <= origin.ty + span; ty++) {
      if (ty < 0 || ty >= GRID_ROWS) continue;
      for (let tx = origin.tx - span; tx <= origin.tx + span; tx++) {
        if (tx < 0 || tx >= GRID_COLS) continue;
        const ox = tileCenterX(tx) - x;
        const oy = tileCenterY(ty) - y;
        if (ox * ox + oy * oy > limit) continue;
        this.light(tx, ty);
      }
    }
  }

  /** The fog, as the snapshot's `visibility` reports it. */
  toRows(): string[] {
    const rows: string[] = [];
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      let row = "";
      for (let tx = 0; tx < GRID_COLS; tx++) row += this.visibilityAt(tx, ty);
      rows.push(row);
    }
    return rows;
  }
}
