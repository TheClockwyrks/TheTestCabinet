// The expedition, the camera, and the render-free core the debug surface rests on
// (specs/expedition.md, specs/world.md, specs/instrumentation.md).

import { describe, expect, it } from "vitest";
import {
  BUILDING_GAP,
  CAM_LEAD_MAX,
  CAM_LEAD_RAMP,
  CAM_STILL_SPEED,
  CAM_UNWIND_MULT,
  CAVE_MOUTH_COL,
  LIFE_SUPPORT_BURN,
  MAX_CAM_X,
  METERS_PER_ROW,
  MINER_H,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  ROCKET_TOTAL_CREDITS,
  SIZE_BLURB,
  SPAWN_COL,
  STANDARD_ROWS,
  SURFACE_Y,
  TILE,
  VIEW_H,
  VIEW_W,
  coreDepthMetersFor,
  coreRowFor,
  depthFraction,
} from "./constants";
import { Game } from "./game";
import {
  emptyGame,
  hold,
  placeAt,
  run,
  setTile,
  standOn,
} from "./test-support";

describe("the camera", () => {
  it("centres the miner horizontally and clamps at the mine's sides", () => {
    const game = emptyGame();
    placeAt(game, 15 * TILE, 100 * TILE);
    game.miner.travel = false;
    hold(game, {});
    run(game, 0.1, 1);
    expect(game.camX).toBeCloseTo(15 * TILE + 28 - VIEW_W / 2, 3);
    placeAt(game, 1 * TILE, 100 * TILE);
    run(game, 0.1, 1);
    expect(game.camX).toBe(0);
    placeAt(game, 30 * TILE, 100 * TILE);
    run(game, 0.1, 1);
    expect(game.camX).toBe(MAX_CAM_X);
  });

  it("builds the lead toward CAM_LEAD_MAX over CAM_LEAD_RAMP seconds of travel", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 100 * TILE);
    game.miner.travel = false;
    game.miner.vy = 400;
    hold(game, {});
    run(game, CAM_LEAD_RAMP / 2, 30);
    expect(game.camLead).toBeCloseTo(CAM_LEAD_MAX / 2, 3);
    run(game, CAM_LEAD_RAMP / 2, 30);
    expect(game.camLead).toBeCloseTo(CAM_LEAD_MAX, 3);
    run(game, 1, 60);
    expect(game.camLead).toBeCloseTo(CAM_LEAD_MAX, 3);
  });

  it("leads the other way on a climb", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 100 * TILE);
    game.miner.travel = false;
    game.miner.vy = -400;
    hold(game, {});
    run(game, CAM_LEAD_RAMP, 60);
    expect(game.camLead).toBeCloseTo(-CAM_LEAD_MAX, 3);
  });

  it("unwinds toward zero at CAM_UNWIND_MULT times the ramp rate", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 100 * TILE);
    game.miner.travel = false;
    game.camLead = CAM_LEAD_MAX;
    game.miner.vy = 0;
    hold(game, {});
    const seconds = CAM_LEAD_RAMP / CAM_UNWIND_MULT;
    run(game, seconds, 30);
    expect(game.camLead).toBeCloseTo(0, 3);
  });

  it("holds the lead at zero while the miner counts as still", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 100 * TILE);
    game.miner.travel = false;
    game.miner.vy = CAM_STILL_SPEED;
    hold(game, {});
    run(game, 2, 60);
    expect(game.camLead).toBe(0);
  });

  it("follows the miner up into the open sky with no upper clamp", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, -20 * TILE);
    game.miner.travel = false;
    hold(game, {});
    run(game, 0.1, 1);
    expect(game.camY).toBeLessThan(-10 * TILE);
  });

  it("stops the view at the bottom of the Core chamber", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, (game.coreRow - 1) * TILE);
    game.miner.travel = false;
    game.miner.vy = 800;
    hold(game, {});
    run(game, 3, 60);
    expect(game.camY).toBeCloseTo((game.coreRow + 1) * TILE - VIEW_H, 6);
  });
});

describe("the surface camp", () => {
  it("stands six buildings on the ground line, clear of each other and the cave mouth", () => {
    const game = new Game();
    const boxes = game.buildings();
    expect(boxes).toHaveLength(6);
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    for (const b of sorted) {
      expect(b.y + b.h).toBe(SURFACE_Y);
      expect(b.x).toBeGreaterThanOrEqual(PLAYABLE_COL_MIN * TILE);
      expect(b.x + b.w).toBeLessThanOrEqual((PLAYABLE_COL_MAX + 1) * TILE);
      // Clear of the cave mouth's column.
      expect(b.x + b.w).toBeLessThanOrEqual(CAVE_MOUTH_COL * TILE);
    }
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i]!.x - (sorted[i - 1]!.x + sorted[i - 1]!.w),
      ).toBeGreaterThanOrEqual(BUILDING_GAP);
    }
  });

  it("spawns the miner standing on the camp ground at SPAWN_COL", () => {
    const game = new Game();
    game.newExpedition("standard", "standard");
    expect(game.miner.y + MINER_H).toBe(SURFACE_Y);
    expect(game.snapshot().miner.col).toBe(SPAWN_COL);
    expect(game.depthMeters()).toBe(0);
  });
});

describe("depth", () => {
  it("reads METERS_PER_ROW per row below the ground line", () => {
    const game = emptyGame();
    standOn(game, 5, 41);
    expect(game.depthMeters()).toBeCloseTo(40 * METERS_PER_ROW, 6);
  });

  it("never reads below zero above the ground line", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, -5 * TILE);
    expect(game.depthMeters()).toBe(0);
  });
});

describe("world size", () => {
  it("scales only the Core's row", () => {
    expect(coreRowFor("quick")).toBe(STANDARD_ROWS / 2);
    expect(coreRowFor("standard")).toBe(STANDARD_ROWS);
    expect(coreRowFor("marathon")).toBe(STANDARD_ROWS * 2);
  });

  it("keeps the depth fraction identical in shape at every size", () => {
    expect(depthFraction(1, 250)).toBe(0);
    expect(depthFraction(1, 1000)).toBe(0);
    expect(depthFraction(250, 250)).toBe(1);
    expect(depthFraction(1000, 1000)).toBe(1);
    // The same fraction of the descent at any size.
    expect(depthFraction(126, 250)).toBeCloseTo(depthFraction(501, 1000), 2);
  });
});

describe("the render-free core", () => {
  it("reaches the same rate-driven state however the interval was divided", () => {
    const build = (): Game => {
      const game = emptyGame();
      placeAt(game, 5 * TILE, 100 * TILE);
      game.miner.travel = false;
      game.miner.fuel = 100;
      hold(game, {});
      return game;
    };
    const coarse = build();
    const fine = build();
    coarse.update(1);
    run(fine, 1, 60);
    expect(coarse.miner.fuel).toBeCloseTo(fine.miner.fuel, 9);
    expect(coarse.miner.fuel).toBeCloseTo(100 - LIFE_SUPPORT_BURN, 9);
    expect(coarse.simTime).toBeCloseTo(fine.simTime, 9);
  });

  it("lands the same drill hits over the same span at any step size", () => {
    const build = (): Game => {
      const game = emptyGame();
      setTile(game, 5, 20, "rock");
      setTile(game, 5, 21, "rock");
      standOn(game, 5, 20);
      game.miner.fuel = 100;
      hold(game, { down: true });
      return game;
    };
    const coarse = build();
    const fine = build();
    coarse.update(0.3);
    run(fine, 0.3, 30);
    expect(coarse.tileAt(5, 20).health).toBe(fine.tileAt(5, 20).health);
  });

  it("accumulates simTime on every screen", () => {
    const game = new Game();
    game.reset();
    expect(game.screen).toBe("title");
    run(game, 2, 20);
    expect(game.simTime).toBeCloseTo(2, 9);
  });
});

describe("reset", () => {
  it("restores the whole observable state to its title value", () => {
    const game = new Game();
    game.newExpedition("hardcore", "marathon");
    game.credits = 900;
    game.cargo.ferron = 4;
    game.satchel.resonite = 2;
    game.miner.travel = false;
    game.miner.drill = false;
    game.muted = true;
    game.reset();
    const s = game.snapshot();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.mode).toBe("standard");
    expect(s.worldSize).toBe("standard");
    expect(s.credits).toBe(0);
    expect(s.cargo.slotsUsed).toBe(0);
    expect(s.satchel).toEqual({ resonite: 0, cryenite: 0, coreSample: false });
    expect(s.tiers).toEqual({
      fuel: 1,
      drill: 1,
      cargo: 1,
      hull: 1,
      jetpack: 1,
      radiator: 1,
      scanner: 1,
    });
    expect(s.miner.fuel).toBe(s.miner.maxFuel);
    expect(s.miner.hull).toBe(s.miner.maxHull);
    expect(s.miner.travel).toBe(true);
    expect(s.miner.drill).toBe(true);
    expect(s.miner.col).toBe(SPAWN_COL);
    expect(s.camera.lead).toBe(0);
    expect(s.simTime).toBe(0);
    expect(s.rocket.installed).toEqual([]);
    expect(s.noticesFired).toEqual({ gas: false, lava: false });
    // Muting is a player preference, not a value an expedition opens with.
    expect(s.muted).toBe(true);
  });

  it("leaves an empty mine, with the border, the camp, and the Core standing", () => {
    const game = new Game();
    game.reset();
    expect(game.tileAt(0, 10).kind).toBe("bedrock");
    expect(game.tileAt(5, 10).kind).toBe("tunnel");
    expect(game.tileAt(16, game.coreRow).kind).toBe("core");
  });
});

describe("the rocket and the expedition's end", () => {
  it("sums the five components to ROCKET_TOTAL_CREDITS", () => {
    expect(ROCKET_TOTAL_CREDITS).toBe(25500);
  });

  it("takes the Victory screen once the launch has played out", () => {
    const game = emptyGame();
    game.installed = new Set([
      "hull-frame",
      "fuel-cells",
      "guidance",
      "thruster",
      "ignition",
    ]);
    expect(game.startLaunch()).toBe(true);
    hold(game, {});
    run(game, 4, 60);
    expect(game.screen).toBe("victory");
    expect(game.summary).not.toBeNull();
    expect(game.summary!.componentsInstalled).toBe(5);
    expect(game.summary!.deathCause).toBeNull();
  });

  it("ends at Game Over when the fuel runs out below the ground line", () => {
    const game = emptyGame();
    standOn(game, 5, 100);
    setTile(game, 5, 100, "rock");
    game.miner.fuel = 0;
    hold(game, {});
    run(game, 2, 60);
    expect(game.screen).toBe("game-over");
    expect(game.summary!.deathCause).toBe("fuel-out");
  });

  it("ends at Game Over when the hull stands at zero, whatever emptied it", () => {
    const game = emptyGame();
    standOn(game, 5, 100);
    setTile(game, 5, 100, "rock");
    game.miner.hull = 0;
    hold(game, {});
    run(game, 2, 60);
    expect(game.screen).toBe("game-over");
    expect(game.summary!.deathCause).toBe("hull-destroyed");
  });

  it("records the deepest depth reached, not the depth at the end", () => {
    const game = emptyGame();
    standOn(game, 5, 100);
    game.miner.travel = false;
    hold(game, {});
    run(game, 0.1, 1);
    const deep = game.deepestDepthMeters;
    standOn(game, 5, 10);
    run(game, 0.1, 1);
    expect(game.deepestDepthMeters).toBe(deep);
  });
});

describe("the size-select copy", () => {
  it("states each size's Core depth as the world file's table gives it", () => {
    expect(coreDepthMetersFor("quick")).toBe(1250);
    expect(coreDepthMetersFor("standard")).toBe(2500);
    expect(coreDepthMetersFor("marathon")).toBe(5000);
    for (const size of ["quick", "standard", "marathon"] as const) {
      expect(SIZE_BLURB[size]).toContain(`${coreDepthMetersFor(size)} m`);
    }
  });
});
