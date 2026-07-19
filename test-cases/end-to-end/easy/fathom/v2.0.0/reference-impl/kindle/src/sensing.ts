// Fathom — the signature sensing systems: fog-of-war memory, line-of-sight
// passive light, and the tile visibility used to draw the trench and to decide
// what is currently lit (specs/sensing.md).

import { COLS, ROWS, TILE } from "./constants";
import { Maze } from "./maze";

export const tileKey = (col: number, row: number) => row * COLS + col;

export class Fog {
  // Per-trench memory: walls/floor/plankton revealed by any source stay
  // remembered for the rest of the trench.
  revealed: boolean[] = new Array(COLS * ROWS).fill(false);
  // Tiles lit *right now* by the forager's passive light (recomputed each frame).
  lit = new Set<number>();

  reset(): void {
    this.revealed.fill(false);
    this.lit.clear();
  }

  reveal(col: number, row: number): void {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    this.revealed[tileKey(col, row)] = true;
  }

  isRevealed(col: number, row: number): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    return this.revealed[tileKey(col, row)];
  }

  isLit(col: number, row: number): boolean {
    return this.lit.has(tileKey(col, row));
  }

  // Straight-line visibility between two tiles: the corner-safe supercover from
  // the forager tile to the target tile must not cross a wall before reaching
  // it. This is why light does not bend around corners.
  static losClear(maze: Maze, fc: number, fr: number, tc: number, tr: number): boolean {
    let x = fc;
    let y = fr;
    const dx = Math.abs(tc - fc);
    const dy = Math.abs(tr - fr);
    const xi = tc > fc ? 1 : -1;
    const yi = tr > fr ? 1 : -1;
    let n = dx + dy;
    let err = dx - dy;
    const dx2 = dx * 2;
    const dy2 = dy * 2;
    while (n > 0) {
      if (err > 0) {
        x += xi;
        err -= dy2;
      } else if (err < 0) {
        y += yi;
        err += dx2;
      } else {
        // Exact diagonal step through a corner: block if the corner is walled
        // on either shoulder (no peeking diagonally past a rock corner).
        if (maze.isWall(x + xi, y) && maze.isWall(x, y + yi)) return false;
        x += xi;
        y += yi;
        err -= dy2;
        err += dx2;
        n--;
      }
      n--;
      if (x === tc && y === tr) break;
      if (maze.isWall(x, y)) return false;
    }
    return true;
  }

  // Recompute the passive-lit set: every tile within vision radius V (px) of the
  // forager whose straight line of sight is clear. Lit tiles are also revealed
  // (added to memory). Returns the lit set (also stored on this.lit).
  computePassiveLit(
    maze: Maze,
    fx: number,
    fy: number,
    V: number,
  ): Set<number> {
    this.lit.clear();
    const fc = Maze.colAt(fx);
    const fr = Maze.rowAt(fy);
    const rad = Math.ceil(V / TILE) + 1;
    const V2 = V * V;
    for (let r = fr - rad; r <= fr + rad; r++) {
      if (r < 0 || r >= ROWS) continue;
      for (let c = fc - rad; c <= fc + rad; c++) {
        if (c < 0 || c >= COLS) continue;
        const cx = Maze.cx(c);
        const cy = Maze.cy(r);
        const d2 = (cx - fx) * (cx - fx) + (cy - fy) * (cy - fy);
        if (d2 > V2) continue;
        if (!Fog.losClear(maze, fc, fr, c, r)) continue;
        const k = tileKey(c, r);
        this.lit.add(k);
        this.revealed[k] = true;
      }
    }
    return this.lit;
  }
}
