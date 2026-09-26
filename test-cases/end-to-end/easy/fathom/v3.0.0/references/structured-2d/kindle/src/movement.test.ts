import { describe, expect, it } from "vitest";

import {
  FORAGER_SPEED,
  GRID_COLS,
  GRID_ROWS,
  TICK_DT,
  TILE,
} from "./constants";
import { anchor, stampLayout } from "./fixtures";
import type { Dir } from "./grid";
import { MAZE_LEFT, MAZE_WIDTH, tileCenterX, tileCenterY } from "./grid";
import { Maze } from "./maze";
import type { Body } from "./movement";
import { advanceBody, atTileCenter, bodyCell, restAt } from "./movement";

function swimmer(speed = FORAGER_SPEED): Body {
  return { x: 0, y: 0, heading: null, facing: "up", speed };
}

/** Runs the body for `seconds` of game time, in whole ticks. */
function run(
  body: Body,
  maze: Maze,
  seconds: number,
  wanted: () => Dir | null,
): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let tick = 0; tick < ticks; tick++) {
    advanceBody(body, TICK_DT, maze, wanted, maze.openToForager);
  }
}

describe("travelling the corridors", () => {
  it("holds one speed however far it swims", () => {
    const board = stampLayout(["S........."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    restAt(body, anchor(board, "S"));
    const from = body.x;
    run(body, maze, 1, () => "right");
    expect(body.x - from).toBeCloseTo(FORAGER_SPEED, 3);
    expect(body.heading).toBe("right");
  });

  it("comes to rest at the center when the tile ahead is rock", () => {
    const board = stampLayout(["S..."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    restAt(body, anchor(board, "S"));
    run(body, maze, 2, () => "right");
    expect(bodyCell(body)).toEqual({
      tx: anchor(board, "S").tx + 3,
      ty: anchor(board, "S").ty,
    });
    expect(atTileCenter(body)).toBe(true);
    expect(body.heading).toBeNull();
  });

  it("stands still on a tile with no open neighbor", () => {
    const board = stampLayout(["S"]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    restAt(body, anchor(board, "S"));
    const start = anchor(board, "S");
    run(body, maze, 1, () => "right");
    expect(body.x).toBeCloseTo(tileCenterX(start.tx), 6);
    expect(body.y).toBeCloseTo(tileCenterY(start.ty), 6);
  });

  it("takes a reversal wherever it stands", () => {
    const board = stampLayout(["..S.."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    restAt(body, anchor(board, "S"));
    run(body, maze, 0.05, () => "right");
    expect(atTileCenter(body)).toBe(false);
    const turned = body.x;
    advanceBody(body, TICK_DT, maze, () => "left", maze.openToForager);
    expect(body.heading).toBe("left");
    expect(body.x).toBeLessThan(turned);
  });

  it("takes a perpendicular turn at a tile center and nowhere else", () => {
    const board = stampLayout(["S..", "#..", "#.."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    const start = anchor(board, "S");
    restAt(body, start);

    // A quarter of a tile past the center of the tile beside the start, where
    // the way down is open: the request is a request, not a turn.
    run(body, maze, (TILE * 1.25) / FORAGER_SPEED, () => "right");
    expect(bodyCell(body)).toEqual({ tx: start.tx + 1, ty: start.ty });
    expect(atTileCenter(body)).toBe(false);
    advanceBody(body, TICK_DT, maze, () => "down", maze.openToForager);
    expect(body.heading).toBe("right");

    // The same request is honored at the next center it reaches.
    run(body, maze, (TILE * 1.5) / FORAGER_SPEED, () => "down");
    expect(body.heading).toBe("down");
    expect(bodyCell(body).tx).toBe(start.tx + 2);
  });

  it("runs back to its own center to take a perpendicular turn from rest", () => {
    const board = stampLayout(["S..", "#..", "#.."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    const start = anchor(board, "S");
    restAt(body, start);

    // A quarter of a tile past a center, then nothing held: it rests there,
    // between two centers, which is where the specification leaves it.
    run(body, maze, (TILE * 1.25) / FORAGER_SPEED, () => "right");
    advanceBody(body, TICK_DT, maze, () => null, maze.openToForager);
    expect(body.heading).toBeNull();
    expect(atTileCenter(body)).toBe(false);
    const turn = bodyCell(body);
    expect(turn).toEqual({ tx: start.tx + 1, ty: start.ty });

    // Down is open from that tile, but a perpendicular turn is taken at a
    // center and nowhere else, so it travels back to its own center first.
    advanceBody(body, TICK_DT, maze, () => "down", maze.openToForager);
    expect(body.heading).toBe("left");
    expect(body.y).toBeCloseTo(tileCenterY(turn.ty), 6);

    run(body, maze, TILE / FORAGER_SPEED, () => "down");
    expect(body.heading).toBe("down");
    expect(bodyCell(body).tx).toBe(turn.tx);
    expect(bodyCell(body).ty).toBeGreaterThan(turn.ty);
  });

  it("comes to rest at the center it reaches when nothing is wanted there", () => {
    const board = stampLayout(["S.."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    const start = anchor(board, "S");
    restAt(body, start);

    // Wanted for as long as it is short of the next center, and nothing wanted
    // from the moment it lands on one.
    const wanted = (): Dir | null => {
      const cell = bodyCell(body);
      return cell.tx === start.tx + 1 && atTileCenter(body) ? null : "right";
    };
    run(body, maze, (TILE * 2) / FORAGER_SPEED, wanted);

    expect(bodyCell(body)).toEqual({ tx: start.tx + 1, ty: start.ty });
    expect(atTileCenter(body)).toBe(true);
    expect(body.heading).toBeNull();
    expect(body.facing).toBe("right");
  });

  it("carries a body across the wrap tunnel as one ordinary step", () => {
    const rows = new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
    rows[7] = ".".repeat(GRID_COLS);
    const maze = new Maze(rows, { tx: 0, ty: 7 });
    const body = swimmer();
    restAt(body, { tx: GRID_COLS - 1, ty: 7 });
    const before = body.x;
    run(body, maze, TILE / FORAGER_SPEED, () => "right");
    expect(bodyCell(body)).toEqual({ tx: 0, ty: 7 });
    expect(body.x).toBeCloseTo(before + TILE - MAZE_WIDTH, 3);
    expect(body.x).toBeGreaterThanOrEqual(MAZE_LEFT);
    expect(body.x).toBeLessThanOrEqual(MAZE_LEFT + MAZE_WIDTH);
  });

  it("keeps facing the way it last travelled once it stops", () => {
    const board = stampLayout(["S."]);
    const maze = new Maze(board.rows);
    const body = swimmer();
    restAt(body, anchor(board, "S"));
    run(body, maze, 1, () => "right");
    expect(body.heading).toBeNull();
    expect(body.facing).toBe("right");
  });
});
