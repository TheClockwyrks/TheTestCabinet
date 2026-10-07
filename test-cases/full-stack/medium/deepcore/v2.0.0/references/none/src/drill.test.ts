// The drill: what it cuts, what it spends, and what a broken cell yields
// (specs/character.md, specs/mining.md).

import { describe, expect, it } from "vitest";
import {
  BAND_HEALTH,
  DRILL_DAMAGE,
  DRILL_HIT_FUEL,
  DRILL_HIT_INTERVAL,
  MINER_H,
  TILE,
} from "./constants";
import {
  emptyGame,
  hold,
  run,
  setOreTile,
  setTile,
  standOn,
} from "./test-support";

/** The rows a Standard mine's four bands start at. */
const TOPSOIL = 20;
const ROCKBED = 200;

describe("cutting down", () => {
  it("breaks a topsoil cell in ceil(BAND_HEALTH / damage) hits", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    const hits = Math.ceil(BAND_HEALTH.topsoil / DRILL_DAMAGE[0]!);
    // One extra frame's worth of interval so the final hit lands.
    run(game, hits * DRILL_HIT_INTERVAL + 0.02, hits * 8);
    expect(game.tileAt(5, TOPSOIL).kind).toBe("tunnel");
  });

  it("spends DRILL_HIT_FUEL per hit and nothing more", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    const hits = Math.ceil(BAND_HEALTH.topsoil / DRILL_DAMAGE[0]!);
    const seconds = hits * DRILL_HIT_INTERVAL + 0.02;
    run(game, seconds, hits * 8);
    const lifeSupport = 0.4 * seconds;
    expect(game.miner.fuel).toBeCloseTo(
      100 - hits * DRILL_HIT_FUEL - lifeSupport,
      4,
    );
  });

  it("takes twice as many hits in the rockbed as in the topsoil", () => {
    expect(BAND_HEALTH.rockbed / BAND_HEALTH.topsoil).toBe(2);
    const game = emptyGame();
    setTile(game, 5, ROCKBED, "rock");
    setTile(game, 5, ROCKBED + 1, "rock");
    standOn(game, 5, ROCKBED);
    game.miner.fuel = 100;
    hold(game, { down: true });
    const topsoilHits = Math.ceil(BAND_HEALTH.topsoil / DRILL_DAMAGE[0]!);
    run(game, topsoilHits * DRILL_HIT_INTERVAL + 0.02, topsoilHits * 8);
    // The rockbed cell is only half cut after the topsoil's whole span.
    expect(game.tileAt(5, ROCKBED).kind).toBe("rock");
    expect(game.tileAt(5, ROCKBED).health).toBeCloseTo(
      BAND_HEALTH.rockbed / 2,
      3,
    );
  });

  it("sinks the miner into the cell in proportion to the cut", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL + 1, "rock");
    setTile(game, 5, TOPSOIL + 2, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, DRILL_HIT_INTERVAL * 2 + 0.01, 20);
    const read = game.tileAt(5, TOPSOIL);
    const progress = 1 - read.health! / read.maxHealth!;
    expect(progress).toBeGreaterThan(0);
    const feet = game.miner.y + MINER_H;
    expect(feet).toBeCloseTo(TOPSOIL * TILE + progress * TILE, 0);
  });

  it("keeps a partly cut cell's health when the cut is abandoned", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, DRILL_HIT_INTERVAL * 2 + 0.01, 20);
    const partial = game.tileAt(5, TOPSOIL).health!;
    expect(partial).toBeLessThan(BAND_HEALTH.topsoil);
    hold(game, {});
    run(game, 0.5, 30);
    expect(game.tileAt(5, TOPSOIL).health).toBe(partial);
  });
});

describe("what a cut refuses", () => {
  it("starts no cut while the miner is not grounded", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL + 4, "rock");
    game.miner.x = 5 * TILE + 12;
    game.miner.y = TOPSOIL * TILE;
    game.miner.vy = 0;
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, 0.3, 18);
    expect(game.miner.drilling).toBeNull();
  });

  it("never breaks unbreakable stone", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL, "stone");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, 5, 300);
    expect(game.tileAt(5, TOPSOIL).kind).toBe("stone");
    expect(game.miner.drilling).toBeNull();
  });

  it("never cuts upward", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL - 2, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 500;
    hold(game, { thrust: true });
    run(game, 1, 60);
    expect(game.tileAt(5, TOPSOIL - 2).kind).toBe("rock");
  });
});

describe("the drill faculty", () => {
  it("starts no cut and spends no fuel while it is held", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    game.miner.drill = false;
    hold(game, { down: true });
    run(game, 2, 120);
    expect(game.miner.drilling).toBeNull();
    expect(game.tileAt(5, TOPSOIL + 1).kind).toBe("rock");
    expect(game.miner.fuel).toBeCloseTo(100 - 0.4 * 2, 4);
  });

  it("leaves the miner walking and falling exactly as it does with the drill running", () => {
    const game = emptyGame();
    setTile(game, 5, TOPSOIL, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.drill = false;
    game.miner.fuel = 100;
    hold(game, { right: true });
    run(game, 0.5, 30);
    expect(game.miner.x).toBeGreaterThan(5 * TILE + 12);
  });
});

describe("what a broken cell yields", () => {
  it("banks one unit of an ore cell into cargo", () => {
    const game = emptyGame();
    setOreTile(game, 5, TOPSOIL, "ferron");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, 1, 60);
    expect(game.cargo.ferron).toBe(1);
    expect(game.tileAt(5, TOPSOIL).kind).toBe("tunnel");
  });

  it("leaves the ore behind, and still clears the cell, when the bay is full", () => {
    const game = emptyGame();
    setOreTile(game, 5, TOPSOIL, "ferron");
    setTile(game, 5, TOPSOIL + 1, "rock");
    standOn(game, 5, TOPSOIL);
    game.miner.fuel = 100;
    game.cargo.marlite = game.cargoCap();
    hold(game, { down: true });
    run(game, 1, 60);
    expect(game.cargo.ferron).toBe(0);
    expect(game.tileAt(5, TOPSOIL).kind).toBe("tunnel");
  });

  it("banks a material node into the satchel and removes the node", () => {
    const game = emptyGame();
    setTile(game, 5, ROCKBED, "rock");
    setTile(game, 5, ROCKBED + 1, "rock");
    game.grid[ROCKBED]![5]!.kind = "material";
    game.grid[ROCKBED]![5]!.material = "resonite";
    standOn(game, 5, ROCKBED);
    game.miner.fuel = 100;
    hold(game, { down: true });
    run(game, 2, 120);
    expect(game.satchel.resonite).toBe(1);
    expect(game.tileAt(5, ROCKBED).kind).toBe("tunnel");
  });

  it("takes a Core Sample from the Core and leaves the Core in place", () => {
    const game = emptyGame();
    const core = game.coreRow;
    game.grid[core]![5] = { kind: "core", band: "coreshell" };
    standOn(game, 5, core);
    game.miner.fuel = 200;
    hold(game, { down: true });
    run(game, 4, 240);
    expect(game.satchel.coreSample).toBe(true);
    expect(game.coreTimer).not.toBeNull();
    expect(game.tileAt(5, core).kind).toBe("core");
  });
});
