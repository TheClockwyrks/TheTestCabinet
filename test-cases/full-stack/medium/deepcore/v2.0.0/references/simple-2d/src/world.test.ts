// What generation places, and the two guarantees it closes with
// (specs/world.md).

import { describe, expect, it } from "vitest";
import {
  CAVE_MOUTH_COL,
  CORE_COL,
  DENSITY_TOLERANCE,
  ORE_DENSITY,
  ORE_MIN_ROW,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  STANDARD_ROWS,
  WORLD_COLS,
} from "./constants";
import type { BandName, TileKind } from "./constants";
import type { Grid } from "./game";
import { Draws } from "./rng";
import {
  bandAtFraction,
  depthFraction,
  gasDensityAt,
  lavaDensityAt,
  stoneDensityAt,
} from "./tuning";
import { bandForRow, generateMine, isRouteRock } from "./world";

const CORE_ROW = STANDARD_ROWS;
const PLAYABLE_COLS = PLAYABLE_COL_MAX - PLAYABLE_COL_MIN + 1;

function mine(seed: number): ReturnType<typeof generateMine> {
  return generateMine(new Draws(seed), CORE_ROW);
}

/** Count cells of a kind in a band, against the count its share asks for. */
function share(
  grid: Grid,
  band: BandName,
  kind: TileKind,
  densityAt: (f: number) => number,
): { got: number; want: number } {
  let got = 0;
  let want = 0;
  for (let row = 1; row < CORE_ROW; row += 1) {
    const f = depthFraction(row, CORE_ROW);
    if (bandAtFraction(f) !== band) continue;
    want += densityAt(f) * PLAYABLE_COLS;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      if (grid[row][col].kind === kind) got += 1;
    }
  }
  return { got, want };
}

describe("generation", () => {
  it("walls the border columns and the Core chamber, with the Core at CORE_COL", () => {
    const { grid } = mine(1);
    for (let row = 0; row <= CORE_ROW; row += 1) {
      expect(grid[row][0].kind).toBe("bedrock");
      expect(grid[row][WORLD_COLS - 1].kind).toBe("bedrock");
    }
    expect(grid[CORE_ROW][CORE_COL].kind).toBe("core");
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      if (col === CORE_COL) continue;
      expect(grid[CORE_ROW][col].kind).toBe("bedrock");
    }
  });

  it("opens the cave mouth out of the camp", () => {
    for (const seed of [1, 2, 3]) {
      expect(mine(seed).grid[1][CAVE_MOUTH_COL].kind).toBe("tunnel");
    }
  });

  it("leaves the rows above ORE_MIN_ROW free of ore", () => {
    const { grid } = mine(4);
    for (let row = 1; row < ORE_MIN_ROW; row += 1) {
      for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
        expect(grid[row][col].kind).not.toBe("ore");
      }
    }
  });

  it("holds every share within DENSITY_TOLERANCE of the one stated", () => {
    for (const seed of [1, 11, 404]) {
      const { grid } = mine(seed);
      const checks: [BandName, TileKind, (f: number) => number][] = [
        ["rockbed", "stone", stoneDensityAt],
        ["deepstone", "stone", stoneDensityAt],
        ["coreshell", "stone", stoneDensityAt],
        ["rockbed", "gas", gasDensityAt],
        ["deepstone", "gas", gasDensityAt],
        ["coreshell", "gas", gasDensityAt],
        ["deepstone", "lava", lavaDensityAt],
        ["coreshell", "lava", lavaDensityAt],
      ];
      for (const [band, kind, densityAt] of checks) {
        const { got, want } = share(grid, band, kind, densityAt);
        expect(Math.abs(got - want) / want).toBeLessThanOrEqual(
          DENSITY_TOLERANCE,
        );
      }
      let ore = 0;
      for (let row = ORE_MIN_ROW; row < CORE_ROW; row += 1) {
        for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
          if (grid[row][col].kind === "ore") ore += 1;
        }
      }
      const wantOre = (CORE_ROW - ORE_MIN_ROW) * PLAYABLE_COLS * ORE_DENSITY;
      expect(Math.abs(ore - wantOre) / wantOre).toBeLessThanOrEqual(
        DENSITY_TOLERANCE,
      );
    }
  });

  it("puts no stone or gas in the topsoil and no lava above the deepstone", () => {
    const { grid } = mine(7);
    for (let row = 1; row < CORE_ROW; row += 1) {
      const band = bandAtFraction(depthFraction(row, CORE_ROW));
      for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
        const kind = grid[row][col].kind;
        if (band === "topsoil") {
          expect(kind === "stone" || kind === "gas").toBe(false);
        }
        if (band === "topsoil" || band === "rockbed") {
          expect(kind).not.toBe("lava");
        }
      }
    }
  });

  it("pools lava rather than scattering single cells", () => {
    const { grid } = mine(3);
    let lava = 0;
    let touching = 0;
    for (let row = 1; row < CORE_ROW; row += 1) {
      for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
        if (grid[row][col].kind !== "lava") continue;
        lava += 1;
        const neighbours = [
          grid[row][col - 1]?.kind,
          grid[row][col + 1]?.kind,
          grid[row - 1]?.[col]?.kind,
          grid[row + 1]?.[col]?.kind,
        ];
        if (neighbours.some((kind) => kind === "lava")) touching += 1;
      }
    }
    expect(lava).toBeGreaterThan(100);
    // A pool of four leaves every cell with at least one lava neighbour.
    expect(touching / lava).toBeGreaterThan(0.85);
  });

  it("places one Resonite node in the rockbed and one Cryenite in the deepstone", () => {
    for (const seed of [1, 5, 77]) {
      const m = mine(seed);
      expect(m.nodes).toHaveLength(2);
      const res = m.nodes.find((node) => node.material === "resonite");
      const cry = m.nodes.find((node) => node.material === "cryenite");
      expect(res).toBeDefined();
      expect(cry).toBeDefined();
      if (!res || !cry) return;
      expect(bandForRow(res.row, CORE_ROW)).toBe("rockbed");
      expect(bandForRow(cry.row, CORE_ROW)).toBe("deepstone");
      expect(m.grid[res.row][res.col].kind).toBe("material");
      expect(m.grid[cry.row][cry.col].kind).toBe("material");
    }
  });

  it("leaves a lava-free, stone-free route from the cave mouth to both nodes and the Core", () => {
    for (const seed of [1, 2, 42]) {
      const m = mine(seed);
      const seen = new Set<number>();
      const key = (c: number, r: number): number => r * WORLD_COLS + c;
      const stack: [number, number][] = [[CAVE_MOUTH_COL, 1]];
      seen.add(key(CAVE_MOUTH_COL, 1));
      while (stack.length > 0) {
        const [c, r] = stack.pop() as [number, number];
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nc = c + dc;
          const nr = r + dr;
          const tile = m.grid[nr]?.[nc];
          if (!tile) continue;
          if (tile.kind !== "tunnel" && !isRouteRock(tile.kind)) continue;
          if (seen.has(key(nc, nr))) continue;
          seen.add(key(nc, nr));
          stack.push([nc, nr]);
        }
      }
      for (const node of m.nodes) {
        expect(seen.has(key(node.col, node.row))).toBe(true);
      }
      expect(seen.has(key(CORE_COL, CORE_ROW))).toBe(true);
    }
  });

  it("seals no band across its width", () => {
    const { grid } = mine(9);
    for (let row = 1; row < CORE_ROW; row += 1) {
      let open = 0;
      for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
        if (isRouteRock(grid[row][col].kind)) open += 1;
      }
      expect(open).toBeGreaterThan(0);
    }
  });

  it("scales the depth with the world size and keeps the band shape", () => {
    const quick = generateMine(new Draws(1), 250);
    expect(quick.grid).toHaveLength(251);
    expect(bandForRow(1, 250)).toBe("topsoil");
    expect(bandForRow(126, 250)).toBe("deepstone");
    expect(bandForRow(249, 250)).toBe("coreshell");
  });
});
