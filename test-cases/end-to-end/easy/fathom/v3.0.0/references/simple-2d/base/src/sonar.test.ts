import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
  GRID_ROWS,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  SONAR_WAVE_SPEED,
  TICK_DT,
} from "./constants";
import { loadLayout } from "./maze";
import {
  advancePulse,
  castPulse,
  pulseReached,
  pulseSpent,
  sonarRange,
} from "./sonar";
import type { MazeState, PulseState, Tile } from "./state";

function board(
  art: readonly string[],
  x: number,
  y: number,
  start?: Tile,
): MazeState {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    "#".repeat(GRID_COLS).split(""),
  );
  art.forEach((line, i) => {
    line.split("").forEach((ch, j) => {
      grid[y + i][x + j] = ch;
    });
  });
  return loadLayout(
    grid.map((row) => row.join("")),
    start,
  );
}

function run(
  pulse: PulseState,
  seconds: number,
): { pulse: PulseState; crossed: Tile[] } {
  let current = pulse;
  const crossed: Tile[] = [];
  for (let t = 0; t < seconds; t += TICK_DT) {
    const step = advancePulse(current, TICK_DT);
    current = step.pulse;
    crossed.push(...step.crossed);
  }
  return { pulse: current, crossed };
}

describe("the pulse's path range", () => {
  it("shrinks one tile per depth down to its floor", () => {
    expect(sonarRange(1)).toBe(SONAR_RANGE_BASE);
    expect(sonarRange(2)).toBe(SONAR_RANGE_BASE - 1);
    expect(sonarRange(4)).toBe(SONAR_RANGE_BASE - 3);
    expect(sonarRange(9)).toBe(SONAR_RANGE_MIN);
    expect(sonarRange(40)).toBe(SONAR_RANGE_MIN);
  });
});

describe("the wavefront", () => {
  it("stands SONAR_WAVE_SPEED * t steps out t seconds after the pulse", () => {
    const maze = board([".".repeat(12)], 4, 4);
    const pulse = castPulse(maze, 4, 4, 9, "forager", "cyan", null);
    const after = run(pulse, 0.5).pulse;
    expect(after.front).toBeCloseTo(SONAR_WAVE_SPEED * 0.5, 3);
  });

  it("hands over each tile exactly once, near tiles before far ones", () => {
    const maze = board([".".repeat(12)], 4, 4);
    const pulse = castPulse(maze, 4, 4, 6, "forager", "cyan", null);
    const { crossed } = run(pulse, 1);
    expect(crossed).toEqual([
      { tx: 5, ty: 4 },
      { tx: 6, ty: 4 },
      { tx: 7, ty: 4 },
      { tx: 8, ty: 4 },
      { tx: 9, ty: 4 },
      { tx: 10, ty: 4 },
    ]);
  });

  it("floods along the corridors and enters nothing rock seals off", () => {
    const maze = board(["..#", "#.#", "#.."], 4, 4);
    const pulse = castPulse(maze, 4, 4, 9, "forager", "cyan", null);
    const { crossed } = run(pulse, 1);
    expect(crossed).toContainEqual({ tx: 6, ty: 6 });
    expect(crossed).not.toContainEqual({ tx: 6, ty: 4 });
  });

  it("reports a tile reached once its front has passed it", () => {
    const maze = board([".".repeat(12)], 4, 4);
    let pulse = castPulse(maze, 4, 4, 9, "forager", "cyan", null);
    expect(pulseReached(pulse, 8, 4)).toBe(false);
    pulse = run(pulse, 0.4).pulse;
    expect(pulseReached(pulse, 8, 4)).toBe(true);
    expect(pulseReached(pulse, 20, 4)).toBe(false);
  });

  it("leaves the board once its front has passed its range", () => {
    const maze = board([".".repeat(12)], 4, 4);
    let pulse = castPulse(maze, 4, 4, 5, "forager", "cyan", null);
    pulse = run(pulse, 4.5 / SONAR_WAVE_SPEED).pulse;
    expect(pulseSpent(pulse)).toBe(false);
    pulse = run(pulse, 0.2).pulse;
    expect(pulseSpent(pulse)).toBe(true);
  });

  it("carries the tint and the source it was cast with", () => {
    const maze = board([".".repeat(12)], 4, 4);
    const ping = castPulse(maze, 6, 4, 9, "gloamfin", "orange", 2);
    expect(ping.source).toBe("gloamfin");
    expect(ping.tint).toBe("orange");
    expect(ping.emitter).toBe(2);
    expect(ping.ox).toBe(6);
    expect(ping.oy).toBe(4);
    expect(GRID_COLS).toBe(36);
  });
});
