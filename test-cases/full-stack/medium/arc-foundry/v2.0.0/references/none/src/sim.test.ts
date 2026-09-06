// The simulation: the press and the harvest, combining, firing and the status effects, the
// economy, and the debug surface's own poses. Every check drives the real game over its own
// clock for a counted span, so none of it needs a browser.

import { beforeEach, describe, expect, it } from "vitest";

import { DIFFICULTY, FIXED_STEP, footprintCenter, mapById } from "./constants";
import { Game } from "./sim";

/** Advance `seconds` of simulation time in whole fixed steps. */
function advance(game: Game, seconds: number): void {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < steps; i++) {
    game.syncView();
    game.fixedStep(FIXED_STEP);
  }
}

/** A run posed on an empty yard with nothing but what a check puts on it. */
function openRun(): Game {
  const game = new Game();
  game.debugReset();
  game.startRun();
  game.clearStructures();
  game.clearUnits();
  return game;
}

describe("a run opens", () => {
  it("on its first build phase with the stated allocation", () => {
    const game = new Game();
    game.debugReset();
    game.startRun();
    const s = game.debugSnapshot();
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
    const game = openRun();
    game.setCharge(500);
    game.setWave(9);
    game.setSpeed(4);
    game.setOverlay("combos", true);
    game.placeBlocker(10, 10);
    game.pointerX = 123;
    game.pointerY = 456;
    game.muted = true;
    game.debugReset();
    const s = game.debugSnapshot();
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
    const game = openRun();
    game.armNextRoll("coil", 4);
    game.pullPress();
    game.placeStamp(10, 10);
    const s = game.debugSnapshot();
    const last = s.structures[s.structures.length - 1]!;
    expect(last.kind).toBe("candidate");
    expect(last.type).toBe("coil");
    expect(last.quality).toBe(4);
    expect(s.stampsLeft).toBe(4);
    expect(s.nextRoll).toBeNull();
    expect(game.holding).toBe(true);
  });

  it("rolls the press on its own without landing anything", () => {
    const game = openRun();
    game.armNextRoll("coil", 4);
    game.pullPress();
    game.setRefinement(8);
    const before = JSON.stringify(game.debugSnapshot());
    for (let i = 0; i < 50; i++) {
      const roll = game.rollPress();
      expect(game.debugSnapshot().structures.map((x) => x.type)).not.toContain(
        undefined,
      );
      expect(roll.quality).toBeGreaterThanOrEqual(2);
      expect(roll.quality).toBeLessThanOrEqual(5);
    }
    expect(JSON.stringify(game.debugSnapshot())).toBe(before);
  });

  it("refuses an illegal drop without spending a stamp", () => {
    const game = openRun();
    const wp = game.board.map.waypoints[0]!;
    game.pullPress();
    game.placeStamp(wp.col, wp.row);
    const s = game.debugSnapshot();
    expect(s.structures).toHaveLength(0);
    expect(s.stampsLeft).toBe(5);
  });

  it("rerolls a blocker the rock lands on", () => {
    const game = openRun();
    const blocker = game.placeBlocker(10, 10)!;
    game.armNextRoll("emitter", 2);
    game.placeStamp(10, 10);
    const s = game.debugSnapshot();
    expect(s.structures).toHaveLength(1);
    expect(s.structures[0]!.kind).toBe("candidate");
    expect(s.structures[0]!.type).toBe("emitter");
    expect(s.structures[0]!.id).not.toBe(blocker.id);
    expect(s.stampsLeft).toBe(4);
  });

  it("biases the roll with refinement and nothing else", () => {
    const game = openRun();
    // At R0 the press rolls Scrap alone.
    for (let i = 0; i < 5; i++) game.placeStamp(4 + i * 3, 10);
    for (const s of game.debugSnapshot().structures) expect(s.quality).toBe(1);
    game.setRefinement(8);
    const odds = game.debugSnapshot().qualityOdds;
    expect(odds[0]).toBe(0);
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe("the harvest", () => {
  it("hardens every other candidate into a blocker and starts the wave", () => {
    const game = openRun();
    game.armNextRoll("capacitor", 1);
    game.placeStamp(4, 4);
    game.armNextRoll("capacitor", 1);
    game.placeStamp(8, 4);
    const kept = game.debugSnapshot().structures[0]!.id;
    game.keep(kept);
    const s = game.debugSnapshot();
    expect(s.phase).toBe("wave");
    expect(s.wave).toBe(1);
    const byId = new Map(s.structures.map((x) => [x.id, x]));
    expect(byId.get(kept)!.kind).toBe("component");
    const other = s.structures.find((x) => x.id !== kept)!;
    expect(other.kind).toBe("blocker");
    expect(other.type).toBeNull();
  });

  it("drops a downgraded candidate one tier and starts the wave", () => {
    const game = openRun();
    game.armNextRoll("capacitor", 4);
    game.placeStamp(4, 4);
    const id = game.debugSnapshot().structures[0]!.id;
    game.downgrade(id);
    const s = game.debugSnapshot();
    expect(s.structures[0]!.kind).toBe("component");
    expect(s.structures[0]!.quality).toBe(3);
    expect(s.phase).toBe("wave");
  });

  it("refuses to downgrade a Scrap candidate", () => {
    const game = openRun();
    game.armNextRoll("capacitor", 1);
    game.placeStamp(4, 4);
    const id = game.debugSnapshot().structures[0]!.id;
    game.downgrade(id);
    const s = game.debugSnapshot();
    expect(s.structures[0]!.kind).toBe("candidate");
    expect(s.phase).toBe("build");
  });
});

describe("combining", () => {
  it("folds a matching pair one rung up, leaving the consumed footprint walled", () => {
    const game = openRun();
    const a = game.placeComponent("coil", 2, 4, 4)!;
    const b = game.placeComponent("coil", 2, 8, 4)!;
    game.select(a.id);
    game.addToCombineSet(b.id);
    expect(game.debugCombine(a.id)).toBe(true);
    const s = game.debugSnapshot();
    const result = s.structures.find((x) => x.id === a.id)!;
    expect(result.kind).toBe("component");
    expect(result.quality).toBe(3);
    expect(s.structures.find((x) => x.id === b.id)!.kind).toBe("blocker");
  });

  it("refuses a fold across types or across tiers", () => {
    const game = openRun();
    const a = game.placeComponent("coil", 2, 4, 4)!;
    const b = game.placeComponent("coil", 3, 8, 4)!;
    const c = game.placeComponent("emitter", 2, 12, 4)!;
    game.select(a.id);
    game.addToCombineSet(b.id);
    expect(game.debugCombine(a.id)).toBe(false);
    game.select(null);
    game.select(a.id);
    game.addToCombineSet(c.id);
    expect(game.debugCombine(a.id)).toBe(false);
  });

  it("offers no fold at the top rung", () => {
    const game = openRun();
    const a = game.placeComponent("coil", 5, 4, 4)!;
    const b = game.placeComponent("coil", 5, 8, 4)!;
    game.select(a.id);
    game.addToCombineSet(b.id);
    expect(game.debugCombine(a.id)).toBe(false);
  });

  it("folds a recipe into its tower at the initiating footprint, at level zero", () => {
    const game = openRun();
    // The Fuse Cluster: regulator@1 + rectifier@1 + arcnode@1.
    const anchor = game.placeComponent("regulator", 1, 4, 4)!;
    const b = game.placeComponent("rectifier", 1, 8, 4)!;
    const c = game.placeComponent("arcnode", 1, 12, 4)!;
    game.select(anchor.id);
    game.addToCombineSet(b.id);
    game.addToCombineSet(c.id);
    expect(game.debugCombine(anchor.id)).toBe(true);
    const s = game.debugSnapshot();
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
    const game = openRun();
    const a = game.placeComponent("coil", 2, 4, 4)!;
    const b = game.placeComponent("coil", 2, 8, 4)!;
    game.select(a.id);
    game.addToCombineSet(b.id);
    game.debugCombine(a.id);
    expect(game.debugSnapshot().phase).toBe("build");
    expect(game.debugSnapshot().wave).toBe(0);
  });
});

describe("firing", () => {
  let game: Game;
  beforeEach(() => {
    game = openRun();
    game.setWave(1);
  });

  it("removes health and credits the structure that fired", () => {
    const tower = game.placeComponent("capacitor", 1, 20, 10)!;
    const centre = footprintCenter(20, 10);
    const unit = game.debugSpawn("slug")!;
    game.setUnitPosition(unit, centre.x + 40, centre.y);
    game.setUnitFrozen(unit, true);
    advance(game, 2);
    const s = game.debugSnapshot();
    const t = s.structures.find((x) => x.id === tower.id)!;
    const u = s.units.find((x) => x.id === unit.id)!;
    expect(t.damageDealt).toBeGreaterThan(0);
    expect(u.hp).toBeLessThan(u.maxHp);
    expect(u.maxHp - u.hp).toBeCloseTo(t.damageDealt, 6);
  });

  it("lands the crit outcome armed for the next shot, and consumes it", () => {
    const tower = game.placeCombo("slagdriver", 20, 10)!;
    const centre = footprintCenter(20, 10);
    const unit = game.debugSpawn("overload")!;
    game.setUnitPosition(unit, centre.x + 40, centre.y);
    game.setUnitFrozen(unit, true);
    const damage = game.debugSnapshot().structures[0]!.damage;
    game.armNextCrit(tower.id, true);
    expect(game.debugSnapshot().structures[0]!.nextCrit).toBe(true);
    let tallied = 0;
    while (tallied === 0) {
      advance(game, FIXED_STEP);
      tallied = game.debugSnapshot().structures[0]!.damageDealt;
    }
    expect(tallied).toBeCloseTo(damage * 2, 6);
    expect(game.debugSnapshot().structures[0]!.nextCrit).toBeNull();
    game.armNextCrit(tower.id, false);
    let next = tallied;
    while (next === tallied) {
      advance(game, FIXED_STEP);
      next = game.debugSnapshot().structures[0]!.damageDealt;
    }
    expect(next - tallied).toBeCloseTo(damage, 6);
  });

  it("clears an armed crit outcome without firing", () => {
    const tower = game.placeCombo("slagdriver", 20, 10)!;
    game.armNextCrit(tower.id, true);
    game.clearNextCrit(tower.id);
    const t = game.debugSnapshot().structures[0]!;
    expect(t.nextCrit).toBeNull();
    expect(t.damageDealt).toBe(0);
  });

  it("holds fire with nothing in range", () => {
    const tower = game.placeComponent("capacitor", 1, 20, 10)!;
    const centre = footprintCenter(20, 10);
    const unit = game.debugSpawn("slug")!;
    game.setUnitPosition(unit, centre.x + 400, centre.y);
    game.setUnitFrozen(unit, true);
    advance(game, 2);
    const t = game.debugSnapshot().structures.find((x) => x.id === tower.id)!;
    expect(t.damageDealt).toBe(0);
    expect(game.debugSnapshot().projectiles).toHaveLength(0);
  });

  it("holds a unit's travel without touching any other faculty", () => {
    const unit = game.debugSpawn("mote")!;
    const at = { x: unit.x, y: unit.y };
    game.setUnitFrozen(unit, true);
    game.setUnitSlow(unit, 0.5, 10);
    advance(game, 3);
    const u = game.debugSnapshot().units.find((x) => x.id === unit.id)!;
    expect(u.x).toBe(at.x);
    expect(u.y).toBe(at.y);
    expect(u.frozen).toBe(true);
    // The slow still runs, and its clock still ticks down against the simulation clock.
    expect(u.slowFactor).toBeCloseTo(0.5, 10);
    expect(u.slowUntil).toBeCloseTo(10, 6);
  });

  it("applies the strongest slow and refreshes its duration", () => {
    const unit = game.debugSpawn("mote")!;
    game.setUnitFrozen(unit, true);
    game.setUnitSlow(unit, 0.4, 1);
    game.setUnitSlow(unit, 0.2, 5);
    let u = game.debugSnapshot().units[0]!;
    expect(u.slowFactor).toBeCloseTo(0.6, 10);
    expect(u.slowUntil).toBeCloseTo(5, 6);
    advance(game, 6);
    u = game.debugSnapshot().units[0]!;
    expect(u.slowFactor).toBe(1);
    expect(u.speed).toBeCloseTo(u.baseSpeed, 6);
  });

  it("burns for its stated rate over its stated span", () => {
    const unit = game.debugSpawn("slug")!;
    game.setUnitFrozen(unit, true);
    const before = game.debugSnapshot().units[0]!.hp;
    game.setUnitBurn(unit, 4, 2);
    advance(game, 2);
    const after = game.debugSnapshot().units[0]!.hp;
    expect(before - after).toBeCloseTo(8, 1);
    // Past its span the burn stops.
    advance(game, 2);
    expect(game.debugSnapshot().units[0]!.hp).toBeCloseTo(after, 6);
  });

  it("keeps the strongest burn rate when a weaker one lands", () => {
    const unit = game.debugSpawn("slug")!;
    game.setUnitFrozen(unit, true);
    game.setUnitBurn(unit, 10, 1);
    game.setUnitBurn(unit, 3, 4);
    const u = game.debugSnapshot().units[0]!;
    expect(u.burnDps).toBe(10);
    expect(u.burnUntil).toBeCloseTo(4, 6);
  });

  it("buffs a structure inside an aura and no structure outside it", () => {
    // A Scrap Regulator's aura is 90 units and +10%.
    game.placeComponent("regulator", 1, 20, 10);
    const near = game.placeComponent("capacitor", 1, 23, 10)!;
    const far = game.placeComponent("capacitor", 1, 40, 10)!;
    advance(game, 0);
    const s = game.debugSnapshot();
    const n = s.structures.find((x) => x.id === near.id)!;
    const f = s.structures.find((x) => x.id === far.id)!;
    // The buffed figure is not rounded.
    expect(n.damage).toBeCloseTo(6 * 1.1, 10);
    expect(f.damage).toBe(6);
  });

  it("never lets an aura buff its own source", () => {
    const reg = game.placeComponent("regulator", 5, 20, 10)!;
    game.placeComponent("regulator", 5, 23, 10);
    advance(game, 0);
    const r = game.debugSnapshot().structures.find((x) => x.id === reg.id)!;
    // A Regulator does not fire, so it carries no damage to buff either way.
    expect(r.damage).toBe(0);
    expect(r.auraRadius).toBe(114);
  });
});

describe("the economy", () => {
  it("pays a kill its bounty the instant it dies", () => {
    const game = openRun();
    game.setWave(1);
    game.setCharge(0);
    const tower = game.placeComponent("discharge", 5, 20, 10)!;
    const centre = footprintCenter(20, 10);
    const unit = game.debugSpawn("mote")!;
    game.setUnitPosition(unit, centre.x + 30, centre.y);
    game.setUnitFrozen(unit, true);
    // A second unit well out of range keeps the wave live, so the reading is the bounty
    // alone rather than the bounty plus the wave-clear bonus.
    const bystander = game.debugSpawn("slug")!;
    game.setUnitPosition(bystander, centre.x + 600, centre.y);
    game.setUnitFrozen(bystander, true);
    advance(game, 3);
    expect(game.debugSnapshot().units.map((u) => u.id)).toEqual([bystander.id]);
    // A Mote's bounty is 1.
    expect(game.debugSnapshot().charge).toBe(1);
    expect(
      game.debugSnapshot().structures.find((x) => x.id === tower.id)!.kills,
    ).toBe(1);
  });

  it("costs a leak its integrity and never regenerates it", () => {
    const game = openRun();
    game.setWave(1);
    const unit = game.debugSpawn("slug")!;
    const collector = game.board.chain[game.board.chain.length - 1]!;
    game.setUnitWaypoint(unit, 7);
    game.setUnitPosition(
      unit,
      collector.col * 20 + 10,
      56 + collector.row * 20 + 10,
    );
    advance(game, 0.5);
    // A Slug costs 2 Grid Integrity.
    expect(game.debugSnapshot().integrity).toBe(18);
    advance(game, 5);
    expect(game.debugSnapshot().integrity).toBe(18);
  });

  it("ends the run the moment integrity reaches zero", () => {
    const game = openRun();
    game.setWave(1);
    game.setIntegrity(1);
    const unit = game.debugSpawn("mote")!;
    const collector = game.board.chain[game.board.chain.length - 1]!;
    game.setUnitWaypoint(unit, 7);
    game.setUnitPosition(
      unit,
      collector.col * 20 + 10,
      56 + collector.row * 20 + 10,
    );
    advance(game, 0.5);
    expect(game.debugSnapshot().screen).toBe("overload");
    expect(game.debugSnapshot().mazeRating).toBe(0);
  });
});

describe("the clock", () => {
  it("reaches the same state however a span is divided into steps", () => {
    const a = openRun();
    const b = openRun();
    a.setWave(4);
    b.setWave(4);
    a.debugSpawn("mote");
    b.debugSpawn("mote");
    for (let i = 0; i < 60; i++) {
      a.syncView();
      a.fixedStep(FIXED_STEP);
    }
    advance(b, 1);
    expect(a.debugSnapshot().units[0]!.x).toBeCloseTo(
      b.debugSnapshot().units[0]!.x,
      9,
    );
    expect(a.debugSnapshot().simTime).toBeCloseTo(b.debugSnapshot().simTime, 9);
  });

  it("stops dead under the in-place pause", () => {
    const game = openRun();
    game.setWave(1);
    const unit = game.debugSpawn("mote")!;
    advance(game, 0.5);
    const at = game.debugSnapshot().units[0]!.x;
    game.setPaused(true);
    advance(game, 2);
    expect(game.debugSnapshot().units[0]!.x).toBe(at);
    expect(game.debugSnapshot().simTime).toBeCloseTo(0.5, 6);
    game.setPaused(false);
    advance(game, 0.5);
    expect(
      game.debugSnapshot().units.find((u) => u.id === unit.id)!.x,
    ).toBeGreaterThan(at);
  });
});

describe("the spawner hold", () => {
  it("keeps the yard to exactly what the surface released", () => {
    const game = openRun();
    game.setWave(1);
    game.debugSpawn("mote");
    advance(game, 5);
    const s = game.debugSnapshot();
    // Nothing else arrived, and the phase is a live wave.
    expect(s.phase).toBe("wave");
    expect(s.units.length).toBeLessThanOrEqual(1);
  });

  it("clears the held wave and opens the next build phase when the yard empties", () => {
    const game = openRun();
    game.setWave(1);
    game.setCharge(0);
    game.debugSpawn("mote");
    game.clearUnits();
    advance(game, FIXED_STEP * 2);
    const s = game.debugSnapshot();
    expect(s.phase).toBe("build");
    // Clearing pays the ordinary wave-clear bonus for the wave the run is on.
    expect(s.charge).toBe(10);
    expect(s.stampsLeft).toBe(5);
  });
});

describe("the finale", () => {
  it("tallies every point of damage instead of removing health", () => {
    const game = openRun();
    game.setWave(1);
    const tower = game.placeComponent("discharge", 5, 20, 10)!;
    const centre = footprintCenter(20, 10);
    const boss = game.debugSpawn("overload")!;
    game.setUnitPosition(boss, centre.x + 30, centre.y);
    game.setUnitFrozen(boss, true);
    const hp = game.debugSnapshot().units[0]!.hp;
    advance(game, 4);
    const s = game.debugSnapshot();
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
    const game = openRun();
    game.setWave(1);
    const boss = game.debugSpawn("overload")!;
    expect(game.debugSnapshot().units[0]!.baseSpeed).toBe(55);
    const collector = game.board.chain[game.board.chain.length - 1]!;
    game.setUnitWaypoint(boss, 7);
    game.setUnitPosition(
      boss,
      collector.col * 20 + 10,
      56 + collector.row * 20 + 10,
    );
    advance(game, 0.5);
    const s = game.debugSnapshot();
    expect(s.integrity).toBe(20);
    expect(s.screen).toBe("victory");
  });
});

describe("the maze", () => {
  it("only ever lengthens as the yard is built on", () => {
    const game = openRun();
    let last = game.debugSnapshot().mazeLength;
    expect(last).toBeGreaterThan(0);
    for (let col = 6; col < 40; col += 4) {
      if (game.placeBlocker(col, 8)) {
        const now = game.debugSnapshot().mazeLength;
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        last = now;
      }
    }
  });

  it("reopens a dismantled structure's tiles", () => {
    const game = openRun();
    const before = game.debugSnapshot().mazeLength;
    const b = game.placeBlocker(6, 8)!;
    game.removeStructure(b.id);
    expect(game.debugSnapshot().mazeLength).toBeCloseTo(before, 9);
    expect(game.debugSnapshot().structures).toHaveLength(0);
  });

  it("flies a Filament straight over every wall", () => {
    const game = openRun();
    game.setWave(1);
    for (let col = 4; col <= 44; col += 2) game.placeBlocker(col, 8);
    const flyer = game.debugSpawn("filament")!;
    expect(flyer.flies).toBe(true);
    const before = { x: flyer.x, y: flyer.y };
    advance(game, 1);
    const u = game.debugSnapshot().units.find((x) => x.id === flyer.id);
    expect(u).toBeDefined();
    expect(Math.hypot(u!.x - before.x, u!.y - before.y)).toBeCloseTo(85, 0);
  });
});

describe("the maps and difficulties", () => {
  it("opens a run on the map and the difficulty last chosen", () => {
    const game = new Game();
    game.debugReset();
    game.setMap(mapById("transformer"));
    game.setDifficulty(DIFFICULTY.easy);
    game.startRun();
    const s = game.debugSnapshot();
    expect(s.map).toBe("transformer");
    expect(s.difficulty).toBe("easy");
    expect(s.totalWaves).toBe(40);
    expect(s.waypoints).toHaveLength(6);
  });
});
