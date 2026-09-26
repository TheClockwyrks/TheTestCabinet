// Fathom — the fog of war and the forager's light (`specs/sensing.md`).
//
// Every tile is unrevealed, remembered, or lit. What has ever been revealed is
// remembered for the rest of the maze; what is lit is recomputed from scratch
// every step, because it is whatever a source holds this instant. Both are held
// as flat, row-major arrays over the grid, one entry per tile, and this module is
// the arithmetic over them: it takes an array and returns the next one.
//
// The two radii the forager carries are derived here as well, both from the same
// brightness: the light radius `V`, which reveals, and the vision circle `R`,
// which reveals nothing and is read by the renderer alone.

import {
  GRID_COLS,
  GRID_ROWS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import {
  GRID_CELLS,
  centerX,
  centerY,
  columnAt,
  rowAt,
  tileIndex,
} from "./grid";
import { isRock } from "./maze";
import type { DrifterState, MazeState } from "./state";

/** An array with an entry per tile, all `false`. */
export function emptyGrid(): boolean[] {
  return new Array<boolean>(GRID_CELLS).fill(false);
}

/**
 * Whether the straight line between the centers of two tiles crosses rock.
 *
 * The light travels straight and stops at the rock it lands on, so the target
 * tile itself is not counted: a rock tile the line reaches is lit and drawn as
 * rock, and the tiles behind it are left as they were (`specs/sensing.md`).
 */
export function lineOfSightClear(
  maze: MazeState,
  fromTx: number,
  fromTy: number,
  toTx: number,
  toTy: number,
): boolean {
  let x = fromTx;
  let y = fromTy;
  const dx = Math.abs(toTx - fromTx);
  const dy = Math.abs(toTy - fromTy);
  const stepX = toTx > fromTx ? 1 : -1;
  const stepY = toTy > fromTy ? 1 : -1;
  let remaining = dx + dy;
  let error = dx - dy;
  const dx2 = dx * 2;
  const dy2 = dy * 2;
  while (remaining > 0) {
    if (error > 0) {
      x += stepX;
      error -= dy2;
    } else if (error < 0) {
      y += stepY;
      error += dx2;
    } else {
      // An exact diagonal through a corner: blocked when both shoulders are rock,
      // so nothing peeks diagonally past a rock corner.
      if (isRock(maze, x + stepX, y) && isRock(maze, x, y + stepY))
        return false;
      x += stepX;
      y += stepY;
      error -= dy2;
      error += dx2;
      remaining--;
    }
    remaining--;
    if (x === toTx && y === toTy) break;
    if (isRock(maze, x, y)) return false;
  }
  return true;
}

/**
 * Whether a drifter's body is drawn this instant (`specs/state.md`): true where
 * the fog holds the tile it stands on lit, by the forager's own light or by a
 * flare's disc.
 *
 * Its amber mote is drawn under the amber-light rule and is a different
 * question, so a drifter glimmering in the dark is one whose body is not drawn.
 */
export function drifterLit(
  lit: readonly boolean[],
  drifter: DrifterState,
): boolean {
  return lit[tileIndex(columnAt(drifter.x), rowAt(drifter.y))];
}

/** What one recomputation of the fog leaves behind. */
export interface FogUpdate {
  readonly revealed: readonly boolean[];
  readonly lit: readonly boolean[];
}

/**
 * The fog after the forager's light has been cast from `(x, y)` out to `radius`.
 *
 * A tile is lit when its center lies within `radius` of the forager's center and
 * the line joining those centers crosses no rock other than that tile itself.
 * Everything lit is revealed as well, and stays revealed.
 */
export function castLight(
  maze: MazeState,
  revealed: readonly boolean[],
  x: number,
  y: number,
  radius: number,
): FogUpdate {
  const lit = emptyGrid();
  const nextRevealed = [...revealed];
  const fromTx = columnAt(x);
  const fromTy = rowAt(y);
  const reach = Math.ceil(radius / TILE) + 1;
  const radiusSquared = radius * radius;
  for (let ty = fromTy - reach; ty <= fromTy + reach; ty++) {
    if (ty < 0 || ty >= GRID_ROWS) continue;
    for (let tx = fromTx - reach; tx <= fromTx + reach; tx++) {
      if (tx < 0 || tx >= GRID_COLS) continue;
      const ex = centerX(tx) - x;
      const ey = centerY(ty) - y;
      if (ex * ex + ey * ey > radiusSquared) continue;
      if (!lineOfSightClear(maze, fromTx, fromTy, tx, ty)) continue;
      const index = tileIndex(tx, ty);
      lit[index] = true;
      nextRevealed[index] = true;
    }
  }
  return { revealed: nextRevealed, lit };
}

/**
 * The fog with the full disc of radius `radius` around `(x, y)` lit and
 * remembered, rock and floor alike and straight through rock, which is what a
 * Flarefish's bloom does (`specs/sensing.md`).
 *
 * `revealed` and `lit` are written into rather than copied, because this runs
 * over arrays a step has already made its own.
 */
export function lightDisc(
  revealed: boolean[],
  lit: boolean[],
  x: number,
  y: number,
  radius: number,
): void {
  const fromTx = columnAt(x);
  const fromTy = rowAt(y);
  const reach = Math.ceil(radius / TILE) + 1;
  const radiusSquared = radius * radius;
  for (let ty = fromTy - reach; ty <= fromTy + reach; ty++) {
    if (ty < 0 || ty >= GRID_ROWS) continue;
    for (let tx = fromTx - reach; tx <= fromTx + reach; tx++) {
      if (tx < 0 || tx >= GRID_COLS) continue;
      const ex = centerX(tx) - x;
      const ey = centerY(ty) - y;
      if (ex * ex + ey * ey > radiusSquared) continue;
      const index = tileIndex(tx, ty);
      lit[index] = true;
      revealed[index] = true;
    }
  }
}

/**
 * The visibility the snapshot reports: one string per row, `'u'` unrevealed,
 * `'r'` remembered, `'l'` lit (`specs/state.md`).
 */
export function visibilityRows(
  revealed: readonly boolean[],
  lit: readonly boolean[],
): string[] {
  const rows: string[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    let row = "";
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const index = tileIndex(tx, ty);
      row += lit[index] ? "l" : revealed[index] ? "r" : "u";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The radius `V` of the forager's light pocket at brightness `g`
 * (`specs/sensing.md`): `96` at `G = 0` and `160` at `G = 1`.
 *
 * `V` is derived from `G` rather than held beside it, so nothing can report a
 * radius the brightness does not give.
 */
export function visionRadius(g: number): number {
  return VISION_MIN + VISION_GAIN * g;
}

/**
 * The radius `R` of the outer vision circle at brightness `g`
 * (`specs/sensing.md`): `192` at `G = 0` and `320` at `G = 1`.
 *
 * The circle is a rendering mask alone. Nothing in this module reads it, because
 * it reveals no tile and remembers no tile: it only decides how much of what the
 * fog above has already revealed the renderer draws. It is derived from `G` by
 * the same rule `V` is, and it is larger than `V` at every brightness.
 */
export function windowRadius(g: number): number {
  return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * g;
}
