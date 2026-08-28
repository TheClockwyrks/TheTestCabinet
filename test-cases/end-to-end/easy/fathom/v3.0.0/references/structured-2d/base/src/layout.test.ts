import { describe, expect, it } from "vitest";

import {
  GRID_COLS,
  GRID_ROWS,
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
} from "./constants";
import { stampLayout } from "./fixtures";
import { DEN_SLOTS, TRENCH, TRENCH_START } from "./layout";
import { Maze } from "./maze";
import {
  corridorsConnected,
  deadEnds,
  density,
  denEnclosed,
  denReachesStart,
  faultsOf,
  meanCorridorRun,
  openSquares,
  openness,
  symmetryMismatches,
} from "./maze-rules";

const trench = new Maze(TRENCH, TRENCH_START);

describe("the trench this build lays out", () => {
  it("is the size the grid fixes", () => {
    expect(TRENCH).toHaveLength(GRID_ROWS);
    for (const row of TRENCH) expect(row).toHaveLength(GRID_COLS);
  });

  it("breaks no rule of the maze specification", () => {
    expect(faultsOf(trench)).toEqual([]);
  });

  it("runs its corridors one tile wide", () => {
    expect(openSquares(trench)).toEqual([]);
  });

  it("mirrors about the axis between columns 17 and 18", () => {
    expect(symmetryMismatches(trench)).toEqual([]);
  });

  it("leaves no dead end and one connected region", () => {
    expect(deadEnds(trench)).toEqual([]);
    expect(corridorsConnected(trench)).toBe(true);
  });

  it("encloses a den the forager's start tile is reachable from", () => {
    expect(trench.denTiles.length).toBeGreaterThan(0);
    expect(denEnclosed(trench)).toBe(true);
    expect(denReachesStart(trench)).toBe(true);
  });

  it("pierces exactly one row with the wrap tunnel", () => {
    expect(trench.wrapRow).toBeGreaterThanOrEqual(0);
    let pierced = 0;
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      if (trench.isCorridor(0, ty) && trench.isCorridor(GRID_COLS - 1, ty)) {
        pierced += 1;
      }
    }
    expect(pierced).toBe(1);
  });

  it("holds the three proportions inside their bounds", () => {
    expect(openness(trench)).toBeGreaterThanOrEqual(MAZE_OPENNESS_MIN);
    expect(openness(trench)).toBeLessThanOrEqual(MAZE_OPENNESS_MAX);
    expect(meanCorridorRun(trench)).toBeGreaterThanOrEqual(MAZE_MAZING_MIN);
    expect(meanCorridorRun(trench)).toBeLessThanOrEqual(MAZE_MAZING_MAX);
    expect(density(trench)).toBeGreaterThanOrEqual(MAZE_DENSITY_MIN);
    expect(density(trench)).toBeLessThanOrEqual(MAZE_DENSITY_MAX);
  });

  it("starts the forager on a corridor tile in the lower half", () => {
    expect(trench.isCorridor(TRENCH_START.tx, TRENCH_START.ty)).toBe(true);
    expect(TRENCH_START.ty).toBeGreaterThanOrEqual(9);
    expect(TRENCH_START.ty).toBeLessThanOrEqual(16);
  });

  it("parks its predators on den tiles of its own chamber", () => {
    const inChamber = DEN_SLOTS.filter((cell) =>
      trench.isDen(cell.tx, cell.ty),
    );
    expect(inChamber).toHaveLength(DEN_SLOTS.length);
  });
});

describe("the measures a layout is held to", () => {
  it("names a corridor wider than one tile", () => {
    const broken = [...TRENCH];
    broken[1] = `#.${".".repeat(GRID_COLS - 3)}#`;
    broken[2] = `#.${".".repeat(GRID_COLS - 3)}#`;
    expect(faultsOf(new Maze(broken, TRENCH_START)).join(" | ")).toContain(
      "2x2",
    );
  });

  it("names the rules a bare fixture breaks", () => {
    const bare = new Maze(stampLayout(["...."]).rows);
    const faults = faultsOf(bare).join(" | ");
    expect(faults).toContain("dead ends");
    expect(faults).toContain("wrap tunnel");
    expect(faults).toContain("no den");
    expect(faults).toContain("no den gate");
  });

  it("names a breached border and an asymmetric layout", () => {
    const broken = [...TRENCH];
    broken[0] = `.${broken[0].slice(1)}`;
    broken[5] = `#.###${broken[5].slice(5)}`;
    const faults = faultsOf(new Maze(broken, TRENCH_START)).join(" | ");
    expect(faults).toContain("border tiles are not rock");
    expect(faults).toContain("mirrored pairs disagree");
  });

  it("names a pierced row that carries the den", () => {
    const rows = new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
    rows[7] = `.${"#".repeat(15)}g${"#".repeat(GRID_COLS - 18)}.`;
    rows[8] = `#${"#".repeat(15)}d${"#".repeat(GRID_COLS - 18)}#`;
    const faults = faultsOf(new Maze(rows, { tx: 0, ty: 7 })).join(" | ");
    expect(faults).toContain("the pierced row carries the den");
  });
});
