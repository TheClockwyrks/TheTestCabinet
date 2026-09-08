// The simulation: the press and the harvest, combining, firing and the status effects,
// the economy, the finale, and the poses the debug surface commits through.
//
// Every check drives the real game over a world of its own for a counted span, so none of
// it needs a canvas, a clock, or a browser.

import { beforeEach, describe, expect, it } from "vitest";

import { snapshot } from "./debug";
import {
  FIXED_STEP,
  addToCombineSet,
  advance,
  applyBurn,
  applySlow,
  armNextCrit,
  armNextRoll,
  clearNextCrit,
  board,
  clearStructures,
  clearUnits,
  combineFrom,
  createWorld,
  tryDowngrade,
  tryKeep,
  placeBlocker,
  placeCombo,
  placeComponent,
  tryPlaceStamp,
  pullPress,
  candidates,
  tryRemoveStructure,
  resetWorld,
  rollPress,
  select,
  setCharge,
  setDifficulty,
  setIntegrity,
  setMap,
  setOverlay,
  setPaused,
  setRefinement,
  setSpeed,
  setUnitFrozen,
  setUnitPosition,
  setUnitWaypoint,
  setWave,
  spawnUnit,
  startRun,
} from "./sim";
import { footprintCenter, tileCenter } from "./tables";
import type { FoundryState } from "./state";

/** A run posed on an empty yard with nothing but what a check puts on it. */
function openRun(): FoundryState {
  const w = createWorld();
  resetWorld(w);
  startRun(w);
  clearStructures(w);
  clearUnits(w);
  return w;
}

/** The world's collector tile, in logical units. */
function collectorAt(w: FoundryState): { x: number; y: number } {
  const chain = board(w).chain;
  const node = chain[chain.length - 1]!;
  return tileCenter(node.col, node.row);
}

describe("a run opens", () => {
  it("on its first build phase with the stated allocation", () => {
    const w = createWorld();
    resetWorld(w);
    startRun(w);
    const s = snapshot(w);
    expect(s.screen).toBe("playing");
    expect(s.phase).toBe("build");
    expect(s.charge).toBe(10);
    expect(s.integrity).toBe(20);
    expect(s.refinement).toBe(0);
    expect(s.wave).toBe(0);
    expect(s.stampsLeft).toBe(5);
    expect(s.structures).toHaveLength(0);
    expect(s.mazeRating).toBe(0);
  });

  it("and reset returns every reported field to its title value", () => {
    const w = openRun();
    setCharge(w, 500);
    setWave(w, 9);
    setSpeed(w, 4);
    setOverlay(w, "combos", true);
    placeBlocker(w, 10, 10);
    w.pointerX = 123;
    w.pointerY = 456;
    w.muted = true;
    resetWorld(w);
    const s = snapshot(w);
    expect(s.screen).toBe("title");
    expect(s.phase).toBeNull();
    expect(s.menuIndex).toBe(0);
    expect(s.map).toBe("substation");
    expect(s.difficulty).toBe("medium");
    expect(s.charge).toBe(10);
    expect(s.wave).toBe(0);
    expect(s.speed).toBe(1);
    expect(s.overlays).toEqual({ combos: false, damage: false });
    expect(s.structures).toHaveLength(0);
    expect(s.simTime).toBe(0);
    // The mute bit and the pointer belong to the runtime, so reset leaves both alone.
    expect(s.muted).toBe(true);
    expect(s.pointer).toEqual({ x: 123, y: 456 });
  });
});

describe("the scrap-press", () => {
  it("rolls on the drop, spends one stamp, and re-arms while the allowance lasts", () => {
    const w = openRun();
    armNextRoll(w, "coil", 4);
    pullPress(w);
    tryPlaceStamp(w, 10, 10);
    const s = snapshot(w);
    const last = s.structures[s.structures.length - 1]!;
    expect(last.kind).toBe("candidate");
    expect(last.type).toBe("coil");
    expect(last.quality).toBe(4);
    expect(s.stampsLeft).toBe(4);
    expect(s.nextRoll).toBeNull();
    expect(w.holding).toBe(true);
  });

  it("rolls the press on its own without landing anything", () => {
    const w = openRun();
    armNextRoll(w, "coil", 4);
    pullPress(w);
    setRefinement(w, 8);
    const before = JSON.stringify(snapshot(w));
    for (let i = 0; i < 50; i++) {
      const roll = rollPress(w);
      expect(roll.quality).toBeGreaterThanOrEqual(2);
      expect(roll.quality).toBeLessThanOrEqual(5);
    }
    expect(JSON.stringify(snapshot(w))).toBe(before);
  });

  it("refuses an illegal drop without spending a stamp", () => {
    const w = openRun();
    const wp = board(w).map.waypoints[0]!;
    pullPress(w);
    tryPlaceStamp(w, wp.col, wp.row);
    const s = snapshot(w);
    expect(s.structures).toHaveLength(0);
    expect(s.stampsLeft).toBe(5);
  });

  it("rerolls a blocker the rock lands on", () => {
    const w = openRun();
    const blocker = placeBlocker(w, 10, 10)!;
    armNextRoll(w, "emitter", 2);
    tryPlaceStamp(w, 10, 10);
    const s = snapshot(w);
    expect(s.structures).toHaveLength(1);
    expect(s.structures[0]!.kind).toBe("candidate");
    expect(s.structures[0]!.type).toBe("emitter");
    expect(s.structures[0]!.id).not.toBe(blocker.id);
    expect(s.stampsLeft).toBe(4);
  });

  it("biases the roll with refinement and nothing else", () => {
    const w = openRun();
    // At R0 the press rolls Scrap alone.
    for (let i = 0; i < 5; i++) tryPlaceStamp(w, 4 + i * 3, 10);
    for (const s of snapshot(w).structures) expect(s.quality).toBe(1);
    setRefinement(w, 8);
    const odds = snapshot(w).qualityOdds;
    expect(odds[0]).toBe(0);
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe("the harvest", () => {
  it("hardens every other candidate into a blocker and starts the wave", () => {
    const w = openRun();
    armNextRoll(w, "capacitor", 1);
    tryPlaceStamp(w, 4, 4);
    armNextRoll(w, "capacitor", 1);
    tryPlaceStamp(w, 8, 4);
    const kept = snapshot(w).structures[0]!.id;
    tryKeep(w, kept);
    const s = snapshot(w);
    expect(s.phase).toBe("wave");
    expect(s.wave).toBe(1);
    const byId = new Map(s.structures.map((x) => [x.id, x]));
    expect(byId.get(kept)!.kind).toBe("component");
    const other = s.structures.find((x) => x.id !== kept)!;
    expect(other.kind).toBe("blocker");
    expect(other.type).toBeNull();
  });

  it("drops a downgraded candidate one rung and starts the wave", () => {
    const w = openRun();
    armNextRoll(w, "capacitor", 4);
    tryPlaceStamp(w, 4, 4);
    const id = snapshot(w).structures[0]!.id;
    tryDowngrade(w, id);
    const s = snapshot(w);
    expect(s.structures[0]!.kind).toBe("component");
    expect(s.structures[0]!.quality).toBe(3);
    expect(s.phase).toBe("wave");
  });

  it("refuses to downgrade a Scrap candidate", () => {
    const w = openRun();
    armNextRoll(w, "capacitor", 1);
    tryPlaceStamp(w, 4, 4);
    const id = snapshot(w).structures[0]!.id;
    tryDowngrade(w, id);
    const s = snapshot(w);
    expect(s.structures[0]!.kind).toBe("candidate");
    expect(s.phase).toBe("build");
  });
});

describe("combining", () => {
  it("folds a matching pair one rung up, leaving the consumed footprint walled", () => {
    const w = openRun();
    const a = placeComponent(w, "coil", 2, 4, 4)!;
    const b = placeComponent(w, "coil", 2, 8, 4)!;
    select(w, a.id);
    addToCombineSet(w, b.id);
    expect(combineFrom(w, a.id)).toBe(true);
    const s = snapshot(w);
    const result = s.structures.find((x) => x.id === a.id)!;
    expect(result.kind).toBe("component");
    expect(result.quality).toBe(3);
    expect(s.structures.find((x) => x.id === b.id)!.kind).toBe("blocker");
  });

  it("refuses a fold across types or across rungs", () => {
    const w = openRun();
    const a = placeComponent(w, "coil", 2, 4, 4)!;
    const b = placeComponent(w, "coil", 3, 8, 4)!;
    const c = placeComponent(w, "emitter", 2, 12, 4)!;
    select(w, a.id);
    addToCombineSet(w, b.id);
    expect(combineFrom(w, a.id)).toBe(false);
    select(w, null);
    select(w, a.id);
    addToCombineSet(w, c.id);
    expect(combineFrom(w, a.id)).toBe(false);
  });

  it("offers no fold at the top rung", () => {
    const w = openRun();
    const a = placeComponent(w, "coil", 5, 4, 4)!;
    const b = placeComponent(w, "coil", 5, 8, 4)!;
    select(w, a.id);
    addToCombineSet(w, b.id);
    expect(combineFrom(w, a.id)).toBe(false);
  });

  it("folds a recipe into its tower at the initiating footprint, at level zero", () => {
    const w = openRun();
    // The Fuse Cluster: a Scrap Regulator, Rectifier, and Arc-Node.
    const anchor = placeComponent(w, "regulator", 1, 4, 4)!;
    const b = placeComponent(w, "rectifier", 1, 8, 4)!;
    const c = placeComponent(w, "arcnode", 1, 12, 4)!;
    select(w, anchor.id);
    addToCombineSet(w, b.id);
    addToCombineSet(w, c.id);
    expect(combineFrom(w, anchor.id)).toBe(true);
    const s = snapshot(w);
    const tower = s.structures.find((x) => x.id === anchor.id)!;
    expect(tower.kind).toBe("combo");
    expect(tower.type).toBe("fusecluster");
    expect(tower.level).toBe(0);
    expect(tower.col).toBe(4);
    expect(tower.row).toBe(4);
    expect(s.structures.find((x) => x.id === b.id)!.kind).toBe("blocker");
    expect(s.structures.find((x) => x.id === c.id)!.kind).toBe("blocker");
  });

  it("leaves the phase running when it folds standing structures only", () => {
    const w = openRun();
    const a = placeComponent(w, "coil", 2, 4, 4)!;
    const b = placeComponent(w, "coil", 2, 8, 4)!;
    select(w, a.id);
    addToCombineSet(w, b.id);
    combineFrom(w, a.id);
    expect(snapshot(w).phase).toBe("build");
    expect(snapshot(w).wave).toBe(0);
  });
});

describe("firing", () => {
  let w: FoundryState;
  beforeEach(() => {
    w = openRun();
    setWave(w, 1);
  });

  it("removes health and credits the structure that fired", () => {
    const tower = placeComponent(w, "capacitor", 1, 20, 10)!;
    const center = footprintCenter(20, 10);
    const unit = spawnUnit(w, "slug")!;
    setUnitPosition(w, unit, center.x + 40, center.y);
    setUnitFrozen(unit, true);
    advance(w, 2);
    const s = snapshot(w);
    const t = s.structures.find((x) => x.id === tower.id)!;
    const u = s.units.find((x) => x.id === unit.id)!;
    expect(t.damageDealt).toBeGreaterThan(0);
    expect(u.hp).toBeLessThan(u.maxHp);
    expect(u.maxHp - u.hp).toBeCloseTo(t.damageDealt, 6);
  });

  it("lands the crit outcome armed for the next shot, and consumes it", () => {
    const tower = placeCombo(w, "slagdriver", 20, 10)!;
    const center = footprintCenter(20, 10);
    const unit = spawnUnit(w, "overload")!;
    setUnitPosition(w, unit, center.x + 40, center.y);
    setUnitFrozen(unit, true);
    const damage = snapshot(w).structures[0]!.damage;
    armNextCrit(w, tower.id, true);
    expect(snapshot(w).structures[0]!.nextCrit).toBe(true);
    let tallied = 0;
    while (tallied === 0) {
      advance(w, FIXED_STEP);
      tallied = snapshot(w).structures[0]!.damageDealt;
    }
    expect(tallied).toBeCloseTo(damage * 2, 6);
    expect(snapshot(w).structures[0]!.nextCrit).toBeNull();
    armNextCrit(w, tower.id, false);
    let next = tallied;
    while (next === tallied) {
      advance(w, FIXED_STEP);
      next = snapshot(w).structures[0]!.damageDealt;
    }
    expect(next - tallied).toBeCloseTo(damage, 6);
  });

  it("clears an armed crit outcome without firing", () => {
    const tower = placeCombo(w, "slagdriver", 20, 10)!;
    armNextCrit(w, tower.id, true);
    clearNextCrit(w, tower.id);
    const t = snapshot(w).structures[0]!;
    expect(t.nextCrit).toBeNull();
    expect(t.damageDealt).toBe(0);
  });

  it("holds fire with nothing in range", () => {
    const tower = placeComponent(w, "capacitor", 1, 20, 10)!;
    const center = footprintCenter(20, 10);
    const unit = spawnUnit(w, "slug")!;
    setUnitPosition(w, unit, center.x + 400, center.y);
    setUnitFrozen(unit, true);
    advance(w, 2);
    expect(
      snapshot(w).structures.find((x) => x.id === tower.id)!.damageDealt,
    ).toBe(0);
    expect(snapshot(w).projectiles).toHaveLength(0);
  });

  it("holds a unit's travel without touching any other faculty", () => {
    const unit = spawnUnit(w, "mote")!;
    const at = { x: unit.x, y: unit.y };
    setUnitFrozen(unit, true);
    applySlow(w, unit, 0.5, 10);
    advance(w, 3);
    const u = snapshot(w).units.find((x) => x.id === unit.id)!;
    expect(u.x).toBe(at.x);
    expect(u.y).toBe(at.y);
    expect(u.frozen).toBe(true);
    // The slow still runs, against the simulation clock.
    expect(u.slowFactor).toBeCloseTo(0.5, 10);
    expect(u.slowUntil).toBeCloseTo(10, 6);
  });

  it("applies the strongest slow and refreshes its duration", () => {
    const unit = spawnUnit(w, "mote")!;
    setUnitFrozen(unit, true);
    applySlow(w, unit, 0.4, 1);
    applySlow(w, unit, 0.2, 5);
    let u = snapshot(w).units[0]!;
    expect(u.slowFactor).toBeCloseTo(0.6, 10);
    expect(u.slowUntil).toBeCloseTo(5, 6);
    advance(w, 6);
    u = snapshot(w).units[0]!;
    expect(u.slowFactor).toBe(1);
    expect(u.speed).toBeCloseTo(u.baseSpeed, 6);
  });

  it("burns for its stated rate over its stated span", () => {
    const unit = spawnUnit(w, "slug")!;
    setUnitFrozen(unit, true);
    const before = snapshot(w).units[0]!.hp;
    applyBurn(w, unit, 4, 2, 0);
    advance(w, 2);
    const after = snapshot(w).units[0]!.hp;
    expect(before - after).toBeCloseTo(8, 1);
    // Past its span the burn stops.
    advance(w, 2);
    expect(snapshot(w).units[0]!.hp).toBeCloseTo(after, 6);
  });

  it("keeps the strongest burn rate when a weaker one lands", () => {
    const unit = spawnUnit(w, "slug")!;
    setUnitFrozen(unit, true);
    applyBurn(w, unit, 10, 1, 0);
    applyBurn(w, unit, 3, 4, 0);
    const u = snapshot(w).units[0]!;
    expect(u.burnDps).toBe(10);
    expect(u.burnUntil).toBeCloseTo(4, 6);
  });

  it("buffs a structure inside an aura and no structure outside it", () => {
    // A Scrap Regulator's aura reaches 90 units and adds a tenth.
    placeComponent(w, "regulator", 1, 20, 10);
    const near = placeComponent(w, "capacitor", 1, 23, 10)!;
    const far = placeComponent(w, "capacitor", 1, 40, 10)!;
    const s = snapshot(w);
    // The buffed figure is not rounded.
    expect(s.structures.find((x) => x.id === near.id)!.damage).toBeCloseTo(
      6 * 1.1,
      10,
    );
    expect(s.structures.find((x) => x.id === far.id)!.damage).toBe(6);
  });

  it("never lets an aura buff its own source", () => {
    const reg = placeComponent(w, "regulator", 5, 20, 10)!;
    placeComponent(w, "regulator", 5, 23, 10);
    const r = snapshot(w).structures.find((x) => x.id === reg.id)!;
    // A Regulator does not fire, so it carries no damage to buff either way.
    expect(r.damage).toBe(0);
    expect(r.auraRadius).toBe(114);
  });
});

describe("the economy", () => {
  it("pays a kill its bounty the instant it dies", () => {
    const w = openRun();
    setWave(w, 1);
    setCharge(w, 0);
    const tower = placeComponent(w, "discharge", 5, 20, 10)!;
    const center = footprintCenter(20, 10);
    const unit = spawnUnit(w, "mote")!;
    setUnitPosition(w, unit, center.x + 30, center.y);
    setUnitFrozen(unit, true);
    // A second unit well out of range keeps the wave live, so the reading is the bounty
    // alone rather than the bounty plus the wave-clear bonus.
    const bystander = spawnUnit(w, "slug")!;
    setUnitPosition(w, bystander, center.x + 600, center.y);
    setUnitFrozen(bystander, true);
    advance(w, 3);
    expect(snapshot(w).units.map((u) => u.id)).toEqual([bystander.id]);
    // A Mote's bounty is one.
    expect(snapshot(w).charge).toBe(1);
    expect(snapshot(w).structures.find((x) => x.id === tower.id)!.kills).toBe(
      1,
    );
  });

  it("costs a leak its integrity and never regenerates it", () => {
    const w = openRun();
    setWave(w, 1);
    const unit = spawnUnit(w, "slug")!;
    const at = collectorAt(w);
    setUnitWaypoint(w, unit, 7);
    setUnitPosition(w, unit, at.x, at.y);
    advance(w, 0.5);
    // A Slug costs two Grid Integrity.
    expect(snapshot(w).integrity).toBe(18);
    advance(w, 5);
    expect(snapshot(w).integrity).toBe(18);
  });

  it("ends the run the moment integrity reaches zero", () => {
    const w = openRun();
    setWave(w, 1);
    setIntegrity(w, 1);
    const unit = spawnUnit(w, "mote")!;
    const at = collectorAt(w);
    setUnitWaypoint(w, unit, 7);
    setUnitPosition(w, unit, at.x, at.y);
    advance(w, 0.5);
    expect(snapshot(w).screen).toBe("overload");
    expect(snapshot(w).mazeRating).toBe(0);
  });
});

describe("the clock", () => {
  it("reaches the same state however a span is divided into steps", () => {
    const a = openRun();
    const b = openRun();
    setWave(a, 4);
    setWave(b, 4);
    spawnUnit(a, "mote");
    spawnUnit(b, "mote");
    for (let i = 0; i < 60; i++) advance(a, FIXED_STEP);
    advance(b, 1);
    expect(snapshot(a).units[0]!.x).toBeCloseTo(snapshot(b).units[0]!.x, 9);
    expect(snapshot(a).simTime).toBeCloseTo(snapshot(b).simTime, 9);
  });

  it("stops dead under the in-place pause", () => {
    const w = openRun();
    setWave(w, 1);
    const unit = spawnUnit(w, "mote")!;
    advance(w, 0.5);
    const at = snapshot(w).units[0]!.x;
    setPaused(w, true);
    advance(w, 2);
    expect(snapshot(w).units[0]!.x).toBe(at);
    expect(snapshot(w).simTime).toBeCloseTo(0.5, 6);
    setPaused(w, false);
    advance(w, 0.5);
    expect(snapshot(w).units.find((u) => u.id === unit.id)!.x).toBeGreaterThan(
      at,
    );
  });
});

describe("the spawner hold", () => {
  it("keeps the yard to exactly what the surface released", () => {
    const w = openRun();
    setWave(w, 1);
    spawnUnit(w, "mote");
    advance(w, 5);
    const s = snapshot(w);
    expect(s.phase).toBe("wave");
    expect(s.units.length).toBeLessThanOrEqual(1);
  });

  it("clears the held wave and opens the next build phase when the yard empties", () => {
    const w = openRun();
    setWave(w, 1);
    setCharge(w, 0);
    spawnUnit(w, "mote");
    clearUnits(w);
    advance(w, FIXED_STEP * 2);
    const s = snapshot(w);
    expect(s.phase).toBe("build");
    // Clearing pays the ordinary wave-clear bonus for the wave the run is on.
    expect(s.charge).toBe(10);
    expect(s.stampsLeft).toBe(5);
  });
});

describe("the finale", () => {
  it("tallies every point of damage instead of removing health", () => {
    const w = openRun();
    setWave(w, 1);
    const tower = placeComponent(w, "discharge", 5, 20, 10)!;
    const center = footprintCenter(20, 10);
    const boss = spawnUnit(w, "overload")!;
    setUnitPosition(w, boss, center.x + 30, center.y);
    setUnitFrozen(boss, true);
    const hp = snapshot(w).units[0]!.hp;
    advance(w, 4);
    const s = snapshot(w);
    const u = s.units.find((x) => x.id === boss.id)!;
    expect(u.invincible).toBe(true);
    expect(u.hp).toBe(hp);
    expect(s.mazeRating).toBeGreaterThan(0);
    expect(s.mazeRating).toBeCloseTo(
      s.structures.find((x) => x.id === tower.id)!.damageDealt,
      6,
    );
    expect(s.phase).toBe("finale");
  });

  it("walks the chain at its own speed and costs no integrity when it grounds out", () => {
    const w = openRun();
    setWave(w, 1);
    const boss = spawnUnit(w, "overload")!;
    expect(snapshot(w).units[0]!.baseSpeed).toBe(55);
    const at = collectorAt(w);
    setUnitWaypoint(w, boss, 7);
    setUnitPosition(w, boss, at.x, at.y);
    advance(w, 0.5);
    const s = snapshot(w);
    expect(s.integrity).toBe(20);
    expect(s.screen).toBe("victory");
  });
});

describe("the maze", () => {
  it("only ever lengthens as the yard is built on", () => {
    const w = openRun();
    let last = snapshot(w).mazeLength;
    expect(last).toBeGreaterThan(0);
    for (let col = 6; col < 40; col += 4) {
      if (placeBlocker(w, col, 8)) {
        const now = snapshot(w).mazeLength;
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        last = now;
      }
    }
  });

  it("reopens a dismantled structure's tiles", () => {
    const w = openRun();
    const before = snapshot(w).mazeLength;
    const b = placeBlocker(w, 6, 8)!;
    tryRemoveStructure(w, b.id);
    expect(snapshot(w).mazeLength).toBeCloseTo(before, 9);
    expect(snapshot(w).structures).toHaveLength(0);
  });

  it("flies a Filament straight over every wall", () => {
    const w = openRun();
    setWave(w, 1);
    for (let col = 4; col <= 44; col += 2) placeBlocker(w, col, 8);
    const flyer = spawnUnit(w, "filament")!;
    expect(flyer.flies).toBe(true);
    const before = { x: flyer.x, y: flyer.y };
    advance(w, 1);
    const u = snapshot(w).units.find((x) => x.id === flyer.id);
    expect(u).toBeDefined();
    expect(Math.hypot(u!.x - before.x, u!.y - before.y)).toBeCloseTo(85, 0);
  });
});

describe("the maps and difficulties", () => {
  it("opens a run on the map and the difficulty last chosen", () => {
    const w = createWorld();
    resetWorld(w);
    setMap(w, "transformer");
    setDifficulty(w, "easy");
    startRun(w);
    const s = snapshot(w);
    expect(s.map).toBe("transformer");
    expect(s.difficulty).toBe("easy");
    expect(s.totalWaves).toBe(40);
    expect(s.waypoints).toHaveLength(6);
  });
});

describe("a whole run", () => {
  /** The first anchor on the grid a structure may stand at, or `null` when the yard is full. */
  function freeAnchor(w: FoundryState): { col: number; row: number } | null {
    const b = board(w);
    for (let row = 0; row <= 31; row += 2) {
      for (let col = 0; col <= 48; col += 2) {
        if (b.canPlace(col, row, w.structures, w.units)) return { col, row };
      }
    }
    return null;
  }

  it("plays every wave of a campaign, then the finale, to the victory screen", () => {
    // A run played to the end, wave by wave, through the game's own rules alone: no
    // pose decides an outcome, and every wave is composed, released, walked, fired at,
    // and cleared for real. The yard is stood up with apex structures and its integrity
    // held at full, because what is checked is that the campaign RESOLVES rather than
    // whether this particular maze is good enough to survive forty waves.
    const w = createWorld();
    resetWorld(w);
    setDifficulty(w, "easy");
    startRun(w);
    let level = 0;
    while (snapshot(w).screen === "playing" && level < 60) {
      setIntegrity(w, 20);
      if (level < 14) {
        for (let i = 0; i < 3; i++) {
          const at = freeAnchor(w);
          if (at) placeComponent(w, "discharge", 5, at.col, at.row);
        }
      }
      for (let i = 0; i < 5; i++) {
        const at = freeAnchor(w);
        if (at) tryPlaceStamp(w, at.col, at.row);
      }
      const rolls = candidates(w);
      if (rolls.length === 0) break;
      // Committing the harvest is what sends the wave; there is no send control.
      tryKeep(w, rolls[0]!.id);
      for (let t = 0; t < 600 && snapshot(w).phase !== "build"; t++) {
        advance(w, 1);
        if (snapshot(w).screen !== "playing") break;
      }
      level++;
    }
    const s = snapshot(w);
    expect(s.wave).toBe(40);
    expect(s.screen).toBe("victory");
    // The finale ran, so the run carries a Maze Rating.
    expect(s.mazeRating).toBeGreaterThan(0);
  }, 120_000);
});
