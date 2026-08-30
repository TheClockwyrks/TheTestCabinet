// The debugging and automation surface (specs/instrumentation.md).
//
// The surface is installed on the page, so these run against a stand-in window that
// records what was dispatched at it. Key injection itself is a browser concern and is
// exercised there; what is checked here is that every operation poses exactly what it
// says it does, that the readings report it, and that an argument outside its domain
// fails loudly.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BAND_HEALTH,
  CAM_LEAD_MAX,
  CORE_TIMER,
  DEEPCORE_DEBUG_VERSION,
  FUEL_BUY_INCREMENT,
  MINER_H,
  MINER_W,
  ROCKET_COMPONENTS,
  SURFACE_Y,
  TILE,
  UPGRADE_PRICES,
} from "./constants";
import { DEEPCORE_HANDLE, installDebugApi } from "./debug";
import type { DeepcoreDebugApi } from "./debug";
import { Game } from "./game";
import { Input } from "./input";
import { colCenterX } from "./world";

interface Stub {
  dispatched: { type: string; code: string }[];
}

function surface(): { api: DeepcoreDebugApi; game: Game; stub: Stub } {
  const stub: Stub = { dispatched: [] };
  const win = {
    dispatchEvent(e: { type: string; code: string }) {
      stub.dispatched.push({ type: e.type, code: e.code });
      return true;
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal(
    "KeyboardEvent",
    class {
      type: string;
      code: string;
      constructor(type: string, init: { code: string }) {
        this.type = type;
        this.code = init.code;
      }
    },
  );
  const game = new Game();
  const api = installDebugApi({
    game,
    input: new Input(),
    clock: {
      setAutoStep: (enabled) => {
        game.autoStep = enabled;
      },
      advance: (seconds, frames) => {
        for (let i = 0; i < frames; i++) game.update(seconds / frames);
      },
    },
    drainEdges: () => {},
  });
  api.reset();
  api.setScreen("in-mine");
  api.clearMine();
  return { api, game, stub };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the surface itself", () => {
  it("reports its version and installs on the case's handle", () => {
    const { api } = surface();
    expect(api.version).toBe(DEEPCORE_DEBUG_VERSION);
    expect(
      (window as unknown as Record<string, unknown>)[DEEPCORE_HANDLE],
    ).toBe(api);
  });
});

describe("readings", () => {
  it("reports every field an operation can set", () => {
    const { api } = surface();
    const s = api.snapshot();
    for (const key of [
      "version",
      "screen",
      "panel",
      "mode",
      "worldSize",
      "coreRow",
      "menuIndex",
      "autoStep",
      "muted",
      "simTime",
      "hasSave",
      "credits",
      "creditsEarned",
      "depthMeters",
      "deepestDepthMeters",
      "coreTimer",
      "coreGround",
      "camera",
      "miner",
      "cargo",
      "satchel",
      "tiers",
      "items",
      "rocket",
      "scanner",
      "notice",
      "noticesFired",
      "summary",
    ]) {
      expect(s).toHaveProperty(key);
    }
    expect(Object.keys(s.camera).sort()).toEqual(["lead", "x", "y"]);
    for (const key of [
      "x",
      "y",
      "vx",
      "vy",
      "col",
      "row",
      "facing",
      "state",
      "grounded",
      "travel",
      "drill",
      "fuel",
      "maxFuel",
      "hull",
      "maxHull",
      "overloaded",
      "drilling",
    ]) {
      expect(s.miner).toHaveProperty(key);
    }
  });

  it("reads one cell, and reads a cell off the grid as bedrock", () => {
    const { api } = surface();
    api.setTile(5, 200, "rock");
    expect(api.tileAt(5, 200)).toEqual({
      kind: "rock",
      band: "rockbed",
      ore: null,
      material: null,
      health: BAND_HEALTH.rockbed,
      maxHealth: BAND_HEALTH.rockbed,
    });
    expect(api.tileAt(-1, 200).kind).toBe("bedrock");
    expect(api.tileAt(-1, 200).band).toBeNull();
    expect(api.tileAt(5, 200).health).toBe(BAND_HEALTH.rockbed);
  });

  it("finds the cell of a kind nearest the miner", () => {
    const { api } = surface();
    api.setMinerPosition(5 * TILE, 100 * TILE);
    api.setTile(5, 120, "gas");
    api.setTile(5, 400, "gas");
    expect(api.findTile("gas")).toEqual({ col: 5, row: 120 });
    expect(api.findTile("lava")).toBeNull();
  });

  it("reports each building's footprint on the ground line", () => {
    const { api } = surface();
    const boxes = api.buildings();
    expect(boxes).toHaveLength(6);
    for (const b of boxes) expect(b.y + b.h).toBe(SURFACE_Y);
  });
});

describe("restoring the world", () => {
  it("empties the mine without banking or detonating anything", () => {
    const { api, game } = surface();
    api.setOreTile(5, 200, "ferron");
    api.setTile(6, 200, "gas");
    api.setHull(game.maxHull());
    api.clearMine();
    expect(api.tileAt(5, 200).kind).toBe("tunnel");
    expect(api.tileAt(6, 200).kind).toBe("tunnel");
    expect(api.snapshot().cargo.slotsUsed).toBe(0);
    expect(api.snapshot().miner.hull).toBe(game.maxHull());
  });

  it("takes every ground item off without detonating a jettisoned Sample", () => {
    const { api, game } = surface();
    api.setHull(game.maxHull());
    api.placeCoreSample(5, 200);
    api.clearGroundItems();
    expect(api.snapshot().coreGround).toBeNull();
    expect(api.snapshot().coreTimer).toBeNull();
    expect(api.snapshot().miner.hull).toBe(game.maxHull());
  });

  it("empties the bay without earning Credits, and the satchel of supplies", () => {
    const { api } = surface();
    api.setCargo("aurite", 3);
    api.setItemCount("dynamite", 4);
    api.clearCargo();
    api.clearItems();
    expect(api.snapshot().cargo.slotsUsed).toBe(0);
    expect(api.snapshot().credits).toBe(0);
    expect(api.snapshot().items.dynamite).toBe(0);
  });

  it("generates a fresh mine and leaves the miner and the holdings alone", () => {
    const { api } = surface();
    api.setCredits(500);
    api.setMinerPosition(9 * TILE, 12 * TILE);
    api.generateMine();
    expect(api.snapshot().credits).toBe(500);
    expect(api.snapshot().miner.x).toBe(9 * TILE);
    expect(api.findTile("ore")).not.toBeNull();
  });
});

describe("posing the mine", () => {
  it("sets a cell's kind at its band's full health", () => {
    const { api } = surface();
    api.setTile(5, 450, "rock");
    expect(api.tileAt(5, 450).health).toBe(BAND_HEALTH.coreshell);
  });

  it("sets an ore cell and a material node", () => {
    const { api } = surface();
    api.setOreTile(5, 200, "verdite");
    expect(api.tileAt(5, 200)).toMatchObject({ kind: "ore", ore: "verdite" });
    api.setMaterialTile(6, 200, "resonite");
    expect(api.tileAt(6, 200)).toMatchObject({
      kind: "material",
      material: "resonite",
    });
  });

  it("poses a partly cut cell", () => {
    const { api } = surface();
    api.setTile(5, 200, "rock");
    api.setTileHealth(5, 200, 2);
    expect(api.tileAt(5, 200).health).toBe(2);
    expect(() => api.setTileHealth(5, 200, 0)).toThrow(/above 0|within/);
    expect(() => api.setTileHealth(5, 200, BAND_HEALTH.rockbed + 1)).toThrow();
  });

  it("refuses a health pose on a cell that is not minable", () => {
    const { api } = surface();
    api.setTile(5, 200, "stone");
    expect(() => api.setTileHealth(5, 200, 2)).toThrow(/minable/);
  });

  it("places a jettisoned Core Sample with its timer running", () => {
    const { api } = surface();
    api.placeCoreSample(5, 200);
    expect(api.snapshot().coreGround).toEqual({ col: 5, row: 200 });
    expect(api.snapshot().coreTimer).toBe(CORE_TIMER);
    expect(() => api.placeCoreSample(6, 200)).toThrow(/live/);
  });

  it("refuses a cell outside the grid or the camp row", () => {
    const { api } = surface();
    expect(() => api.setTile(5, 0, "rock")).toThrow(/row/);
    expect(() => api.setTile(99, 200, "rock")).toThrow(/col/);
    expect(() => api.setTile(5, 200, "ore" as "rock")).toThrow(/kind/);
  });
});

describe("posing the miner", () => {
  it("moves the miner alone and changes no cell", () => {
    const { api } = surface();
    api.setTile(5, 200, "rock");
    api.setMinerPosition(5 * TILE, 200 * TILE);
    expect(api.snapshot().miner.x).toBe(5 * TILE);
    expect(api.tileAt(5, 200).kind).toBe("rock");
  });

  it("sets the velocity, the facing, the fuel, and the hull within their domains", () => {
    const { api, game } = surface();
    api.setMinerVelocity(-40, 300);
    expect(api.snapshot().miner.vx).toBe(-40);
    expect(api.snapshot().miner.vy).toBe(300);
    api.setFacing("west");
    expect(api.snapshot().miner.facing).toBe("west");
    api.setFuel(12);
    expect(api.snapshot().miner.fuel).toBe(12);
    expect(() => api.setFuel(game.maxFuel() + 1)).toThrow();
    api.setHull(0);
    expect(api.snapshot().miner.hull).toBe(0);
    expect(() => api.setHull(-1)).toThrow();
    expect(() => api.setFacing("north" as "east")).toThrow();
  });

  it("holds each faculty on its own", () => {
    const { api } = surface();
    api.setMinerTravel(false);
    expect(api.snapshot().miner.travel).toBe(false);
    expect(api.snapshot().miner.drill).toBe(true);
    api.setMinerDrill(false);
    api.setMinerTravel(true);
    expect(api.snapshot().miner.travel).toBe(true);
    expect(api.snapshot().miner.drill).toBe(false);
  });
});

describe("posing the expedition", () => {
  it("sets the screen, the panel, and the highlighted item", () => {
    const { api } = surface();
    api.setScreen("paused");
    expect(api.snapshot().screen).toBe("paused");
    api.setMenuIndex(2);
    expect(api.snapshot().menuIndex).toBe(2);
    expect(() => api.setMenuIndex(3)).toThrow();
    api.setScreen("in-mine");
    api.setPanel("launch-pad");
    expect(api.snapshot().panel).toBe("launch-pad");
    api.setPanel(null);
    expect(api.snapshot().panel).toBeNull();
    expect(() => api.setScreen("nowhere" as "title")).toThrow();
  });

  it("sets the mode, the world size, and with it coreRow", () => {
    const { api } = surface();
    api.setMode("hardcore");
    expect(api.snapshot().mode).toBe("hardcore");
    api.setWorldSize("quick");
    expect(api.snapshot().worldSize).toBe("quick");
    expect(api.snapshot().coreRow).toBe(250);
  });

  it("sets a tier, clamping the pools to the new maxima and charging nothing", () => {
    const { api } = surface();
    api.setFuel(100);
    api.setTier("fuel", 5);
    expect(api.snapshot().tiers.fuel).toBe(5);
    expect(api.snapshot().miner.maxFuel).toBe(550);
    expect(api.snapshot().miner.fuel).toBe(100);
    api.setTier("fuel", 1);
    expect(api.snapshot().miner.fuel).toBe(100);
    expect(api.snapshot().credits).toBe(0);
    expect(() => api.setTier("scanner", 4)).toThrow();
    expect(() => api.setTier("nose" as "fuel", 2)).toThrow();
  });

  it("sets the cargo past the slot cap and the satchel's materials", () => {
    const { api } = surface();
    api.setCargo("ferron", 400);
    expect(api.snapshot().cargo.slotsUsed).toBe(400);
    expect(api.snapshot().cargo.ore.ferron).toBe(400);
    expect(api.snapshot().miner.overloaded).toBe(true);
    api.setMaterial("cryenite", 2);
    expect(api.snapshot().satchel.cryenite).toBe(2);
    expect(() => api.setCargo("ferron", -1)).toThrow();
  });

  it("carries and removes a Core Sample, and sets its timer", () => {
    const { api } = surface();
    api.setCoreCarried(true);
    expect(api.snapshot().satchel.coreSample).toBe(true);
    expect(api.snapshot().coreTimer).toBe(CORE_TIMER);
    expect(() => api.setCoreCarried(true)).toThrow(/live/);
    api.setCoreTimer(4);
    expect(api.snapshot().coreTimer).toBe(4);
    api.setCoreCarried(false);
    expect(api.snapshot().coreTimer).toBeNull();
    expect(() => api.setCoreTimer(4)).toThrow(/live/);
  });

  it("installs rocket components in the checklist's order", () => {
    const { api } = surface();
    api.setRocketInstalled(3);
    expect(api.snapshot().rocket.installed).toEqual(
      ROCKET_COMPONENTS.slice(0, 3).map((c) => c.id),
    );
    expect(api.snapshot().rocket.nextComponent).toBe("thruster");
    api.setRocketInstalled(5);
    expect(api.snapshot().rocket.nextComponent).toBeNull();
    expect(() => api.setRocketInstalled(6)).toThrow();
  });

  it("marks a notice as fired without raising or dismissing a card", () => {
    const { api } = surface();
    api.setNoticeFired("gas", true);
    expect(api.snapshot().noticesFired).toEqual({ gas: true, lava: false });
    expect(api.snapshot().notice).toBeNull();
  });

  it("sets the camera's carried lead within its bounds", () => {
    const { api } = surface();
    api.setCameraLead(-CAM_LEAD_MAX);
    expect(api.snapshot().camera.lead).toBe(-CAM_LEAD_MAX);
    expect(() => api.setCameraLead(CAM_LEAD_MAX + 1)).toThrow();
  });

  it("sets the mute toggle, which a reset leaves alone", () => {
    const { api } = surface();
    api.setMuted(true);
    api.reset();
    expect(api.snapshot().muted).toBe(true);
  });
});

describe("the controls", () => {
  it("runs the game's own rules rather than posing an outcome", () => {
    const { api } = surface();
    api.setCargo("ferron", 2);
    api.sell();
    expect(api.snapshot().credits).toBe(2 * 28);
    expect(api.snapshot().cargo.slotsUsed).toBe(0);

    api.setFuel(0);
    api.buyFuel();
    expect(api.snapshot().miner.fuel).toBe(FUEL_BUY_INCREMENT);

    api.setCredits(UPGRADE_PRICES[1]!);
    api.buyUpgrade("cargo");
    expect(api.snapshot().tiers.cargo).toBe(2);
    expect(api.snapshot().credits).toBe(0);
  });

  it("changes nothing when the game's own rules refuse", () => {
    const { api } = surface();
    api.setCredits(10);
    api.buyItem("matter-transmitter");
    expect(api.snapshot().items["matter-transmitter"]).toBe(0);
    expect(api.snapshot().credits).toBe(10);
    api.useItem("nanobots");
    expect(api.snapshot().items.nanobots).toBe(0);
  });

  it("drops one unit of an ore, losing it", () => {
    const { api } = surface();
    api.setCargo("cuprite", 2);
    api.dropOre("cuprite");
    expect(api.snapshot().cargo.ore.cuprite).toBe(1);
    expect(api.snapshot().credits).toBe(0);
  });

  it("jettisons the carried Sample onto the miner's cell, timer still running", () => {
    const { api } = surface();
    api.setMinerPosition(colCenterX(7, MINER_W), 200 * TILE - MINER_H);
    api.setCoreCarried(true);
    api.setCoreTimer(30);
    api.jettison();
    expect(api.snapshot().satchel.coreSample).toBe(false);
    expect(api.snapshot().coreGround).toEqual({ col: 7, row: 199 });
    expect(api.snapshot().coreTimer).toBe(30);
  });

  it("fabricates the next component and refuses one it cannot pay for", () => {
    const { api } = surface();
    api.setCredits(4000);
    api.fabricate();
    expect(api.snapshot().rocket.installed).toEqual(["hull-frame"]);
    api.fabricate();
    expect(api.snapshot().rocket.installed).toEqual(["hull-frame"]);
  });

  it("launches only once the rocket is complete", () => {
    const { api } = surface();
    api.launch();
    expect(api.snapshot().screen).toBe("in-mine");
    api.setRocketInstalled(5);
    api.launch();
    api.advance(4, 60);
    expect(api.snapshot().screen).toBe("victory");
  });
});

describe("the clock", () => {
  it("runs the frames asked for at the delta asked for", () => {
    const { api, game } = surface();
    api.setAutoStep(false);
    expect(api.snapshot().autoStep).toBe(false);
    api.advance(1, 60);
    expect(game.simTime).toBeCloseTo(1, 9);
    api.advance(0.5);
    expect(game.simTime).toBeCloseTo(1.5, 9);
  });

  it("refuses a negative span or a fractional frame count", () => {
    const { api } = surface();
    expect(() => api.advance(-1)).toThrow();
    expect(() => api.advance(1, 0)).toThrow();
    expect(() => api.advance(1, 1.5)).toThrow();
  });

  it("reaches the same state however the span was divided", () => {
    const { api: a } = surface();
    a.setMinerTravel(false);
    a.setMinerPosition(5 * TILE, 100 * TILE);
    a.setFuel(100);
    a.advance(1, 1);
    const { api: b } = surface();
    b.setMinerTravel(false);
    b.setMinerPosition(5 * TILE, 100 * TILE);
    b.setFuel(100);
    b.advance(1, 60);
    expect(a.snapshot().miner.fuel).toBeCloseTo(b.snapshot().miner.fuel, 9);
  });
});

describe("input", () => {
  it("dispatches real key events at the page", () => {
    const { api, stub } = surface();
    api.keyDown("KeyD");
    api.keyUp("KeyD");
    api.press("KeyE");
    expect(stub.dispatched).toEqual([
      { type: "keydown", code: "KeyD" },
      { type: "keyup", code: "KeyD" },
      { type: "keydown", code: "KeyE" },
      { type: "keyup", code: "KeyE" },
    ]);
  });
});
