import { describe, expect, it } from "vitest";

import { board } from "./board.test-support";
import { SONAR_WAVE_SPEED, TICK_DT } from "./constants";
import { Maze } from "./maze";
import { SonarWave } from "./sonar";
import type { PulseSpec } from "./sonar";

function posed(rows: readonly string[], top = 0, left = 0): Maze {
  const maze = new Maze();
  maze.load(board(rows, top, left));
  return maze;
}

const foragerPulse = (
  origin: { col: number; row: number },
  range: number,
): PulseSpec => ({
  source: "forager",
  tint: "cyan",
  origin,
  range,
  reveals: true,
  emitter: null,
});

describe("a sonar wavefront", () => {
  it("carries what cast it and how far it reaches", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    expect(wave.source).toBe("forager");
    expect(wave.tint).toBe("cyan");
    expect(wave.origin).toEqual({ col: 4, row: 5 });
    expect(wave.range).toBe(9);
    expect(wave.front).toBe(0);
  });

  it("advances its front at the wavefront speed", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    for (let i = 0; i < 120; i++) wave.advance(TICK_DT);
    expect(wave.front).toBeCloseTo(SONAR_WAVE_SPEED, 6);
  });

  it("surfaces near tiles before far ones", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    const order: number[] = [];
    for (let i = 0; i < 120; i++) {
      for (const bucket of wave.advance(TICK_DT)) {
        order.push(wave.distanceTo(bucket[0].col, bucket[0].row) as number);
      }
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The origin tile is reached the instant the pulse is cast.
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(1);
  });

  it("reports a tile reached only once the front has passed it", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    expect(wave.reached(8, 5)).toBe(false);
    // Four corridor steps out at 14 steps a second is a little under 0.29 s.
    for (let i = 0; i < Math.ceil(4 / SONAR_WAVE_SPEED / TICK_DT); i++) {
      wave.advance(TICK_DT);
    }
    expect(wave.reached(8, 5)).toBe(true);
  });

  it("never reaches a tile the corridors seal off", () => {
    const maze = posed(["....#...."], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    for (let i = 0; i < 240; i++) wave.advance(TICK_DT);
    expect(wave.distanceTo(9, 5)).toBeNull();
    expect(wave.reached(9, 5)).toBe(false);
  });

  it("follows the corridors around a bend", () => {
    const maze = posed(["....", "###.", "###."], 4, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 4 }, 9));
    expect(wave.distanceTo(7, 6)).toBe(5);
  });

  it("leaves the list once its front passes its range", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 5));
    expect(wave.done).toBe(false);
    for (let i = 0; i < 120; i++) wave.advance(TICK_DT);
    expect(wave.front).toBeGreaterThan(5);
    expect(wave.done).toBe(true);
  });

  it("ends even where the flood ran out well short of its range", () => {
    const maze = posed(["..."], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    for (let i = 0; i < 120; i++) wave.advance(TICK_DT);
    expect(wave.done).toBe(true);
  });

  it("carries a travel direction the crest is drawn along", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    expect(wave.travelThrough(4, 5)).toEqual({ x: 0, y: 0 });
    expect(wave.travelThrough(6, 5)).toEqual({ x: 1, y: 0 });
    expect(wave.travelThrough(20, 5)).toBeNull();
  });

  it("interpolates its front between the two ends of a step", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const wave = new SonarWave(maze, foragerPulse({ col: 4, row: 5 }, 9));
    wave.advance(TICK_DT);
    expect(wave.viewFront(0)).toBeCloseTo(0, 9);
    expect(wave.viewFront(1)).toBeCloseTo(wave.front, 9);
    wave.syncView();
    expect(wave.viewFront(0)).toBeCloseTo(wave.front, 9);
  });

  it("is cast in the tint the Gloamfin's lost-you ping is drawn in", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const wave = new SonarWave(maze, {
      source: "gloamfin",
      tint: "orange",
      origin: { col: 6, row: 5 },
      range: 9,
      reveals: false,
      emitter: 1,
    });
    expect(wave.source).toBe("gloamfin");
    expect(wave.tint).toBe("orange");
    expect(wave.reveals).toBe(false);
    expect(wave.emitter).toBe(1);
  });
});
