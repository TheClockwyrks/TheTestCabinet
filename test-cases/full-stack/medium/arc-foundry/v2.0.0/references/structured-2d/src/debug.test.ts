// The debug surface's standing rules (specs/instrumentation.md): every operation acts on
// the LIVE world at the call, an argument outside its stated domain fails loudly, and an
// operation standing for a player's control is refused rather than throwing wherever
// that control is refused.
//
// The surface is read back off `engine.debug` — the one way a caller reaches it — and
// every check below drives it with no frame advanced between calls, so what they prove
// is the immediate-effect contract. The keyboard-and-frames wiring around the game is
// covered in engine.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FOUNDRY_DEBUG_VERSION } from "./constants";
import type { FoundryDebugApi } from "./debug";
import { createHarness, type Harness } from "./harness";

/** Every argument `spawnUnit` and `waveCount` take (specs/instrumentation.md). */
const SPAWNABLE_TYPES = [
  "mote",
  "spark",
  "slug",
  "cluster",
  "filament",
  "dynamo",
  "overload",
];

let h: Harness;
let api: FoundryDebugApi;

beforeEach(async () => {
  h = await createHarness();
  api = h.debug;
  api.reset();
});

afterEach(() => {
  h.dispose();
});

describe("the surface", () => {
  it("is the object initialize returned, held at engine.debug", () => {
    expect(h.engine.debug).toBe(api);
    expect(api.version).toBe(FOUNDRY_DEBUG_VERSION);
  });

  it("fails loudly on an argument outside its stated domain", () => {
    expect(() => api.setSpeed(3)).toThrow(/one of 1, 2, 4, 8/);
    expect(() => api.setScreen("nowhere")).toThrow(/screen to be one of/);
    expect(() => api.setMap("elsewhere")).toThrow(/map to be one of/);
    expect(() => api.setDifficulty("brutal")).toThrow(
      /difficulty to be one of/,
    );
    expect(() => api.setOverlay("recipes", true)).toThrow(
      /overlay to be one of/,
    );
    expect(() => api.setRefinement(9)).toThrow(
      /level to be a whole number in 0..8/,
    );
    expect(() => api.setStamps(6)).toThrow(/n to be a whole number in 0..5/);
    expect(() => api.setNextRoll("sprocket", 1)).toThrow(/type to be one of/);
    expect(() => api.setNextRoll("coil", 6)).toThrow(
      /quality to be a whole number in 1..5/,
    );
    expect(() => api.placeComponent("coil", 1, 49, 0)).toThrow(
      /col to be a whole number in 0..48/,
    );
    expect(() => api.placeBlocker(0, 32)).toThrow(
      /row to be a whole number in 0..31/,
    );
    expect(() => api.spawnUnit("gremlin")).toThrow(/type to be one of/);
    expect(() => api.setCharge(-5)).toThrow(/amount to be at least 0/);
    expect(() => api.setPaused("yes" as unknown as boolean)).toThrow(
      /to be a boolean/,
    );
  });

  it("fails loudly on a subject no live structure or unit carries", () => {
    api.startRun();
    expect(() => api.select(999)).toThrow(/an id a live structure carries/);
    expect(() => api.keep(999)).toThrow(/an id a live structure carries/);
    expect(() => api.dismantle(999)).toThrow(/an id a live structure carries/);
    expect(() => api.setUnitHp(999, 1)).toThrow(/an id a live unit carries/);
    expect(() => api.setUnitFrozen(999, true)).toThrow(
      /an id a live unit carries/,
    );
    expect(() => api.setComboLevel(999, 1)).toThrow(
      /an id a combination tower carries/,
    );

    api.placeComponent("capacitor", 1, 10, 10);
    api.placeComponent("regulator", 1, 14, 10);
    const [component, regulator] = api.snapshot().structures;
    // A base component is no combination tower, and a Regulator no firing structure.
    expect(() => api.setComboLevel(component!.id, 1)).toThrow(
      /an id a combination tower carries/,
    );
    expect(() => api.setTargeting(regulator!.id, "first")).toThrow(
      /an id a firing structure carries/,
    );
  });

  it("refuses a player's control rather than throwing", () => {
    api.startRun();
    api.placeComponent("capacitor", 1, 10, 10);
    const id = api.snapshot().structures[0]!.id;
    // A standing component is no candidate, so keeping and downgrading are refused.
    expect(() => api.keep(id)).not.toThrow();
    expect(() => api.downgrade(id)).not.toThrow();
    expect(api.snapshot().phase).toBe("build");
    expect(api.snapshot().wave).toBe(0);
    // Charge is short, so refining is refused and nothing leaves the bank.
    api.setCharge(0);
    api.upgradeQuality();
    expect(api.snapshot().refinement).toBe(0);
    expect(api.snapshot().charge).toBe(0);
    // The allowance is spent, so no rock lands.
    api.setStamps(0);
    api.placeRock(20, 20);
    expect(api.snapshot().structures).toHaveLength(1);
  });

  it("counts the live wave's own schedule (specs/instrumentation.md)", () => {
    api.setDifficulty("easy");
    api.startRun();
    // Off a wave, every type reads 0.
    for (const type of SPAWNABLE_TYPES) expect(api.waveCount(type)).toBe(0);
    // The driver's hold opens a wave whose schedule is empty, so a unit released
    // through it is not a unit the wave counts.
    api.spawnUnit("mote");
    expect(api.snapshot().waveActive).toBe(true);
    expect(api.waveCount("mote")).toBe(0);
    expect(() => api.waveCount("gremlin")).toThrow(/type to be one of/);

    // A wave the harvest launched counts what it will release, from the frame it
    // launched — and goes on counting a unit that has been swept away.
    api.reset();
    api.setDifficulty("easy");
    api.startRun();
    api.setWave(19);
    api.setNextRoll("regulator", 1);
    api.placeRock(10, 10);
    api.clearHeld();
    const stood = api.snapshot().structures;
    api.keep(stood[stood.length - 1]!.id);
    expect(api.snapshot().wave).toBe(20);
    // Wave 20 of the 40-wave Easy run is a milestone and a multiple of four.
    expect(api.waveCount("dynamo")).toBe(1);
    expect(api.waveCount("filament")).toBeGreaterThan(0);
    expect(api.waveCount("overload")).toBe(0);
    const motes = api.waveCount("mote");
    api.clearUnits();
    expect(api.waveCount("mote")).toBe(motes);
  });

  it("refuses to change the Overload Dynamo's health", () => {
    api.startRun();
    api.spawnUnit("overload");
    const id = api.snapshot().units[0]!.id;
    expect(() => api.setUnitHp(id, 5)).toThrow(/a unit with depleting health/);
    // It still takes a slow and a burn like any other unit.
    expect(() => api.setUnitSlow(id, 0.5, 1)).not.toThrow();
    expect(() => api.setUnitBurn(id, 4, 1)).not.toThrow();
  });

  it("reports every field a pose can set", () => {
    api.startRun();
    api.setCharge(77);
    api.setIntegrity(9);
    api.setRefinement(3);
    api.setWave(12);
    api.setStamps(2);
    api.setSpeed(4);
    api.setPaused(true);
    api.setOverlay("combos", true);
    api.setOverlay("damage", true);
    api.setNextRoll("choke", 2);
    const s = api.snapshot();
    expect(s.charge).toBe(77);
    expect(s.integrity).toBe(9);
    expect(s.refinement).toBe(3);
    expect(s.wave).toBe(12);
    expect(s.stampsLeft).toBe(2);
    expect(s.speed).toBe(4);
    expect(s.paused).toBe(true);
    expect(s.overlays).toEqual({ combos: true, damage: true });
    expect(s.nextRoll).toEqual({ type: "choke", quality: 2 });
    api.clearNextRoll();
    expect(api.snapshot().nextRoll).toBeNull();
  });

  it("poses a unit's every faculty one operation at a time", () => {
    api.startRun();
    api.setWave(5);
    api.spawnUnit("slug");
    const id = api.snapshot().units[0]!.id;
    api.setUnitPosition(id, 300, 400);
    api.setUnitWaypoint(id, 4);
    api.setUnitHp(id, 7);
    api.setUnitSlow(id, 0.25, 3);
    api.setUnitBurn(id, 6, 2);
    api.setUnitFrozen(id, true);
    const u = api.snapshot().units.find((x) => x.id === id)!;
    expect(u.x).toBe(300);
    expect(u.y).toBe(400);
    expect(u.waypointIndex).toBe(4);
    expect(u.hp).toBe(7);
    expect(u.slowFactor).toBeCloseTo(0.75, 10);
    expect(u.burnDps).toBe(6);
    expect(u.frozen).toBe(true);
    expect(u.speed).toBeCloseTo(u.baseSpeed * 0.75, 10);
    // Health is bounded by the unit's own maximum, which a pose never changes.
    expect(() => api.setUnitHp(id, u.maxHp + 1)).toThrow(/hp to be in 1\.\./);
    expect(() => api.setUnitHp(id, 0)).toThrow(/hp to be in 1\.\./);
  });

  it("empties the yard of each kind on demand", () => {
    api.startRun();
    api.placeComponent("capacitor", 1, 10, 10);
    api.placeBlocker(14, 10);
    api.placeCombo("nullcore", 18, 10);
    expect(api.snapshot().structures).toHaveLength(3);
    api.spawnUnit("mote");
    expect(api.snapshot().units).toHaveLength(1);
    api.clearStructures();
    api.clearUnits();
    api.clearProjectiles();
    const s = api.snapshot();
    expect(s.structures).toHaveLength(0);
    expect(s.units).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.selected).toBeNull();
    expect(s.combineSet).toEqual([]);
    // Nothing leaked and nothing was killed, so neither counter moved.
    expect(s.integrity).toBe(20);
  });

  it("acts on the live world at the call, with no frame advanced", () => {
    api.startRun();
    api.setCharge(999);
    // The world the engine is holding moved, and it moved at the call rather than on
    // the next frame.
    expect(h.state.charge).toBe(999);
    expect(api.snapshot().charge).toBe(999);
    expect(h.engine.frame().count).toBe(0);
  });

  it("follows the live world rather than the state it first saw", async () => {
    api.startRun();
    api.setCharge(42);
    await h.step(3);
    // A reading taken after frames have run reports the same object the engine advanced.
    expect(api.snapshot().charge).toBe(h.state.charge);
    expect(api.snapshot().simTime).toBe(h.state.simTime);
  });

  it("reports the panel, menu, and status controls the game draws", () => {
    // On the title screen the menu is reported and the bar is not.
    expect(api.menuButtons().map((c) => c.action)).toEqual([
      "salvage",
      "howto",
    ]);
    expect(api.statusControls()).toEqual([]);
    expect(api.panelButtons()).toEqual([]);

    api.startRun();
    // On the yard the bar is reported, with each control's own live value, and the menu
    // is not.
    const bar = api.statusControls();
    expect(bar.map((c) => c.action)).toEqual([
      "combos",
      "damage",
      "speed",
      "pause",
      "mute",
    ]);
    expect(bar.find((c) => c.action === "speed")!.state).toBe(1);
    expect(bar.find((c) => c.action === "pause")!.state).toBe(false);
    expect(api.menuButtons()).toEqual([]);

    // With a candidate selected the inspector offers its fixed slots. The last stamp
    // of the allowance is spent first, so the press does not re-arm and the panel shows
    // the inspector rather than the rock that would otherwise be back on the cursor.
    api.setStamps(1);
    api.setNextRoll("coil", 3);
    api.placeRock(10, 10);
    const id = api.snapshot().structures[0]!.id;
    api.select(id);
    const panel = api.panelButtons().map((c) => c.action);
    expect(panel).toContain("keep");
    expect(panel).toContain("downgrade");
    expect(panel).toContain("combine");
    expect(panel).toContain("dismantle");
    // A candidate does not fire, so it carries no targeting control at all.
    expect(panel).not.toContain("targeting");
  });

  it("reports a rectangle a press at its center would activate", () => {
    api.startRun();
    for (const c of api.statusControls()) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1280);
      expect(c.y + c.h).toBeLessThanOrEqual(720);
    }
  });
});
