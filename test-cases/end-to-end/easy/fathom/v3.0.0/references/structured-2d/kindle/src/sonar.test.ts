import { describe, expect, it } from "vitest";

import { SONAR_RANGE_BASE, SONAR_WAVE_SPEED, TICK_DT } from "./constants";
import { anchor, stampLayout } from "./fixtures";
import { Maze } from "./maze";
import { SonarPulse } from "./sonar";

function corridorPulse(range = SONAR_RANGE_BASE): {
  maze: Maze;
  pulse: SonarPulse;
  origin: { tx: number; ty: number };
} {
  const board = stampLayout(["O............."]);
  const maze = new Maze(board.rows);
  const origin = anchor(board, "O");
  return {
    maze,
    origin,
    pulse: new SonarPulse(maze, origin, range, "forager", "cyan"),
  };
}

describe("a sonar wavefront", () => {
  it("opens standing on its origin", () => {
    const { pulse, origin } = corridorPulse();
    expect(pulse.front).toBe(0);
    expect(pulse.origin).toEqual(origin);
    expect(pulse.reached(origin.tx, origin.ty)).toBe(true);
    expect(pulse.reached(origin.tx + 1, origin.ty)).toBe(false);
    expect(pulse.spent).toBe(false);
  });

  it("advances its front at the wavefront speed", () => {
    const { pulse } = corridorPulse();
    for (let tick = 0; tick < 60; tick++) pulse.advance(TICK_DT);
    expect(pulse.front).toBeCloseTo(SONAR_WAVE_SPEED * 0.5, 6);
  });

  it("surfaces the tiles it crosses, nearest first and once each", () => {
    const { pulse, origin } = corridorPulse();
    const order: number[] = [];
    for (let tick = 0; tick < 240; tick++) {
      for (const bucket of pulse.advance(TICK_DT)) {
        for (const cell of bucket) order.push(cell.tx - origin.tx);
      }
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    // The origin is reached the instant the pulse is cast, and each tile
    // beyond it surfaces exactly once as the front arrives.
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(1);
  });

  it("carries its declared range whatever the flood reaches", () => {
    const board = stampLayout(["O.."]);
    const maze = new Maze(board.rows);
    const pulse = new SonarPulse(
      maze,
      anchor(board, "O"),
      SONAR_RANGE_BASE,
      "forager",
      "cyan",
    );
    expect(pulse.range).toBe(SONAR_RANGE_BASE);
    let crossed = 0;
    for (let tick = 0; tick < 240; tick++) {
      for (const bucket of pulse.advance(TICK_DT)) crossed += bucket.length;
    }
    // The corridor holds three tiles and the flood stops at the rock around
    // them, well short of the nine steps the pulse declares.
    expect(crossed).toBe(3);
  });

  it("is spent once its front passes its range", () => {
    const { pulse } = corridorPulse(4);
    while (!pulse.spent) pulse.advance(TICK_DT);
    expect(pulse.front).toBeGreaterThan(4);
  });

  it("bends around a corner and stops at rock", () => {
    const board = stampLayout(["O#", ".#", "..", "#T"]);
    const maze = new Maze(board.rows);
    const origin = anchor(board, "O");
    const target = anchor(board, "T");
    const pulse = new SonarPulse(maze, origin, 9, "forager", "cyan");
    expect(pulse.stepsTo(target.tx, target.ty)).toBe(4);
    expect(pulse.stepsTo(origin.tx + 1, origin.ty)).toBeNull();
  });

  it("reads a straight run as one travel direction", () => {
    const { pulse, origin } = corridorPulse();
    expect(pulse.headingAt(origin.tx, origin.ty)).toEqual({ x: 0, y: 0 });
    expect(pulse.headingAt(origin.tx + 2, origin.ty)).toEqual({ x: 1, y: 0 });
  });

  it("carries the source and tint it was cast with", () => {
    const board = stampLayout(["O...."]);
    const maze = new Maze(board.rows);
    const ping = new SonarPulse(
      maze,
      anchor(board, "O"),
      9,
      "gloamfin",
      "orange",
    );
    expect(ping.source).toBe("gloamfin");
    expect(ping.tint).toBe("orange");
    expect(ping.caughtForager).toBe(false);
  });
});
