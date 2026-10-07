// The scanner, and the gas seep that is a pocket's only tell (specs/mining.md,
// specs/hazards.md).

import { describe, expect, it } from "vitest";
import { GAS_SEEP_PERIOD, MINER_W, SCANNER_RANGE, TILE } from "./constants";
import { computeScan } from "./scanner";
import { emptyGame, hold, run, setTile, standOn } from "./test-support";
import { colCenterX } from "./world";

/** Put a node on the grid and register it, as the mine's own generation does. */
function node(
  game: ReturnType<typeof emptyGame>,
  col: number,
  row: number,
  material: "resonite" | "cryenite",
): void {
  setTile(game, col, row, "rock");
  game.grid[row]![col]!.kind = "material";
  game.grid[row]![col]!.material = material;
  game.nodes.push({ material, col, row, collected: false });
}

describe("the scanner", () => {
  it("locks on nothing at tier 1, which is no scanner at all", () => {
    const game = emptyGame();
    node(game, 5, 200, "resonite");
    standOn(game, 5, 201);
    expect(SCANNER_RANGE[0]).toBe(0);
    expect(computeScan(game).locked).toBe(false);
  });

  it("locks on within the tier's range and not beyond it", () => {
    const game = emptyGame();
    game.tiers.scanner = 2;
    node(game, 5, 200, "resonite");
    // Nine tiles above the node: inside the tier-2 range of ten.
    standOn(game, 5, 192);
    const near = computeScan(game);
    expect(near.locked).toBe(true);
    expect(near.target).toBe("resonite");
    expect(near.distanceTiles).toBeCloseTo(9, 6);
    expect(near.dirY).toBeCloseTo(1, 6);
    expect(near.dirX).toBeCloseTo(0, 6);

    // Twenty tiles above it: outside that range, and outside the whole width of the
    // viewport, which is what makes the third tier worth buying.
    standOn(game, 5, 181);
    const far = computeScan(game);
    expect(far.locked).toBe(false);
    expect(far.target).toBeNull();
    expect(far.distanceTiles).toBeNull();
    game.tiers.scanner = 3;
    expect(computeScan(game).locked).toBe(true);
  });

  it("targets the nearer node while both materials are missing", () => {
    const game = emptyGame();
    game.tiers.scanner = 3;
    node(game, 5, 200, "resonite");
    node(game, 5, 260, "cryenite");
    standOn(game, 5, 240);
    expect(computeScan(game).target).toBe("cryenite");
  });

  it("stops targeting a material once it is held", () => {
    const game = emptyGame();
    game.tiers.scanner = 3;
    node(game, 5, 200, "resonite");
    standOn(game, 5, 195);
    expect(computeScan(game).target).toBe("resonite");
    game.satchel.resonite = 1;
    expect(computeScan(game).locked).toBe(false);
  });

  it("never targets the Core", () => {
    const game = emptyGame();
    game.tiers.scanner = 3;
    standOn(game, 16, game.coreRow - 1);
    expect(computeScan(game).locked).toBe(false);
  });
});

describe("the gas seep", () => {
  it("wisps over every pocket on screen within GAS_SEEP_PERIOD", () => {
    const game = emptyGame();
    game.miner.x = colCenterX(16, MINER_W);
    game.miner.y = 200 * TILE;
    game.miner.travel = false;
    game.miner.drill = false;
    game.recenterCamera();
    const pockets: [number, number][] = [
      [14, 199],
      [16, 201],
      [18, 203],
    ];
    for (const [col, row] of pockets) setTile(game, col, row, "gas");
    game.fxQueue.length = 0;
    hold(game, {});
    run(game, GAS_SEEP_PERIOD, 120);
    const seen = new Set<string>();
    for (const fx of game.fxQueue) {
      if (fx.kind !== "gas-seep") continue;
      seen.add(`${Math.floor(fx.x / TILE)},${Math.floor(fx.y / TILE)}`);
    }
    for (const [col, row] of pockets)
      expect(seen.has(`${col},${row}`)).toBe(true);
  });

  it("wisps over nothing where no pocket is on screen", () => {
    const game = emptyGame();
    game.miner.travel = false;
    game.miner.drill = false;
    game.fxQueue.length = 0;
    hold(game, {});
    run(game, GAS_SEEP_PERIOD * 2, 120);
    expect(game.fxQueue.some((fx) => fx.kind === "gas-seep")).toBe(false);
  });
});
