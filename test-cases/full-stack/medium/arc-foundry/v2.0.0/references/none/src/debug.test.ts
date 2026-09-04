// The debug surface's two standing rules (specs/instrumentation.md): an argument outside
// its stated domain fails loudly, and an operation standing for a player's control is
// refused rather than throwing wherever that control is refused.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { installDebugApi, type FoundryDebugApi } from "./debug";
import { Game } from "./sim";

function install(): { api: FoundryDebugApi; game: Game; frames: number[] } {
  const game = new Game();
  const frames: number[] = [];
  const holder: { __foundry?: FoundryDebugApi } = {};
  vi.stubGlobal("window", holder);
  installDebugApi({
    game,
    clock: { autoStep: true },
    runFrame: (seconds) => {
      frames.push(seconds);
      game.syncView();
      game.fixedStep(seconds);
    },
    refreshControls: () => {},
    pointerMove: (x, y) => {
      game.pointerX = x;
      game.pointerY = y;
    },
    pointerDown: () => {},
    pointerUp: () => {},
    keyDown: () => {},
    keyUp: () => {},
    panelButtons: () => [],
    pressControls: () => [],
    menuButtons: () => [],
    statusControls: () => [],
  });
  return { api: holder.__foundry!, game, frames };
}

describe("the surface", () => {
  let api: FoundryDebugApi;
  let game: Game;
  let frames: number[];

  beforeEach(() => {
    ({ api, game, frames } = install());
    api.reset();
  });

  it("is installed under the case's own global, at version 3", () => {
    expect(api).toBeDefined();
    expect(api.version).toBe(3);
  });

  it("runs the frames advance asks for, each worth its share of the span", () => {
    frames.length = 0;
    api.advance(1, 4);
    expect(frames).toEqual([0.25, 0.25, 0.25, 0.25]);
    frames.length = 0;
    api.advance(0.5);
    expect(frames).toEqual([0.5]);
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
    expect(() => api.advance(-1)).toThrow(/seconds to be at least 0/);
    expect(() => api.setCharge(-5)).toThrow(/amount to be at least 0/);
    expect(() => api.setAutoStep("yes" as unknown as boolean)).toThrow(
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
    const id = api.snapshot().structures[0]!.id;
    // A base component is no combination tower, and a Regulator no firing structure.
    expect(() => api.setComboLevel(id, 1)).toThrow(
      /an id a combination tower carries/,
    );
    api.placeComponent("regulator", 1, 14, 10);
    const reg = api.snapshot().structures[1]!.id;
    expect(() => api.setTargeting(reg, "first")).toThrow(
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
    api.pointerMove(400, 300);
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
    expect(s.pointer).toEqual({ x: 400, y: 300 });
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
    expect(game.kills).toBe(0);
  });
});
