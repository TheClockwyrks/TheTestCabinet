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

describe("reconciling derived state", () => {
  it("carries every core operation", () => {
    for (const op of ["reset", "reconcile", "snapshot"] as const) {
      expect(typeof h.debug[op]).toBe("function");
    }
  });

  it("re-derives a stored reading from a posed world", () => {
    // The scanner's lock is the one reading this build keeps as a stored copy,
    // written by the update alone, so a pose leaves it answering for the world
    // as it was.
    h.pose((debug, state) => debug.setTier(state, "scanner", 3));
    h.pose((debug, state) => debug.setMaterialTile(state, 9, 199, "resonite"));
    standOn(h, 9, 200);
    expect(h.debug.snapshot(h.state).scanner.locked).toBe(false);

    h.pose((debug, state) => debug.reconcile(state));
    const locked = h.debug.snapshot(h.state);
    expect(locked.scanner.locked).toBe(true);
    expect(locked.scanner.target).toBe("resonite");
  });

  it("advances nothing, and twice is the same as once", () => {
    h.pose((debug, state) => debug.setTile(state, 9, 200, "rock"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 9 * TILE, 12 * TILE),
    );
    h.pose((debug, state) => debug.setMinerVelocity(state, 0, 0));
    h.pose((debug, state) => debug.setFuel(state, 40));
    h.pose((debug, state) => debug.setElapsed(state, 7));

    const before = h.debug.snapshot(h.state);
    h.pose((debug, state) => debug.reconcile(state));
    const once = h.debug.snapshot(h.state);
    h.pose((debug, state) => debug.reconcile(state));
    const twice = h.debug.snapshot(h.state);

    expect(once.simTime).toBe(before.simTime);
    expect(once.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(once.miner.x).toBe(before.miner.x);
    expect(once.miner.y).toBe(before.miner.y);
    expect(once.miner.vx).toBe(before.miner.vx);
    expect(once.miner.vy).toBe(before.miner.vy);
    expect(once.miner.fuel).toBe(before.miner.fuel);
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });

  it("moves nothing to make a reading agree", () => {
    // A miner posed inside a solid cell stays lodged there and reads as it is.
    h.pose((debug, state) => debug.setTile(state, 9, 200, "rock"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 9 * TILE, 200 * TILE),
    );
    h.pose((debug, state) => debug.reconcile(state));
    const after = h.debug.snapshot(h.state);
    expect(after.miner.x).toBe(9 * TILE);
    expect(after.miner.y).toBe(200 * TILE);
    expect(h.debug.tileAt(h.state, 9, 200).kind).toBe("rock");
  });
});

describe("readings", () => {
  it("reports every field an operation can set", () => {
    const snapshot = h.debug.snapshot(h.state);
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
        "elapsedSeconds",
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
    h.pose((debug, state) => debug.setTile(state, 5, 200, "rock"));
    h.pose((debug, state) => debug.setTile(state, 5, 201, "rock"));
    standOn(h, 5, 200);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.advance(12);
    h.release("down");
    const cut = h.debug.snapshot(h.state).miner.drilling;
    expect(cut).not.toBeNull();
    expect(Object.keys(cut ?? {}).sort()).toEqual(
      ["col", "dir", "progress", "row"].sort(),
    );
    expect(cut?.progress).toBeGreaterThan(0);
    expect(cut?.progress).toBeLessThanOrEqual(1);

    h.pose((debug, state) => debug.setHull(state, 0));
    await h.seconds(2);
    const summary = h.debug.snapshot(h.state).summary;
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
    h.pose((debug, state) => debug.setOreTile(state, 5, 200, "ferron"));
    expect(Object.keys(h.debug.tileAt(h.state, 5, 200)).sort()).toEqual(
      ["band", "health", "kind", "material", "maxHealth", "ore"].sort(),
    );
  });

  it("rests every field the current screen does not use", () => {
    const snapshot = h.debug.snapshot(h.state);
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
    h.pose((debug, state) => debug.setTile(state, 5, 200, "rock"));
    const read = h.debug.tileAt(h.state, 5, 200);
    expect(read.kind).toBe("rock");
    expect(read.band).toBe("rockbed");
    expect(read.health).toBe(BAND_HEALTH.rockbed);
    expect(read.maxHealth).toBe(BAND_HEALTH.rockbed);
    const off = h.debug.tileAt(h.state, -1, 200);
    expect(off.kind).toBe("bedrock");
    expect(off.band).toBeNull();
    expect(off.health).toBeNull();
  });

  it("finds the cell of a kind nearest the miner", () => {
    standOn(h, 5, 200);
    h.pose((debug, state) => debug.setTile(state, 9, 200, "stone"));
    h.pose((debug, state) => debug.setTile(state, 20, 200, "stone"));
    expect(h.debug.findTile(h.state, "stone")).toEqual({ col: 9, row: 200 });
    expect(h.debug.findTile(h.state, "gas")).toBeNull();
  });

  it("reports each building's footprint resting on the ground line", () => {
    const boxes = h.debug.buildings(h.state);
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      expect(box.y + box.h).toBe(SURFACE_Y);
      expect(box.w).toBeGreaterThan(0);
    }
  });
});

describe("restoring the world", () => {
  it("empties the mine without banking or detonating anything", () => {
    h.pose((debug, state) => debug.setOreTile(state, 5, 200, "ferron"));
    h.pose((debug, state) => debug.setTile(state, 6, 200, "gas"));
    h.pose((debug, state) => debug.clearMine(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(h.debug.tileAt(h.state, 5, 200).kind).toBe("tunnel");
    expect(h.debug.tileAt(h.state, 6, 200).kind).toBe("tunnel");
    expect(snapshot.cargo.slotsUsed).toBe(0);
    expect(snapshot.miner.hull).toBe(HULL_TIERS[0]);
  });

  it("empties the bay and the supplies without earning Credits", () => {
    h.pose((debug, state) => debug.setCargo(state, "aurite", 4));
    h.pose((debug, state) => debug.setItemCount(state, "dynamite", 3));
    h.pose((debug, state) => debug.clearCargo(state));
    h.pose((debug, state) => debug.clearItems(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.cargo.slotsUsed).toBe(0);
    expect(snapshot.credits).toBe(0);
    expect(snapshot.items.dynamite).toBe(0);
  });

  it("generates a fresh mine and leaves the miner and the holdings alone", () => {
    h.pose((debug, state) => debug.setCredits(state, 700));
    standOn(h, 5, 200);
    const before = h.debug.snapshot(h.state).miner;
    h.pose((debug, state) => debug.generateMine(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.credits).toBe(700);
    expect(snapshot.miner.x).toBe(before.x);
    expect(snapshot.miner.y).toBe(before.y);
    expect(h.debug.findTile(h.state, "ore")).not.toBeNull();
  });

  it("poses each Quantum Teleporter draw on its own, within its bounds, and clears it with null", () => {
    expect(h.debug.snapshot(h.state).nextTeleportHeight).toBeNull();
    expect(h.debug.snapshot(h.state).nextTeleportSpeed).toBeNull();
    h.pose((debug, state) =>
      debug.setNextTeleportHeight(state, TELEPORT_HEIGHT_TILES_MAX),
    );
    expect(h.debug.snapshot(h.state).nextTeleportHeight).toBe(
      TELEPORT_HEIGHT_TILES_MAX,
    );
    expect(h.debug.snapshot(h.state).nextTeleportSpeed).toBeNull();
    h.pose((debug, state) =>
      debug.setNextTeleportSpeed(state, TELEPORT_SPEED_MIN),
    );
    expect(h.debug.snapshot(h.state).nextTeleportSpeed).toBe(
      TELEPORT_SPEED_MIN,
    );
    h.pose((debug, state) => debug.setNextTeleportHeight(state, null));
    expect(h.debug.snapshot(h.state).nextTeleportHeight).toBeNull();
    expect(h.debug.snapshot(h.state).nextTeleportSpeed).toBe(
      TELEPORT_SPEED_MIN,
    );
    expect(() =>
      h.debug.setNextTeleportHeight(h.state, TELEPORT_HEIGHT_TILES_MAX + 1),
    ).toThrow();
    expect(() =>
      h.debug.setNextTeleportSpeed(h.state, TELEPORT_SPEED_MIN - 1),
    ).toThrow();
  });

  it("consumes a posed Quantum Teleporter outcome with the use, and clears it on reset", () => {
    h.pose((debug, state) =>
      debug.setItemCount(state, "quantum-teleporter", 1),
    );
    h.pose((debug, state) => debug.setNextTeleportHeight(state, 2));
    h.pose((debug, state) => debug.setNextTeleportSpeed(state, 300));
    h.pose((debug, state) => debug.useItem(state, "quantum-teleporter"));
    const placed = h.debug.snapshot(h.state);
    expect((SURFACE_Y - (placed.miner.y + MINER_H)) / TILE).toBeCloseTo(2, 9);
    expect(placed.miner.vy).toBe(300);
    expect(placed.nextTeleportHeight).toBeNull();
    expect(placed.nextTeleportSpeed).toBeNull();

    h.pose((debug, state) => debug.setNextTeleportHeight(state, 5));
    h.pose((debug, state) => debug.reset(state));
    expect(h.debug.snapshot(h.state).nextTeleportHeight).toBeNull();
  });

  it("restores the whole observable state to its title value", () => {
    h.pose((debug, state) => debug.setCredits(state, 900));
    h.pose((debug, state) => debug.setTier(state, "drill", 4));
    h.pose((debug, state) => debug.setCargo(state, "ferron", 5));
    h.pose((debug, state) => debug.setCoreCarried(state, true));
    h.pose((debug, state) => debug.setCameraLead(state, CAM_LEAD_MAX));
    h.pose((debug, state) => debug.setMinerTravel(state, false));
    h.pose((debug, state) => debug.reset(state));
    const snapshot = h.debug.snapshot(h.state);
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
    h.pose((debug, state) => debug.setTile(state, 5, 300, "rock"));
    const read = h.debug.tileAt(h.state, 5, 300);
    expect(read.kind).toBe("rock");
    expect(read.health).toBe(BAND_HEALTH.deepstone);
  });

  it("sets an ore cell and a material node", () => {
    h.pose((debug, state) => debug.setOreTile(state, 5, 200, "argenite"));
    expect(h.debug.tileAt(h.state, 5, 200).ore).toBe("argenite");
    h.pose((debug, state) => debug.setMaterialTile(state, 6, 200, "resonite"));
    const read = h.debug.tileAt(h.state, 6, 200);
    expect(read.kind).toBe("material");
    expect(read.material).toBe("resonite");
  });

  it("poses a partly cut cell", () => {
    h.pose((debug, state) => debug.setTile(state, 5, 200, "rock"));
    h.pose((debug, state) => debug.setTileHealth(state, 5, 200, 3));
    expect(h.debug.tileAt(h.state, 5, 200).health).toBe(3);
    expect(() =>
      h.pose((debug, state) =>
        debug.setTileHealth(state, 5, 200, BAND_HEALTH.rockbed + 1),
      ),
    ).toThrow(RangeError);
  });

  it("refuses a health pose on a cell that is not minable", () => {
    expect(() =>
      h.pose((debug, state) => debug.setTileHealth(state, 5, 200, 1)),
    ).toThrow(RangeError);
  });

  it("places a jettisoned Core Sample with its timer running", () => {
    h.pose((debug, state) => debug.placeCoreSample(state, 7, 210));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.coreGround).toEqual({ col: 7, row: 210 });
    expect(snapshot.coreTimer).toBe(CORE_TIMER);
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(() =>
      h.pose((debug, state) => debug.placeCoreSample(state, 8, 210)),
    ).toThrow(RangeError);
  });

  it("refuses a cell outside the grid or on the camp row", () => {
    expect(() =>
      h.pose((debug, state) => debug.setTile(state, WORLD_COLS, 5, "rock")),
    ).toThrow(RangeError);
    expect(() =>
      h.pose((debug, state) => debug.setTile(state, 5, 0, "rock")),
    ).toThrow(RangeError);
  });
});

describe("posing the miner", () => {
  it("moves the miner alone and changes no cell", () => {
    h.pose((debug, state) => debug.setTile(state, 5, 200, "rock"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 5 * TILE, 200 * TILE),
    );
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.x).toBe(5 * TILE);
    expect(snapshot.miner.y).toBe(200 * TILE);
    expect(h.debug.tileAt(h.state, 5, 200).kind).toBe("rock");
  });

  it("sets the velocity, the facing, the fuel and the hull", () => {
    h.pose((debug, state) => debug.setMinerVelocity(state, -30, 90));
    h.pose((debug, state) => debug.setFacing(state, "west"));
    h.pose((debug, state) => debug.setFuel(state, 12));
    h.pose((debug, state) => debug.setHull(state, 34));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.vx).toBe(-30);
    expect(snapshot.miner.vy).toBe(90);
    expect(snapshot.miner.facing).toBe("west");
    expect(snapshot.miner.fuel).toBe(12);
    expect(snapshot.miner.hull).toBe(34);
    expect(() =>
      h.pose((debug, state) => debug.setFacing(state, "north" as "east")),
    ).toThrow(RangeError);
  });

  it("applies fuel and hull as given rather than clamping to the tier's maximum", () => {
    // specs/instrumentation.md, The operations: a bound that reads a live game
    // value is a rule rather than a domain, so the pose reaches what it names.
    const over = FUEL_TIERS[0] + 100;
    h.pose((debug, state) => debug.setFuel(state, over));
    expect(h.debug.snapshot(h.state).miner.fuel).toBe(over);
    const overHull = HULL_TIERS[0] + 5;
    h.pose((debug, state) => debug.setHull(state, overHull));
    expect(h.debug.snapshot(h.state).miner.hull).toBe(overHull);
    expect(() =>
      h.pose((debug, state) =>
        debug.setFuel(state, "full" as unknown as number),
      ),
    ).toThrow(RangeError);
  });

  it("holds each faculty on its own", () => {
    h.pose((debug, state) => debug.setMinerTravel(state, false));
    expect(h.debug.snapshot(h.state).miner.travel).toBe(false);
    expect(h.debug.snapshot(h.state).miner.drill).toBe(true);
    h.pose((debug, state) => debug.setMinerDrill(state, false));
    h.pose((debug, state) => debug.setMinerTravel(state, true));
    expect(h.debug.snapshot(h.state).miner.travel).toBe(true);
    expect(h.debug.snapshot(h.state).miner.drill).toBe(false);
  });
});

describe("posing the expedition", () => {
  it("sets the screen, the panel, and the highlighted item", () => {
    h.pose((debug, state) => debug.setScreen(state, "title"));
    h.pose((debug, state) => debug.setMenuIndex(state, 1));
    expect(h.debug.snapshot(h.state).menuIndex).toBe(1);
    expect(() =>
      h.pose((debug, state) => debug.setMenuIndex(state, 9)),
    ).toThrow(RangeError);
    h.pose((debug, state) => debug.setScreen(state, "in-mine"));
    h.pose((debug, state) => debug.setPanel(state, "supply-depot"));
    expect(h.debug.snapshot(h.state).panel).toBe("supply-depot");
    h.pose((debug, state) => debug.setPanel(state, null));
    expect(h.debug.snapshot(h.state).panel).toBeNull();
  });

  it("sets the mode, the world size, and with it coreRow", () => {
    h.pose((debug, state) => debug.setMode(state, "hardcore"));
    h.pose((debug, state) => debug.setWorldSize(state, "marathon"));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.mode).toBe("hardcore");
    expect(snapshot.worldSize).toBe("marathon");
    expect(snapshot.coreRow).toBe(coreRowFor("marathon"));
  });

  it("resizes the mine onto a deeper size instead of emptying it", () => {
    h.pose((debug, state) => debug.setWorldSize(state, "quick"));
    const was = coreRowFor("quick");
    h.pose((debug, state) => debug.setOreTile(state, 5, 100, "ferron"));
    h.pose((debug, state) => debug.setTileHealth(state, 5, 100, 1));
    const kept = h.debug.tileAt(h.state, 5, 100);

    h.pose((debug, state) => debug.setWorldSize(state, "marathon"));
    const now = coreRowFor("marathon");

    // The cell comes through with its own band, which the deeper mine no longer
    // computes for that row.
    expect(h.debug.tileAt(h.state, 5, 100)).toEqual(kept);
    expect(kept.band).toBe("rockbed");
    expect(h.debug.tileAt(h.state, 5, 900).kind).toBe("tunnel");
    expect(h.debug.tileAt(h.state, 0, 900).kind).toBe("bedrock");
    // One Core chamber, and it is the new deepest row.
    expect(h.debug.findTile(h.state, "core")).toEqual({
      col: CORE_COL,
      row: now,
    });
    expect(h.debug.tileAt(h.state, CORE_COL, was).kind).toBe("tunnel");
  });

  it("resizes the mine onto a shallower size, dropping the rows past it", () => {
    h.pose((debug, state) => debug.setWorldSize(state, "marathon"));
    h.pose((debug, state) => debug.generateMine(state));
    const kept = h.debug.tileAt(h.state, 5, 100);

    h.pose((debug, state) => debug.setWorldSize(state, "quick"));
    const now = coreRowFor("quick");

    expect(h.debug.tileAt(h.state, 5, 100)).toEqual(kept);
    expect(h.debug.tileAt(h.state, 5, 700).band).toBeNull();
    expect(h.debug.tileAt(h.state, CORE_COL, now).kind).toBe("core");
    expect(h.debug.tileAt(h.state, 5, now).kind).toBe("bedrock");
    expect(h.debug.snapshot(h.state).coreRow).toBe(now);
  });

  it("sets a tier, clamping the pools to the new maxima and charging nothing", () => {
    h.pose((debug, state) => debug.setTier(state, "fuel", 5));
    h.pose((debug, state) => debug.setFuel(state, FUEL_TIERS[4]));
    h.pose((debug, state) => debug.setTier(state, "fuel", 1));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.tiers.fuel).toBe(1);
    expect(snapshot.miner.fuel).toBe(FUEL_TIERS[0]);
    expect(snapshot.credits).toBe(0);
    expect(() =>
      h.pose((debug, state) => debug.setTier(state, "scanner", 4)),
    ).toThrow(RangeError);
  });

  it("sets the cargo past the slot cap and the satchel's materials", () => {
    h.pose((debug, state) => debug.setCargo(state, "ferron", 999));
    h.pose((debug, state) => debug.setMaterial(state, "cryenite", 2));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.cargo.ore.ferron).toBe(999);
    expect(snapshot.cargo.slotsUsed).toBe(999);
    expect(snapshot.satchel.cryenite).toBe(2);
  });

  it("carries and removes a Core Sample, and sets its timer", () => {
    h.pose((debug, state) => debug.setCoreCarried(state, true));
    expect(h.debug.snapshot(h.state).coreTimer).toBe(CORE_TIMER);
    expect(() =>
      h.pose((debug, state) => debug.setCoreCarried(state, true)),
    ).toThrow(RangeError);
    h.pose((debug, state) => debug.setCoreTimer(state, 12));
    expect(h.debug.snapshot(h.state).coreTimer).toBe(12);
    h.pose((debug, state) => debug.setCoreCarried(state, false));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(snapshot.coreTimer).toBeNull();
    expect(() =>
      h.pose((debug, state) => debug.setCoreTimer(state, 5)),
    ).toThrow(RangeError);
  });

  it("installs rocket components in the checklist's order", () => {
    h.pose((debug, state) => debug.setRocketInstalled(state, 3));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.rocket.installed).toEqual(
      ROCKET_COMPONENTS.slice(0, 3).map((component) => component.id),
    );
    expect(snapshot.rocket.nextComponent).toBe(ROCKET_COMPONENTS[3].id);
    expect(snapshot.credits).toBe(0);
  });

  it("marks a notice as fired without raising or dismissing a card", () => {
    h.pose((debug, state) => debug.setNoticeFired(state, "gas", true));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.noticesFired.gas).toBe(true);
    expect(snapshot.notice).toBeNull();
  });

  it("deletes the save slot", () => {
    standOn(h, 4, 1);
    h.pose((debug, state) => debug.save(state));
    expect(h.debug.snapshot(h.state).hasSave).toBe(true);
    h.pose((debug, state) => debug.clearSave(state));
    expect(h.debug.snapshot(h.state).hasSave).toBe(false);
  });
});

describe("the controls", () => {
  it("runs the game's own rules rather than posing an outcome", () => {
    h.pose((debug, state) => debug.setCargo(state, "ferron", 2));
    h.pose((debug, state) => debug.sell(state));
    const sold = h.debug.snapshot(h.state);
    expect(sold.cargo.slotsUsed).toBe(0);
    expect(sold.credits).toBeGreaterThan(0);
    h.pose((debug, state) => debug.setFuel(state, 10));
    h.pose((debug, state) => debug.buyFuel(state));
    expect(h.debug.snapshot(h.state).miner.fuel).toBeGreaterThan(10);
  });

  it("changes nothing when the game's own rules refuse", () => {
    h.pose((debug, state) => debug.setCredits(state, 0));
    h.pose((debug, state) => debug.buyUpgrade(state, "drill"));
    expect(h.debug.snapshot(h.state).tiers.drill).toBe(1);
    h.pose((debug, state) => debug.buyItem(state, "nanobots"));
    expect(h.debug.snapshot(h.state).items.nanobots).toBe(0);
  });

  it("acts from wherever the game stands rather than where a player would be", () => {
    // specs/instrumentation.md, The controls: the screen, the open panel, and
    // where the miner stands are a player's route and not the control's
    // conditions. The miner is posed deep in the mine, nowhere near the camp.
    standOn(h, 9, 200);
    h.pose((debug, state) => debug.setCargo(state, "ferron", 2));
    h.pose((debug, state) => debug.sell(state));
    expect(h.debug.snapshot(h.state).cargo.slotsUsed).toBe(0);
    expect(h.debug.snapshot(h.state).credits).toBeGreaterThan(0);

    h.pose((debug, state) => debug.save(state));
    expect(h.debug.snapshot(h.state).hasSave).toBe(true);

    h.pose((debug, state) => debug.setItemCount(state, "nanobots", 1));
    h.pose((debug, state) => debug.setHull(state, 1));
    h.pose((debug, state) => debug.useItem(state, "nanobots"));
    expect(h.debug.snapshot(h.state).items.nanobots).toBe(0);
  });

  it("jettisons the carried Sample onto the miner's cell, timer still running", () => {
    standOn(h, 9, 200);
    h.pose((debug, state) => debug.setCoreCarried(state, true));
    h.pose((debug, state) => debug.setCoreTimer(state, 40));
    h.pose((debug, state) => debug.jettison(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.satchel.coreSample).toBe(false);
    expect(snapshot.coreGround).toEqual({ col: 9, row: 199 });
    expect(snapshot.coreTimer).toBe(40);
  });

  it("fabricates the next component and refuses one it cannot pay for", () => {
    h.pose((debug, state) =>
      debug.setCredits(state, ROCKET_COMPONENTS[0].credits),
    );
    h.pose((debug, state) => debug.fabricate(state));
    expect(h.debug.snapshot(h.state).rocket.installed).toEqual([
      ROCKET_COMPONENTS[0].id,
    ]);
    h.pose((debug, state) => debug.fabricate(state));
    expect(h.debug.snapshot(h.state).rocket.installed).toHaveLength(1);
  });

  it("launches only once the rocket is complete", async () => {
    standOn(h, 4, 1);
    h.pose((debug, state) => debug.setRocketInstalled(state, 4));
    h.pose((debug, state) => debug.launch(state));
    await h.seconds(4);
    expect(h.debug.snapshot(h.state).screen).toBe("in-mine");
    h.pose((debug, state) => debug.setRocketInstalled(state, 5));
    h.pose((debug, state) => debug.launch(state));
    await h.seconds(4);
    expect(h.debug.snapshot(h.state).screen).toBe("victory");
  });
});

describe("what a pose leaves alone", () => {
  it("moves the miner into a solid cell and lets the game's own rules resolve it", async () => {
    h.pose((debug, state) => debug.setTile(state, 5, 200, "rock"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 5 * TILE, 200 * TILE),
    );
    h.pose((debug, state) => debug.setMinerDrill(state, false));
    expect(h.debug.tileAt(h.state, 5, 200).kind).toBe("rock");
    await h.seconds(0.5);
    // The collision resolver lifts it out; nothing was drilled.
    expect(h.debug.tileAt(h.state, 5, 200).kind).toBe("rock");
  });

  it("leaves the mute preference untouched across a reset", () => {
    expect(h.debug.snapshot(h.state).muted).toBe(false);
    h.pose((debug, state) => debug.reset(state));
    expect(h.debug.snapshot(h.state).muted).toBe(false);
    // Standing at the camp is what a fresh state opens at.
    expect(h.debug.snapshot(h.state).miner.y + MINER_H).toBe(SURFACE_Y);
  });
});
