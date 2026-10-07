// The scanner, and the gas seep that is a pocket's only tell
// (specs/mining.md, specs/hazards.md).

import { describe, expect, it } from "vitest";
import {
  GAS_SEEP_PERIOD,
  MINER_H,
  MINER_W,
  SCANNER_TIERS,
  TILE,
} from "./constants";
import type { MaterialId } from "./constants";
import { recenterCamera } from "./camera";
import type { DeepcoreState } from "./game";
import { computeScan } from "./scanner";
import { writeTile } from "./state";
import { bareState, holding, posing, posedAt, runFrames } from "./test-support";
import { makeMaterialTile, makeTile, colCenterX } from "./world";

/** Put a node on the grid and register it, as the mine's own generation does. */
function node(
  d: DeepcoreState,
  col: number,
  row: number,
  material: MaterialId,
): void {
  d.grid = writeTile(
    d.grid,
    col,
    row,
    makeMaterialTile(
      material === "resonite" ? "rockbed" : "deepstone",
      material,
    ),
  );
  d.nodes.push({ material, col, row, collected: false });
}

/** Stand the miner on top of a cell, centered on its column. */
function standing(d: DeepcoreState, col: number, row: number): void {
  posedAt(d, colCenterX(col, MINER_W), row * TILE - MINER_H);
}

/** Read the scanner off a state. */
function scanOf(state: DeepcoreState): ReturnType<typeof computeScan> {
  return computeScan(state.miner, state.nodes, state.satchel, state.tiers);
}

describe("the scanner", () => {
  it("locks on nothing at the first tier, which is no scanner at all", () => {
    expect(SCANNER_TIERS[0]).toBeNull();
    const state = posing(bareState(), (d) => {
      node(d, 5, 200, "resonite");
      standing(d, 5, 201);
    });
    expect(scanOf(state).locked).toBe(false);
  });

  it("locks on within the tier's range and not beyond it", () => {
    const near = posing(bareState(), (d) => {
      d.tiers.scanner = 2;
      node(d, 5, 200, "resonite");
      // Nine tiles above the node: inside the second tier's range of ten.
      standing(d, 5, 192);
    });
    const lock = scanOf(near);
    expect(lock.locked).toBe(true);
    expect(lock.target).toBe("resonite");
    expect(lock.distanceTiles).toBeCloseTo(9, 6);
    expect(lock.dirY).toBeCloseTo(1, 6);
    expect(lock.dirX).toBeCloseTo(0, 6);

    // Twenty tiles above it: outside that range, and outside the whole width of
    // the viewport, which is what makes the third tier worth buying.
    const far = posing(near, (d) => standing(d, 5, 181));
    expect(scanOf(far).locked).toBe(false);
    expect(scanOf(far).target).toBeNull();
    expect(scanOf(far).distanceTiles).toBeNull();
    const better = posing(far, (d) => {
      d.tiers.scanner = 3;
    });
    expect(scanOf(better).locked).toBe(true);
  });

  it("targets the nearer node while both materials are missing", () => {
    const state = posing(bareState(), (d) => {
      d.tiers.scanner = 3;
      node(d, 5, 200, "resonite");
      node(d, 5, 260, "cryenite");
      standing(d, 5, 240);
    });
    expect(scanOf(state).target).toBe("cryenite");
  });

  it("stops targeting a material once it is held", () => {
    const state = posing(bareState(), (d) => {
      d.tiers.scanner = 3;
      node(d, 5, 200, "resonite");
      standing(d, 5, 195);
    });
    expect(scanOf(state).target).toBe("resonite");
    const held = posing(state, (d) => {
      d.satchel.resonite = 1;
    });
    expect(scanOf(held).locked).toBe(false);
  });

  it("never targets the Core", () => {
    const state = posing(bareState(), (d) => {
      d.tiers.scanner = 3;
      standing(d, 16, d.coreRow - 1);
    });
    expect(scanOf(state).locked).toBe(false);
  });
});

describe("the gas seep", () => {
  const pockets: readonly [number, number][] = [
    [14, 199],
    [16, 201],
    [18, 203],
  ];

  it("wisps over every pocket on screen within GAS_SEEP_PERIOD", () => {
    const posed = holding(
      posing(bareState(), (d) => {
        posedAt(d, colCenterX(16, MINER_W), 200 * TILE);
        d.miner.travel = false;
        d.miner.drill = false;
        for (const [col, row] of pockets) {
          d.grid = writeTile(d.grid, col, row, makeTile("gas", "deepstone"));
        }
        recenterCamera(d);
      }),
      {},
    );
    const run = runFrames(posed, GAS_SEEP_PERIOD, 120);
    const seen = new Set<string>();
    for (const burst of run.fx) {
      if (burst.kind !== "gas-seep") continue;
      seen.add(`${Math.floor(burst.x / TILE)},${Math.floor(burst.y / TILE)}`);
    }
    for (const [col, row] of pockets) {
      expect(seen.has(`${col},${row}`)).toBe(true);
    }
  });

  it("wisps over nothing where no pocket is on screen", () => {
    const posed = holding(
      posing(bareState(), (d) => {
        d.miner.travel = false;
        d.miner.drill = false;
      }),
      {},
    );
    const run = runFrames(posed, GAS_SEEP_PERIOD * 2, 120);
    expect(run.fx.some((burst) => burst.kind === "gas-seep")).toBe(false);
  });
});
