// The debugging and automation surface (specs/instrumentation.md).
//
// Everything here goes through the engine, because the surface's whole contract
// is that a caller reaches it at `engine.debug`, drives a pose through
// `engine.apply`, and reads against `engine.state`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BAND_HEALTH,
  CAM_LEAD_MAX,
  CORE_COL,
  CORE_TIMER,
  DEEPCORE_DEBUG_VERSION,
  FUEL_TIERS,
  HULL_TIERS,
  ITEM_IDS,
  MINER_H,
  ROCKET_COMPONENTS,
  SURFACE_Y,
  TELEPORT_HEIGHT_TILES_MAX,
  TELEPORT_SPEED_MIN,
  TILE,
  TRACKS,
  WORLD_COLS,
} from "./constants";
import { coreRowFor } from "./tuning";
import {
  createHarness,
  installStorage,
  openScene,
  standOn,
  type Harness,
} from "./test-support";

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

describe("the surface itself", () => {
  it("reports its version and is reached at engine.debug alone", () => {
    expect(h.debug.version).toBe(DEEPCORE_DEBUG_VERSION);
    expect(h.engine.debug).toBe(h.debug);
    expect(
      (globalThis as Record<string, unknown>)["__deepcore"],
    ).toBeUndefined();
  });
});

describe("readings", () => {
  it("reports every field an operation can set", () => {
    const snapshot = h.debug.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "version",
        "screen",
        "panel",
        "mode",
        "worldSize",
        "coreRow",
        "menuIndex",
        "muted",
        "simTime",
        "elapsedSeconds",
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
        "nextTeleportHeight",
        "nextTeleportSpeed",
        "summary",
      ].sort(),
    );
    expect(Object.keys(snapshot.miner).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(Object.keys(snapshot.tiers).sort()).toEqual([...TRACKS].sort());
    expect(Object.keys(snapshot.items).sort()).toEqual([...ITEM_IDS].sort());
    expect(Object.keys(snapshot.camera).sort()).toEqual(["lead", "x", "y"]);
    expect(Object.keys(snapshot.cargo).sort()).toEqual(
      ["liftLimitKg", "loadKg", "ore", "slotCap", "slotsUsed"].sort(),
    );
    expect(Object.keys(snapshot.satchel).sort()).toEqual(
      ["coreSample", "cryenite", "resonite"].sort(),
    );
    expect(Object.keys(snapshot.rocket).sort()).toEqual(
      ["installed", "nextComponent"].sort(),
    );
    expect(Object.keys(snapshot.scanner).sort()).toEqual(
      ["dirX", "dirY", "distanceTiles", "locked", "target"].sort(),
    );
    expect(Object.keys(snapshot.noticesFired).sort()).toEqual(["gas", "lava"]);
  });

  it("reports a live cut and a finished expedition in the shape the surface fixes", async () => {
    h.debug.setTile(5, 200, "rock");
    h.debug.setTile(5, 201, "rock");
    standOn(h, 5, 200);
    h.debug.setFuel(100);
    h.hold("down");
    await h.advance(12);
    h.release("down");
    const cut = h.debug.snapshot().miner.drilling;
    expect(cut).not.toBeNull();
    expect(Object.keys(cut ?? {}).sort()).toEqual(
      ["col", "dir", "progress", "row"].sort(),
    );
    expect(cut?.progress).toBeGreaterThan(0);
    expect(cut?.progress).toBeLessThanOrEqual(1);

    h.debug.setHull(0);
    await h.seconds(2);
    const summary = h.debug.snapshot().summary;
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      [
        "componentsInstalled",
        "creditsEarned",
        "deathCause",
        "deepestDepthMeters",
        "elapsedSeconds",
        "mode",
      ].sort(),
    );
  });

  it("reads a cell in the shape the surface fixes", () => {
    h.debug.setOreTile(5, 200, "ferron");
    expect(Object.keys(h.debug.tileAt(5, 200)).sort()).toEqual(
      ["band", "health", "kind", "material", "maxHealth", "ore"].sort(),
    );
  });

  it("rests every field the current screen does not use", () => {
    const snapshot = h.debug.snapshot();
    expect(snapshot.summary).toBeNull();
    expect(snapshot.coreTimer).toBeNull();
    expect(snapshot.coreGround).toBeNull();
    expect(snapshot.panel).toBeNull();
    expect(snapshot.notice).toBeNull();
    expect(snapshot.scanner.locked).toBe(false);
    expect(snapshot.scanner.distanceTiles).toBeNull();
    expect(snapshot.cargo.ore).toEqual({});
  });

  it("reads one cell, and reads a cell off the grid as bedrock", () => {
    h.debug.setTile(5, 200, "rock");
    const read = h.debug.tileAt(5, 200);
    expect(read.kind).toBe("rock");
    expect(read.band).toBe("rockbed");
    expect(read.health).toBe(BAND_HEALTH.rockbed);
    expect(read.maxHealth).toBe(BAND_HEALTH.rockbed);
    const off = h.debug.tileAt(-1, 200);
    expect(off.kind).toBe("bedrock");
    expect(off.band).toBeNull();
    expect(off.health).toBeNull();
  });

  it("finds the cell of a kind nearest the miner", () => {
    standOn(h, 5, 200);
    h.debug.setTile(9, 200, "stone");
    h.debug.setTile(20, 200, "stone");
    expect(h.debug.findTile("stone")).toEqual({ col: 9, row: 200 });
    expect(h.debug.findTile("gas")).toBeNull();
  });

  it("reports each building's footprint resting on the ground line", () => {
    const boxes = h.debug.buildings();
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      expect(box.y + box.h).toBe(SURFACE_Y);
      expect(box.w).toBeGreaterThan(0);
    }
  });
});

describe("restoring the world", () => {
  it("empties the mine without banking or detonating anything", () => {
    h.debug.setOreTile(5, 200, "ferron");
    h.debug.setTile(6, 200, "gas");
    h.debug.clearMine();
    const snapshot = h.debug.snapshot();
    expect(h.debug.tileAt(5, 200).kind).toBe("tunnel");
    expect(h.debug.tileAt(6, 200).kind).toBe("tunnel");
    expect(snapshot.cargo.slotsUsed).toBe(0);
    expect(snapshot.miner.hull).toBe(HULL_TIERS[0]);
  });

  it("empties the bay and the supplies without earning Credits", () => {
    h.debug.setCargo("aurite", 4);
    h.debug.setItemCount("dynamite", 3);
    h.debug.clearCargo();
    h.debug.clearItems();
    const snapshot = h.debug.snapshot();
    expect(snapshot.cargo.slotsUsed).toBe(0);
    expect(snapshot.credits).toBe(0);
    expect(snapshot.items.dynamite).toBe(0);
  });

  it("generates a fresh mine and leaves the miner and the holdings alone", () => {
    h.debug.setCredits(700);
    standOn(h, 5, 200);
    const before = h.debug.snapshot().miner;
    h.debug.generateMine();
    const snapshot = h.debug.snapshot();
    expect(snapshot.credits).toBe(700);
    expect(snapshot.miner.x).toBe(before.x);
    expect(snapshot.miner.y).toBe(before.y);
    expect(h.debug.findTile("ore")).not.toBeNull();
  });

  it("poses each Quantum Teleporter draw on its own, within its bounds, and clears it with null", () => {
    expect(h.debug.snapshot().nextTeleportHeight).toBeNull();
    expect(h.debug.snapshot().nextTeleportSpeed).toBeNull();
    h.debug.setNextTeleportHeight(TELEPORT_HEIGHT_TILES_MAX);
    expect(h.debug.snapshot().nextTeleportHeight).toBe(
      TELEPORT_HEIGHT_TILES_MAX,
    );
    expect(h.debug.snapshot().nextTeleportSpeed).toBeNull();
    h.debug.setNextTeleportSpeed(TELEPORT_SPEED_MIN);
    expect(h.debug.snapshot().nextTeleportSpeed).toBe(TELEPORT_SPEED_MIN);
    h.debug.setNextTeleportHeight(null);
    expect(h.debug.snapshot().nextTeleportHeight).toBeNull();
    expect(h.debug.snapshot().nextTeleportSpeed).toBe(TELEPORT_SPEED_MIN);
    expect(() =>
      h.debug.setNextTeleportHeight(TELEPORT_HEIGHT_TILES_MAX + 1),
    ).toThrow();
    expect(() =>
      h.debug.setNextTeleportSpeed(TELEPORT_SPEED_MIN - 1),
    ).toThrow();
  });

  it("consumes a posed Quantum Teleporter outcome with the use, and clears it on reset", () => {
    h.debug.setItemCount("quantum-teleporter", 1);
    h.debug.setNextTeleportHeight(2);
    h.debug.setNextTeleportSpeed(300);
    h.debug.useItem("quantum-teleporter");
    const placed = h.debug.snapshot();
    expect((SURFACE_Y - (placed.miner.y + MINER_H)) / TILE).toBeCloseTo(2, 9);
    expect(placed.miner.vy).toBe(300);
    expect(placed.nextTeleportHeight).toBeNull();
    expect(placed.nextTeleportSpeed).toBeNull();

    h.debug.setNextTeleportHeight(5);
    h.debug.reset();
    expect(h.debug.snapshot().nextTeleportHeight).toBeNull();
  });

  it("restores the whole observable state to its title value", () => {
    h.debug.setCredits(900);
    h.debug.setTier("drill", 4);
    h.debug.setCargo("ferron", 5);
    h.debug.setCoreCarried(true);
    h.debug.setCameraLead(CAM_LEAD_MAX);
    h.debug.setMinerTravel(false);
    h.debug.reset();
    const snapshot = h.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.mode).toBe("standard");
    expect(snapshot.worldSize).toBe("standard");
    expect(snapshot.credits).toBe(0);
    expect(snapshot.creditsEarned).toBe(0);
    expect(snapshot.tiers.drill).toBe(1);
    expect(snapshot.cargo.slotsUsed).toBe(0);
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(snapshot.coreTimer).toBeNull();
    expect(snapshot.camera.lead).toBe(0);
    expect(snapshot.miner.travel).toBe(true);
    expect(snapshot.miner.drill).toBe(true);
    expect(snapshot.miner.fuel).toBe(FUEL_TIERS[0]);
    expect(snapshot.miner.hull).toBe(HULL_TIERS[0]);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.noticesFired).toEqual({ gas: false, lava: false });
  });
});

describe("posing the mine", () => {
  it("sets a cell's kind at its band's full health", () => {
    h.debug.setTile(5, 300, "rock");
    const read = h.debug.tileAt(5, 300);
    expect(read.kind).toBe("rock");
    expect(read.health).toBe(BAND_HEALTH.deepstone);
  });

  it("sets an ore cell and a material node", () => {
    h.debug.setOreTile(5, 200, "argenite");
    expect(h.debug.tileAt(5, 200).ore).toBe("argenite");
    h.debug.setMaterialTile(6, 200, "resonite");
    const read = h.debug.tileAt(6, 200);
    expect(read.kind).toBe("material");
    expect(read.material).toBe("resonite");
  });

  it("poses a partly cut cell", () => {
    h.debug.setTile(5, 200, "rock");
    h.debug.setTileHealth(5, 200, 3);
    expect(h.debug.tileAt(5, 200).health).toBe(3);
    expect(() =>
      h.debug.setTileHealth(5, 200, BAND_HEALTH.rockbed + 1),
    ).toThrow(RangeError);
  });

  it("refuses a health pose on a cell that is not minable", () => {
    expect(() => h.debug.setTileHealth(5, 200, 1)).toThrow(RangeError);
  });

  it("places a jettisoned Core Sample with its timer running", () => {
    h.debug.placeCoreSample(7, 210);
    const snapshot = h.debug.snapshot();
    expect(snapshot.coreGround).toEqual({ col: 7, row: 210 });
    expect(snapshot.coreTimer).toBe(CORE_TIMER);
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(() => h.debug.placeCoreSample(8, 210)).toThrow(RangeError);
  });

  it("refuses a cell outside the grid or on the camp row", () => {
    expect(() => h.debug.setTile(WORLD_COLS, 5, "rock")).toThrow(RangeError);
    expect(() => h.debug.setTile(5, 0, "rock")).toThrow(RangeError);
  });
});

describe("posing the miner", () => {
  it("moves the miner alone and changes no cell", () => {
    h.debug.setTile(5, 200, "rock");
    h.debug.setMinerPosition(5 * TILE, 200 * TILE);
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.x).toBe(5 * TILE);
    expect(snapshot.miner.y).toBe(200 * TILE);
    expect(h.debug.tileAt(5, 200).kind).toBe("rock");
  });

  it("sets the velocity, the facing, the fuel and the hull within their domains", () => {
    h.debug.setMinerVelocity(-30, 90);
    h.debug.setFacing("west");
    h.debug.setFuel(12);
    h.debug.setHull(34);
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.vx).toBe(-30);
    expect(snapshot.miner.vy).toBe(90);
    expect(snapshot.miner.facing).toBe("west");
    expect(snapshot.miner.fuel).toBe(12);
    expect(snapshot.miner.hull).toBe(34);
    expect(() => h.debug.setFuel(FUEL_TIERS[0] + 1)).toThrow(RangeError);
    expect(() => h.debug.setFacing("north" as "east")).toThrow(RangeError);
  });

  it("holds each faculty on its own", () => {
    h.debug.setMinerTravel(false);
    expect(h.debug.snapshot().miner.travel).toBe(false);
    expect(h.debug.snapshot().miner.drill).toBe(true);
    h.debug.setMinerDrill(false);
    h.debug.setMinerTravel(true);
    expect(h.debug.snapshot().miner.travel).toBe(true);
    expect(h.debug.snapshot().miner.drill).toBe(false);
  });
});

describe("posing the expedition", () => {
  it("sets the screen, the panel, and the highlighted item", () => {
    h.debug.setScreen("title");
    h.debug.setMenuIndex(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(() => h.debug.setMenuIndex(9)).toThrow(RangeError);
    h.debug.setScreen("in-mine");
    h.debug.setPanel("supply-depot");
    expect(h.debug.snapshot().panel).toBe("supply-depot");
    h.debug.setPanel(null);
    expect(h.debug.snapshot().panel).toBeNull();
  });

  it("sets the mode, the world size, and with it coreRow", () => {
    h.debug.setMode("hardcore");
    h.debug.setWorldSize("marathon");
    const snapshot = h.debug.snapshot();
    expect(snapshot.mode).toBe("hardcore");
    expect(snapshot.worldSize).toBe("marathon");
    expect(snapshot.coreRow).toBe(coreRowFor("marathon"));
  });

  it("resizes the mine onto a deeper size instead of emptying it", () => {
    h.debug.setWorldSize("quick");
    const was = coreRowFor("quick");
    h.debug.setOreTile(5, 100, "ferron");
    h.debug.setTileHealth(5, 100, 1);
    const kept = h.debug.tileAt(5, 100);

    h.debug.setWorldSize("marathon");
    const now = coreRowFor("marathon");

    // The cell comes through with its own band, which the deeper mine no longer
    // computes for that row.
    expect(h.debug.tileAt(5, 100)).toEqual(kept);
    expect(kept.band).toBe("rockbed");
    expect(h.debug.tileAt(5, 900).kind).toBe("tunnel");
    expect(h.debug.tileAt(0, 900).kind).toBe("bedrock");
    // One Core chamber, and it is the new deepest row.
    expect(h.debug.findTile("core")).toEqual({ col: CORE_COL, row: now });
    expect(h.debug.tileAt(CORE_COL, was).kind).toBe("tunnel");
  });

  it("resizes the mine onto a shallower size, dropping the rows past it", () => {
    h.debug.setWorldSize("marathon");
    h.debug.generateMine();
    const kept = h.debug.tileAt(5, 100);

    h.debug.setWorldSize("quick");
    const now = coreRowFor("quick");

    expect(h.debug.tileAt(5, 100)).toEqual(kept);
    expect(h.debug.tileAt(5, 700).band).toBeNull();
    expect(h.debug.tileAt(CORE_COL, now).kind).toBe("core");
    expect(h.debug.tileAt(5, now).kind).toBe("bedrock");
    expect(h.debug.snapshot().coreRow).toBe(now);
  });

  it("sets a tier, clamping the pools to the new maxima and charging nothing", () => {
    h.debug.setTier("fuel", 5);
    h.debug.setFuel(FUEL_TIERS[4]);
    h.debug.setTier("fuel", 1);
    const snapshot = h.debug.snapshot();
    expect(snapshot.tiers.fuel).toBe(1);
    expect(snapshot.miner.fuel).toBe(FUEL_TIERS[0]);
    expect(snapshot.credits).toBe(0);
    expect(() => h.debug.setTier("scanner", 4)).toThrow(RangeError);
  });

  it("sets the cargo past the slot cap and the satchel's materials", () => {
    h.debug.setCargo("ferron", 999);
    h.debug.setMaterial("cryenite", 2);
    const snapshot = h.debug.snapshot();
    expect(snapshot.cargo.ore.ferron).toBe(999);
    expect(snapshot.cargo.slotsUsed).toBe(999);
    expect(snapshot.satchel.cryenite).toBe(2);
  });

  it("carries and removes a Core Sample, and sets its timer", () => {
    h.debug.setCoreCarried(true);
    expect(h.debug.snapshot().coreTimer).toBe(CORE_TIMER);
    expect(() => h.debug.setCoreCarried(true)).toThrow(RangeError);
    h.debug.setCoreTimer(12);
    expect(h.debug.snapshot().coreTimer).toBe(12);
    h.debug.setCoreCarried(false);
    const snapshot = h.debug.snapshot();
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(snapshot.coreTimer).toBeNull();
    expect(() => h.debug.setCoreTimer(5)).toThrow(RangeError);
  });

  it("installs rocket components in the checklist's order", () => {
    h.debug.setRocketInstalled(3);
    const snapshot = h.debug.snapshot();
    expect(snapshot.rocket.installed).toEqual(
      ROCKET_COMPONENTS.slice(0, 3).map((component) => component.id),
    );
    expect(snapshot.rocket.nextComponent).toBe(ROCKET_COMPONENTS[3].id);
    expect(snapshot.credits).toBe(0);
  });

  it("marks a notice as fired without raising or dismissing a card", () => {
    h.debug.setNoticeFired("gas", true);
    const snapshot = h.debug.snapshot();
    expect(snapshot.noticesFired.gas).toBe(true);
    expect(snapshot.notice).toBeNull();
  });

  it("deletes the save slot", () => {
    standOn(h, 4, 1);
    h.debug.save();
    expect(h.debug.snapshot().hasSave).toBe(true);
    h.debug.clearSave();
    expect(h.debug.snapshot().hasSave).toBe(false);
  });
});

describe("the controls", () => {
  it("runs the game's own rules rather than posing an outcome", () => {
    h.debug.setCargo("ferron", 2);
    h.debug.sell();
    const sold = h.debug.snapshot();
    expect(sold.cargo.slotsUsed).toBe(0);
    expect(sold.credits).toBeGreaterThan(0);
    h.debug.setFuel(10);
    h.debug.buyFuel();
    expect(h.debug.snapshot().miner.fuel).toBeGreaterThan(10);
  });

  it("changes nothing when the game's own rules refuse", () => {
    h.debug.setCredits(0);
    h.debug.buyUpgrade("drill");
    expect(h.debug.snapshot().tiers.drill).toBe(1);
    h.debug.buyItem("nanobots");
    expect(h.debug.snapshot().items.nanobots).toBe(0);
  });

  it("jettisons the carried Sample onto the miner's cell, timer still running", () => {
    standOn(h, 9, 200);
    h.debug.setCoreCarried(true);
    h.debug.setCoreTimer(40);
    h.debug.jettison();
    const snapshot = h.debug.snapshot();
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(snapshot.coreGround).toEqual({ col: 9, row: 199 });
    expect(snapshot.coreTimer).toBe(40);
  });

  it("fabricates the next component and refuses one it cannot pay for", () => {
    h.debug.setCredits(ROCKET_COMPONENTS[0].credits);
    h.debug.fabricate();
    expect(h.debug.snapshot().rocket.installed).toEqual([
      ROCKET_COMPONENTS[0].id,
    ]);
    h.debug.fabricate();
    expect(h.debug.snapshot().rocket.installed).toHaveLength(1);
  });

  it("launches only once the rocket is complete", async () => {
    standOn(h, 4, 1);
    h.debug.setRocketInstalled(4);
    h.debug.launch();
    await h.seconds(4);
    expect(h.debug.snapshot().screen).toBe("in-mine");
    h.debug.setRocketInstalled(5);
    h.debug.launch();
    await h.seconds(4);
    expect(h.debug.snapshot().screen).toBe("victory");
  });
});

describe("what a pose leaves alone", () => {
  it("moves the miner into a solid cell and lets the game's own rules resolve it", async () => {
    h.debug.setTile(5, 200, "rock");
    h.debug.setMinerPosition(5 * TILE, 200 * TILE);
    h.debug.setMinerDrill(false);
    expect(h.debug.tileAt(5, 200).kind).toBe("rock");
    await h.seconds(0.5);
    // The collision resolver lifts it out; nothing was drilled.
    expect(h.debug.tileAt(5, 200).kind).toBe("rock");
  });

  it("leaves the mute preference untouched across a reset", () => {
    expect(h.debug.snapshot().muted).toBe(false);
    h.debug.reset();
    expect(h.debug.snapshot().muted).toBe(false);
    // Standing at the camp is what a fresh state opens at.
    expect(h.debug.snapshot().miner.y + MINER_H).toBe(SURFACE_Y);
  });
});
