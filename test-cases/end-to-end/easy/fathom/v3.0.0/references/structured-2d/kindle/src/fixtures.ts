// Fathom — the fixture boards the build's own tests pose.
//
// A fixture is a small block of ASCII stamped into an otherwise solid grid, so
// a test states only the corridors it is about and nothing else. It is exactly
// the shape `setMaze` takes (`specs/instrumentation.md`), and a posed layout is
// exempt from every rule in `specs/maze.md`, so a fixture is free to be a bare
// corridor with dead ends at both ends.
//
// The art uses the maze's own alphabet, with two additions: a space reads as
// rock, and any capital letter is a corridor tile that the fixture also names,
// so a test says `anchors.get("F")` rather than counting columns.

import { GRID_COLS, GRID_ROWS } from "./constants";
import type { Cell } from "./grid";
import { inGrid } from "./grid";

export interface Fixture {
  /** The layout, in the form `setMaze` and the snapshot's `tiles` use. */
  readonly rows: string[];
  /** The tile each capital letter of the art named. */
  readonly anchors: ReadonlyMap<string, Cell>;
}

const CAPITAL = /^[A-Z]$/;

/**
 * Stamps `art` into a grid of solid rock. Without an `origin` the art is
 * centered, which keeps a fixture clear of the border on every side.
 */
export function stampLayout(art: readonly string[], origin?: Cell): Fixture {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<string>(GRID_COLS).fill("#"),
  );
  const width = art.reduce((widest, row) => Math.max(widest, row.length), 0);
  const ox = origin ? origin.tx : Math.floor((GRID_COLS - width) / 2);
  const oy = origin ? origin.ty : Math.floor((GRID_ROWS - art.length) / 2);
  const anchors = new Map<string, Cell>();

  for (let row = 0; row < art.length; row++) {
    for (let column = 0; column < art[row].length; column++) {
      const mark = art[row][column];
      const tx = ox + column;
      const ty = oy + row;
      if (!inGrid(tx, ty)) {
        throw new Error(`fixture: (${tx}, ${ty}) falls outside the grid`);
      }
      if (mark === "#" || mark === " ") continue;
      if (mark === "." || mark === "d" || mark === "g") {
        grid[ty][tx] = mark;
        continue;
      }
      if (!CAPITAL.test(mark)) {
        throw new Error(`fixture: unknown mark ${JSON.stringify(mark)}`);
      }
      grid[ty][tx] = ".";
      anchors.set(mark, { tx, ty });
    }
  }

  return { rows: grid.map((row) => row.join("")), anchors };
}

/** The tile a fixture named, which the caller has to have written into the art. */
export function anchor(fixture: Fixture, name: string): Cell {
  const cell = fixture.anchors.get(name);
  if (!cell) throw new Error(`fixture: no tile is named ${name}`);
  return cell;
}
