// The debug surface's two standing rules (specs/instrumentation.md): an argument outside
// its stated domain fails loudly, and an operation standing for a player's control is
// refused rather than throwing wherever that control is refused.
//
// Every operation here is driven exactly as a caller drives it through the engine: a pose
// takes the current state and returns the next, which the little driver below stores, and
// a reading takes the state and returns what it read.

import { beforeEach, describe, expect, it } from "vitest";

import { noAssets } from "./assets";
import {
  createDebugApi,
  type FoundryDebugApi,
  type FoundrySnapshot,
} from "./debug";
import { createWorld } from "./sim";
import type { FoundryWorld } from "./types";

/** The state the surface poses, held the way the engine holds it. */
class Driver {
  private state: FoundryWorld;
  readonly api: FoundryDebugApi;

  constructor() {
    this.state = createWorld(noAssets());
    this.api = createDebugApi();
  }

  /** Run a pose and store what it returned, as `engine.apply` does. */
  apply(pose: (s: FoundryWorld) => FoundryWorld): void {
    this.state = pose(this.state);
  }

  /** Run a reading against the current state, as a caller does off `engine.state`. */
  read<T>(reading: (s: FoundryWorld) => T): T {
    return reading(this.state);
  }

  snapshot(): FoundrySnapshot {
    return this.api.snapshot(this.state);
  }
}

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

describe("the surface", () => {
  let d: Driver;
  let api: FoundryDebugApi;

  beforeEach(() => {
    d = new Driver();
    api = d.api;
    d.apply((s) => api.reset(s));
  });

  it("reports the version the specification fixes", () => {
    expect(api.version).toBe(4);
  });

  it("fails loudly on an argument outside its stated domain", () => {
    const s = d.read((x) => x);
    expect(() => api.setSpeed(s, 3)).toThrow(/one of 1, 2, 4, 8/);
    expect(() => api.setScreen(s, "nowhere")).toThrow(/screen to be one of/);
    expect(() => api.setMap(s, "elsewhere")).toThrow(/map to be one of/);
    expect(() => api.setDifficulty(s, "brutal")).toThrow(
      /difficulty to be one of/,
    );
    expect(() => api.setOverlay(s, "recipes", true)).toThrow(
      /overlay to be one of/,
    );
    expect(() => api.setRefinement(s, 9)).toThrow(
      /level to be a whole number in 0..8/,
    );
    expect(() => api.setStamps(s, 6)).toThrow(/n to be a whole number in 0..5/);
    expect(() => api.setNextRoll(s, "sprocket", 1)).toThrow(
      /type to be one of/,
    );
    expect(() => api.setNextRoll(s, "coil", 6)).toThrow(
      /quality to be a whole number in 1..5/,
    );
    expect(() => api.placeComponent(s, "coil", 1, 49, 0)).toThrow(
      /col to be a whole number in 0..48/,
    );
    expect(() => api.placeBlocker(s, 0, 32)).toThrow(
      /row to be a whole number in 0..31/,
    );
    expect(() => api.spawnUnit(s, "gremlin")).toThrow(/type to be one of/);
    expect(() => api.setCharge(s, -5)).toThrow(/amount to be at least 0/);
    expect(() => api.setPaused(s, "yes" as unknown as boolean)).toThrow(
      /to be a boolean/,
    );
  });

  it("fails loudly on a subject no live structure or unit carries", () => {
    d.apply((s) => api.startRun(s));
    const missing = d.read((x) => x);
    expect(() => api.select(missing, 999)).toThrow(
      /an id a live structure carries/,
    );
    expect(() => api.keep(missing, 999)).toThrow(
      /an id a live structure carries/,
    );
    expect(() => api.dismantle(missing, 999)).toThrow(
      /an id a live structure carries/,
    );
    expect(() => api.setUnitHp(missing, 999, 1)).toThrow(
      /an id a live unit carries/,
    );
    expect(() => api.setUnitFrozen(missing, 999, true)).toThrow(
      /an id a live unit carries/,
    );
    expect(() => api.setComboLevel(missing, 999, 1)).toThrow(
      /an id a combination tower carries/,
    );

    d.apply((s) => api.placeComponent(s, "capacitor", 1, 10, 10));
    d.apply((s) => api.placeComponent(s, "regulator", 1, 14, 10));
    const now = d.read((x) => x);
    const [component, regulator] = d.snapshot().structures;
    // A base component is no combination tower, and a Regulator no firing structure.
    expect(() => api.setComboLevel(now, component!.id, 1)).toThrow(
      /an id a combination tower carries/,
    );
    expect(() => api.setTargeting(now, regulator!.id, "first")).toThrow(
      /an id a firing structure carries/,
    );
  });

  it("refuses a player's control rather than throwing", () => {
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.placeComponent(s, "capacitor", 1, 10, 10));
    const id = d.snapshot().structures[0]!.id;
    // A standing component is no candidate, so keeping and downgrading are refused.
    expect(() => d.apply((s) => api.keep(s, id))).not.toThrow();
    expect(() => d.apply((s) => api.downgrade(s, id))).not.toThrow();
    expect(d.snapshot().phase).toBe("build");
    expect(d.snapshot().wave).toBe(0);
    // Charge is short, so refining is refused and nothing leaves the bank.
    d.apply((s) => api.setCharge(s, 0));
    d.apply((s) => api.upgradeQuality(s));
    expect(d.snapshot().refinement).toBe(0);
    expect(d.snapshot().charge).toBe(0);
    // The allowance is spent, so no rock lands.
    d.apply((s) => api.setStamps(s, 0));
    d.apply((s) => api.placeRock(s, 20, 20));
    expect(d.snapshot().structures).toHaveLength(1);
  });

  it("counts the live wave's own schedule (specs/instrumentation.md)", () => {
    d.apply((s) => api.startRun(s));
    // Off a wave, every type reads 0.
    for (const type of SPAWNABLE_TYPES) {
      expect(d.read((s) => api.waveCount(s, type))).toBe(0);
    }
    // The driver's hold opens a wave whose schedule is empty, so a unit released
    // through it is not a unit the wave counts.
    d.apply((s) => api.spawnUnit(s, "mote"));
    expect(d.snapshot().waveActive).toBe(true);
    expect(d.read((s) => api.waveCount(s, "mote"))).toBe(0);
    expect(() => d.read((s) => api.waveCount(s, "gremlin"))).toThrow(
      /type to be one of/,
    );

    // A wave the harvest launched counts what it will release, from the frame it
    // launched — and goes on counting a unit that has been swept away.
    d.apply((s) => api.reset(s));
    d.apply((s) => api.setDifficulty(s, "easy"));
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.setWave(s, 19));
    d.apply((s) => api.setNextRoll(s, "regulator", 1));
    d.apply((s) => api.placeRock(s, 10, 10));
    d.apply((s) => api.clearHeld(s));
    const stood = d.snapshot().structures;
    const candidate = stood[stood.length - 1]!.id;
    d.apply((s) => api.keep(s, candidate));
    expect(d.snapshot().wave).toBe(20);
    // Wave 20 of the 40-wave Easy run is a milestone and a multiple of four.
    expect(d.read((s) => api.waveCount(s, "dynamo"))).toBe(1);
    expect(d.read((s) => api.waveCount(s, "filament"))).toBeGreaterThan(0);
    expect(d.read((s) => api.waveCount(s, "overload"))).toBe(0);
    const motes = d.read((s) => api.waveCount(s, "mote"));
    d.apply((s) => api.clearUnits(s));
    expect(d.read((s) => api.waveCount(s, "mote"))).toBe(motes);
  });

  it("refuses to change the Overload Dynamo's health", () => {
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.spawnUnit(s, "overload"));
    const id = d.snapshot().units[0]!.id;
    const s = d.read((x) => x);
    expect(() => api.setUnitHp(s, id, 5)).toThrow(
      /a unit with depleting health/,
    );
    // It still takes a slow and a burn like any other unit.
    expect(() => d.apply((x) => api.setUnitSlow(x, id, 0.5, 1))).not.toThrow();
    expect(() => d.apply((x) => api.setUnitBurn(x, id, 4, 1))).not.toThrow();
  });

  it("reports every field a pose can set", () => {
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.setCharge(s, 77));
    d.apply((s) => api.setIntegrity(s, 9));
    d.apply((s) => api.setRefinement(s, 3));
    d.apply((s) => api.setWave(s, 12));
    d.apply((s) => api.setStamps(s, 2));
    d.apply((s) => api.setSpeed(s, 4));
    d.apply((s) => api.setPaused(s, true));
    d.apply((s) => api.setOverlay(s, "combos", true));
    d.apply((s) => api.setOverlay(s, "damage", true));
    d.apply((s) => api.setNextRoll(s, "choke", 2));
    const s = d.snapshot();
    expect(s.charge).toBe(77);
    expect(s.integrity).toBe(9);
    expect(s.refinement).toBe(3);
    expect(s.wave).toBe(12);
    expect(s.stampsLeft).toBe(2);
    expect(s.speed).toBe(4);
    expect(s.paused).toBe(true);
    expect(s.overlays).toEqual({ combos: true, damage: true });
    expect(s.nextRoll).toEqual({ type: "choke", quality: 2 });
    d.apply((x) => api.clearNextRoll(x));
    expect(d.snapshot().nextRoll).toBeNull();
  });

  it("poses a unit's every faculty one operation at a time", () => {
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.setWave(s, 5));
    d.apply((s) => api.spawnUnit(s, "slug"));
    const id = d.snapshot().units[0]!.id;
    d.apply((s) => api.setUnitPosition(s, id, 300, 400));
    d.apply((s) => api.setUnitWaypoint(s, id, 4));
    d.apply((s) => api.setUnitHp(s, id, 7));
    d.apply((s) => api.setUnitSlow(s, id, 0.25, 3));
    d.apply((s) => api.setUnitBurn(s, id, 6, 2));
    d.apply((s) => api.setUnitFrozen(s, id, true));
    const u = d.snapshot().units.find((x) => x.id === id)!;
    expect(u.x).toBe(300);
    expect(u.y).toBe(400);
    expect(u.waypointIndex).toBe(4);
    expect(u.hp).toBe(7);
    expect(u.slowFactor).toBeCloseTo(0.75, 10);
    expect(u.burnDps).toBe(6);
    expect(u.frozen).toBe(true);
    expect(u.speed).toBeCloseTo(u.baseSpeed * 0.75, 10);
    // Health is bounded by the unit's own maximum, which a pose never changes.
    const now = d.read((x) => x);
    expect(() => api.setUnitHp(now, id, u.maxHp + 1)).toThrow(
      /hp to be in 1\.\./,
    );
    expect(() => api.setUnitHp(now, id, 0)).toThrow(/hp to be in 1\.\./);
  });

  it("empties the yard of each kind on demand", () => {
    d.apply((s) => api.startRun(s));
    d.apply((s) => api.placeComponent(s, "capacitor", 1, 10, 10));
    d.apply((s) => api.placeBlocker(s, 14, 10));
    d.apply((s) => api.placeCombo(s, "nullcore", 18, 10));
    expect(d.snapshot().structures).toHaveLength(3);
    d.apply((s) => api.spawnUnit(s, "mote"));
    expect(d.snapshot().units).toHaveLength(1);
    d.apply((s) => api.clearStructures(s));
    d.apply((s) => api.clearUnits(s));
    d.apply((s) => api.clearProjectiles(s));
    const s = d.snapshot();
    expect(s.structures).toHaveLength(0);
    expect(s.units).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.selected).toBeNull();
    expect(s.combineSet).toEqual([]);
    // Nothing leaked and nothing was killed, so neither counter moved.
    expect(s.integrity).toBe(20);
  });

  it("leaves the state it was handed exactly as it was", () => {
    d.apply((s) => api.startRun(s));
    const before = d.read((x) => x);
    const charge = before.charge;
    const next = api.setCharge(before, 999);
    expect(next.charge).toBe(999);
    // The pose built a world of its own, so the one it was handed never moved.
    expect(before.charge).toBe(charge);
  });

  it("reports the panel, menu, and status controls the game draws", () => {
    // On the title screen the menu is reported and the bar is not.
    expect(d.read((s) => api.menuButtons(s)).map((c) => c.action)).toEqual([
      "salvage",
      "howto",
    ]);
    expect(d.read((s) => api.statusControls(s))).toEqual([]);
    expect(d.read((s) => api.panelButtons(s))).toEqual([]);

    d.apply((s) => api.startRun(s));
    // On the yard the bar is reported, with each control's own live value, and the menu
    // is not.
    const bar = d.read((s) => api.statusControls(s));
    expect(bar.map((c) => c.action)).toEqual([
      "combos",
      "damage",
      "speed",
      "pause",
      "mute",
    ]);
    expect(bar.find((c) => c.action === "speed")!.state).toBe(1);
    expect(bar.find((c) => c.action === "pause")!.state).toBe(false);
    expect(d.read((s) => api.menuButtons(s))).toEqual([]);

    // With a candidate selected the inspector offers its fixed slots. The last stamp
    // of the allowance is spent first, so the press does not re-arm and the panel shows
    // the inspector rather than the rock that would otherwise be back on the cursor.
    d.apply((s) => api.setStamps(s, 1));
    d.apply((s) => api.setNextRoll(s, "coil", 3));
    d.apply((s) => api.placeRock(s, 10, 10));
    const id = d.snapshot().structures[0]!.id;
    d.apply((s) => api.select(s, id));
    const panel = d.read((s) => api.panelButtons(s)).map((c) => c.action);
    expect(panel).toContain("keep");
    expect(panel).toContain("downgrade");
    expect(panel).toContain("combine");
    expect(panel).toContain("dismantle");
    // A candidate does not fire, so it carries no targeting control at all.
    expect(panel).not.toContain("targeting");
  });

  it("reports a rectangle a press at its center would activate", () => {
    d.apply((s) => api.startRun(s));
    for (const c of d.read((s) => api.statusControls(s))) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1280);
      expect(c.y + c.h).toBeLessThanOrEqual(720);
    }
  });
});
