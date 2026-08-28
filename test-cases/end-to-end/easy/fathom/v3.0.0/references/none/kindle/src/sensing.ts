// Fathom — the fog of war and the forager's light.
//
// Holds what the dive has revealed of the maze, what is lit this instant, and
// the straight-line rule that decides which of the two a tile is in
// (`specs/sensing.md`). Nothing here draws: it answers questions the renderer
// and the hunters both ask.

import { GRID_COLS, GRID_ROWS, TILE } from "./constants";
import { Maze } from "./maze";
import type { Visibility } from "./types";

/** A tile's index in the row-major arrays this module keeps. */
export function tileKey(col: number, row: number): number {
  return row * GRID_COLS + col;
}

const VISIBILITY_CHAR: Readonly<Record<Visibility, string>> = {
  unrevealed: "u",
  remembered: "r",
  lit: "l",
};

/**
 * Whether the straight line from the center of `(fc, fr)` to the center of
 * `(tc, tr)` crosses rock before it arrives. The target itself is not consulted,
 * so light reaches the rock it lands on and stops there.
 *
 * The walk steps one tile at a time along the line. Where the line runs exactly
 * through a corner it takes the diagonal, and that diagonal is blocked only when
 * both shoulders of the corner are rock, so light squeezes past a single jutting
 * block but not through a sealed diagonal seam.
 */
export function lineOfSightClear(
  maze: Maze,
  fc: number,
  fr: number,
  tc: number,
  tr: number,
): boolean {
  let x = fc;
  let y = fr;
  const dx = Math.abs(tc - fc);
  const dy = Math.abs(tr - fr);
  const xi = tc > fc ? 1 : -1;
  const yi = tr > fr ? 1 : -1;
  let steps = dx + dy;
  let err = dx - dy;
  const dx2 = dx * 2;
  const dy2 = dy * 2;
  while (steps > 0) {
    if (err > 0) {
      x += xi;
      err -= dy2;
    } else if (err < 0) {
      y += yi;
      err += dx2;
    } else {
      if (maze.isRock(x + xi, y) && maze.isRock(x, y + yi)) return false;
      x += xi;
      y += yi;
      err -= dy2;
      err += dx2;
      steps--;
    }
    steps--;
    if (x === tc && y === tr) break;
    if (maze.isRock(x, y)) return false;
  }
  return true;
}

export class Fog {
  /** Revealed by any source, and remembered for the rest of the maze. */
  private revealed: boolean[] = new Array(GRID_COLS * GRID_ROWS).fill(false);

  /** Lit this instant, by the light, a live sonar mark, or a flare. */
  private litTiles = new Set<number>();

  /** Back to fully unrevealed, as a fresh maze opens. */
  reset(): void {
    this.revealed.fill(false);
    this.litTiles.clear();
  }

  reveal(col: number, row: number): void {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    this.revealed[tileKey(col, row)] = true;
  }

  isRevealed(col: number, row: number): boolean {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS)
      return false;
    return this.revealed[tileKey(col, row)];
  }

  isLit(col: number, row: number): boolean {
    return this.litTiles.has(tileKey(col, row));
  }

  /** Mark a tile lit this instant, and remember it from now on. */
  light(col: number, row: number): void {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    const k = tileKey(col, row);
    this.litTiles.add(k);
    this.revealed[k] = true;
  }

  /** Drop the lit set, before the sources that hold it are gathered again. */
  clearLit(): void {
    this.litTiles.clear();
  }

  /**
   * Light the pocket around the forager: every tile whose center lies within `v`
   * of the forager's center and whose line of sight is clear. Rock the light
   * lands on is lit; what stands behind it is left as it was.
   */
  lightPocket(maze: Maze, x: number, y: number, v: number): void {
    const fc = Maze.colAt(x);
    const fr = Maze.rowAt(y);
    const reach = Math.ceil(v / TILE) + 1;
    const v2 = v * v;
    for (let r = fr - reach; r <= fr + reach; r++) {
      if (r < 0 || r >= GRID_ROWS) continue;
      for (let c = fc - reach; c <= fc + reach; c++) {
        if (c < 0 || c >= GRID_COLS) continue;
        const ox = Maze.centerX(c) - x;
        const oy = Maze.centerY(r) - y;
        if (ox * ox + oy * oy > v2) continue;
        if (!lineOfSightClear(maze, fc, fr, c, r)) continue;
        this.light(c, r);
      }
    }
  }

  /**
   * Light the full disc of a flare: every tile whose center lies within `radius`
   * of `(x, y)`, floor and rock alike and straight through any rock between.
   */
  lightDisc(x: number, y: number, radius: number): void {
    const reach = Math.ceil(radius / TILE) + 1;
    const cc = Maze.colAt(x);
    const cr = Maze.rowAt(y);
    const r2 = radius * radius;
    for (let r = cr - reach; r <= cr + reach; r++) {
      if (r < 0 || r >= GRID_ROWS) continue;
      for (let c = cc - reach; c <= cc + reach; c++) {
        if (c < 0 || c >= GRID_COLS) continue;
        const ox = Maze.centerX(c) - x;
        const oy = Maze.centerY(r) - y;
        if (ox * ox + oy * oy > r2) continue;
        this.light(c, r);
      }
    }
  }

  /** A tile's visibility this instant. */
  visibility(col: number, row: number): Visibility {
    if (this.isLit(col, row)) return "lit";
    return this.isRevealed(col, row) ? "remembered" : "unrevealed";
  }

  /** Visibility across the grid, one string per row, as the snapshot reports it. */
  rows(): string[] {
    const out: string[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      let line = "";
      for (let c = 0; c < GRID_COLS; c++)
        line += VISIBILITY_CHAR[this.visibility(c, r)];
      out.push(line);
    }
    return out;
  }
}
