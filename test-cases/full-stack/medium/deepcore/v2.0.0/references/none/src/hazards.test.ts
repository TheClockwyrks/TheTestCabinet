// Gas, lava, impact, and the unstable Core Sample (specs/hazards.md).

import { describe, expect, it } from "vitest";
import {
  CORE_BLAST_TILES,
  CORE_TIMER,
  GAS_BLAST_TILES,
  GAS_DAMAGE_MAX,
  GAS_DAMAGE_MIN,
  GAS_KNOCKBACK,
  IMPACT_DAMAGE_RATE,
  IMPACT_SAFE_SPEED,
  LAVA_CONTACT_DPS,
  LAVA_DRILL_CORESHELL,
  LAVA_DRILL_DEEPSTONE,
  MINER_H,
  MINER_W,
  NOTICE_DELAY,
  NOTICE_FADE,
  RADIATOR_EFFECTIVENESS,
  TILE,
  gasDamageAt,
} from "./constants";
import { detonateBlast, detonateGas, landImpact } from "./hazards";
import {
  emptyGame,
  hold,
  placeAt,
  run,
  setTile,
  standOn,
} from "./test-support";

const DEEPSTONE = 300;
const CORESHELL = 450;

describe("gas", () => {
  it("deals GAS_DAMAGE_MIN where gas first appears and GAS_DAMAGE_MAX at the deepest row", () => {
    expect(gasDamageAt(0.25)).toBeCloseTo(GAS_DAMAGE_MIN, 6);
    expect(gasDamageAt(1)).toBeCloseTo(GAS_DAMAGE_MAX, 6);
    expect(gasDamageAt(0.625)).toBeCloseTo(
      (GAS_DAMAGE_MIN + GAS_DAMAGE_MAX) / 2,
      6,
    );
  });

  it("hits a miner inside GAS_BLAST_TILES and clears the cell", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    setTile(game, 6, 250, "gas");
    // Centre the miner one tile from the pocket's centre.
    placeAt(
      game,
      6 * TILE + (TILE - MINER_W) / 2,
      250 * TILE - TILE / 2 - MINER_H / 2,
    );
    const before = game.miner.hull;
    detonateGas(game, 6, 250);
    expect(game.tileAt(6, 250).kind).toBe("tunnel");
    expect(before - game.miner.hull).toBeCloseTo(gasDamageAt(249 / 499), 4);
  });

  it("leaves a miner beyond GAS_BLAST_TILES untouched", () => {
    const game = emptyGame();
    setTile(game, 6, 250, "gas");
    placeAt(game, 6 * TILE, 250 * TILE - (GAS_BLAST_TILES + 1) * TILE);
    const before = game.miner.hull;
    detonateGas(game, 6, 250);
    expect(game.miner.hull).toBe(before);
    expect(game.miner.vx).toBe(0);
    expect(game.miner.vy).toBe(0);
  });

  it("shoves the miner directly away at GAS_KNOCKBACK", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    setTile(game, 6, 250, "gas");
    // Directly above the pocket, half a tile clear of it.
    placeAt(
      game,
      6 * TILE + (TILE - MINER_W) / 2,
      250 * TILE - TILE / 2 - MINER_H / 2 - TILE / 2,
    );
    detonateGas(game, 6, 250);
    expect(Math.hypot(game.miner.vx, game.miner.vy)).toBeCloseTo(
      GAS_KNOCKBACK,
      3,
    );
    expect(game.miner.vy).toBeLessThan(0);
  });

  it("is reduced by nothing, radiator included", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.tiers.radiator = 5;
    game.miner.hull = game.maxHull();
    setTile(game, 6, 250, "gas");
    placeAt(
      game,
      6 * TILE + (TILE - MINER_W) / 2,
      250 * TILE - TILE / 2 - MINER_H / 2,
    );
    const before = game.miner.hull;
    detonateGas(game, 6, 250);
    expect(before - game.miner.hull).toBeCloseTo(gasDamageAt(249 / 499), 4);
  });
});

describe("lava", () => {
  it("drains LAVA_CONTACT_DPS per second on contact", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    setTile(game, 5, DEEPSTONE, "lava");
    standOn(game, 5, DEEPSTONE);
    game.miner.travel = false;
    game.miner.drill = false;
    // Sink the box a little into the pool so it overlaps.
    game.miner.y = DEEPSTONE * TILE - MINER_H + 4;
    const before = game.miner.hull;
    hold(game, {});
    run(game, 1, 60);
    expect(before - game.miner.hull).toBeCloseTo(LAVA_CONTACT_DPS, 4);
  });

  it("cuts the contact drain by the radiator's effectiveness", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.tiers.radiator = 3;
    game.miner.hull = game.maxHull();
    setTile(game, 5, DEEPSTONE, "lava");
    standOn(game, 5, DEEPSTONE);
    game.miner.travel = false;
    game.miner.drill = false;
    game.miner.y = DEEPSTONE * TILE - MINER_H + 4;
    const before = game.miner.hull;
    hold(game, {});
    run(game, 1, 60);
    expect(before - game.miner.hull).toBeCloseTo(
      LAVA_CONTACT_DPS * (1 - RADIATOR_EFFECTIVENESS[2]!),
      4,
    );
  });

  it("burns the band's lump once when a lava cell is drilled through", () => {
    for (const [row, lump] of [
      [DEEPSTONE, LAVA_DRILL_DEEPSTONE],
      [CORESHELL, LAVA_DRILL_CORESHELL],
    ] as const) {
      const game = emptyGame();
      game.tiers.hull = 5;
      game.tiers.drill = 5;
      game.miner.hull = game.maxHull();
      setTile(game, 5, row, "lava");
      setTile(game, 5, row + 1, "rock");
      standOn(game, 5, row);
      game.miner.fuel = 200;
      const before = game.miner.hull;
      hold(game, { down: true });
      run(game, 1, 60);
      expect(game.tileAt(5, row).kind).toBe("tunnel");
      // The cell being cut is not charged the contact drain as well, so the lump is
      // the whole of the burn.
      expect(before - game.miner.hull).toBeCloseTo(lump, 4);
    }
  });
});

describe("fall impact", () => {
  it("costs nothing at or below IMPACT_SAFE_SPEED", () => {
    const game = emptyGame();
    const before = game.miner.hull;
    landImpact(game, IMPACT_SAFE_SPEED);
    expect(game.miner.hull).toBe(before);
  });

  it("costs IMPACT_DAMAGE_RATE per unit above it", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    const before = game.miner.hull;
    landImpact(game, IMPACT_SAFE_SPEED + 300);
    expect(before - game.miner.hull).toBeCloseTo(300 * IMPACT_DAMAGE_RATE, 6);
  });
});

describe("explosives", () => {
  it("clears the 3x3 block and destroys the ore in it", () => {
    const game = emptyGame();
    for (let r = 199; r <= 201; r++) {
      for (let c = 4; c <= 6; c++) setTile(game, c, r, "rock");
    }
    setTile(game, 4, 199, "stone");
    detonateBlast(game, 5, 200, 1);
    for (let r = 199; r <= 201; r++) {
      for (let c = 4; c <= 6; c++)
        expect(game.tileAt(c, r).kind).toBe("tunnel");
    }
    expect(game.cargo.ferron).toBe(0);
  });

  it("leaves bedrock, a material node, and the Core standing", () => {
    const game = emptyGame();
    setTile(game, 5, 200, "rock");
    game.grid[200]![5] = {
      kind: "material",
      band: "rockbed",
      material: "resonite",
    };
    detonateBlast(game, 5, 200, 2);
    expect(game.tileAt(5, 200).kind).toBe("material");
    expect(game.tileAt(0, 200).kind).toBe("bedrock");
    expect(game.tileAt(game.coreRow === 500 ? 16 : 16, game.coreRow).kind).toBe(
      "core",
    );
  });

  it("detonates a gas pocket caught in the block", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    setTile(game, 5, 250, "gas");
    // One tile above the pocket, inside GAS_BLAST_TILES of it.
    placeAt(
      game,
      5 * TILE + (TILE - MINER_W) / 2,
      250 * TILE + TILE / 2 - TILE - MINER_H / 2,
    );
    const before = game.miner.hull;
    detonateBlast(game, 5, 251, 2);
    expect(game.tileAt(5, 250).kind).toBe("tunnel");
    expect(game.miner.hull).toBeLessThan(before);
  });
});

describe("the Core Sample", () => {
  it("kills the miner outright when it detonates in hand", () => {
    const game = emptyGame();
    game.satchel.coreSample = true;
    game.coreTimer = 0.5;
    hold(game, {});
    run(game, 1, 10);
    expect(game.deathCause).toBe("core-detonation");
  });

  it("kills a miner within CORE_BLAST_TILES of a jettisoned Sample", () => {
    const game = emptyGame();
    game.groundItems.push({ kind: "core-sample", col: 5, row: 200 });
    game.coreTimer = 0.1;
    placeAt(game, 5 * TILE, 200 * TILE - TILE);
    hold(game, {});
    run(game, 0.2, 4);
    expect(game.deathCause).toBe("core-detonation");
  });

  it("leaves a miner beyond CORE_BLAST_TILES of a jettisoned Sample unharmed", () => {
    const game = emptyGame();
    game.groundItems.push({ kind: "core-sample", col: 5, row: 200 });
    game.coreTimer = 0.1;
    placeAt(game, 5 * TILE, (200 - CORE_BLAST_TILES - 2) * TILE);
    game.miner.travel = false;
    hold(game, {});
    run(game, 0.2, 4);
    expect(game.deathCause).toBeNull();
    expect(game.coreTimer).toBeNull();
    expect(game.coreGround()).toBeNull();
  });

  it("runs the timer down from CORE_TIMER wherever the expedition is", () => {
    const game = emptyGame();
    game.satchel.coreSample = true;
    game.coreTimer = CORE_TIMER;
    game.panel = "ore-market";
    hold(game, {});
    run(game, 3, 60);
    expect(game.coreTimer).toBeCloseTo(CORE_TIMER - 3, 5);
  });
});

describe("the one-time hazard notices", () => {
  it("raises the card NOTICE_DELAY after the hit and fades it after NOTICE_FADE", () => {
    const game = emptyGame();
    game.tiers.hull = 5;
    game.miner.hull = game.maxHull();
    game.raiseNotice("gas");
    expect(game.snapshot().notice).toEqual({ hazard: "gas", shown: false });
    hold(game, {});
    run(game, NOTICE_DELAY - 0.1, 10);
    expect(game.snapshot().notice!.shown).toBe(false);
    run(game, 0.2, 4);
    expect(game.snapshot().notice!.shown).toBe(true);
    run(game, NOTICE_FADE + 0.1, 40);
    expect(game.snapshot().notice).toBeNull();
  });

  it("fires at most once per expedition", () => {
    const game = emptyGame();
    game.raiseNotice("lava");
    game.dismissNotice();
    game.raiseNotice("lava");
    expect(game.notice).toBeNull();
    expect(game.noticesFired.lava).toBe(true);
    expect(game.noticesFired.gas).toBe(false);
  });
});
