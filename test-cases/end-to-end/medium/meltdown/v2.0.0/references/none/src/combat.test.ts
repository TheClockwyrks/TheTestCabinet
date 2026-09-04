import { describe, expect, it } from "vitest";
import { BLOOM_SPLASH, SLOW_TIME, TILE, tileCX, tileCY } from "./constants";
import { addTower } from "./build";
import { acquire, applySlow, resolveCombat } from "./combat";
import { addUnit } from "./sim";
import { createState, type MeltdownState, type Unit } from "./state";
import { damageOf } from "./towers";

/** A live floor with the run's own release of surge held off. */
function scene(): MeltdownState {
  const state = createState();
  state.screen = "playing";
  state.phase = "wave";
  state.waveSpawning = false;
  return state;
}

/** A stationary, effectively unkillable target parked on a tile. */
function target(
  state: MeltdownState,
  type: Parameters<typeof addUnit>[1],
  col: number,
  row: number,
  hp = 1e6,
): Unit {
  const unit = addUnit(state, type, "left");
  unit.x = tileCX(col);
  unit.y = tileCY(row);
  unit.motion = false;
  unit.maxHp = hp;
  unit.hp = hp;
  return unit;
}

describe("range", () => {
  it("reaches exactly its radius in tiles from the footprint's centre", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    const centre = { x: tileCX(20) + TILE / 2, y: tileCY(20) + TILE / 2 };
    const inside = target(state, "mote", 0, 0);
    inside.x = centre.x + 6 * TILE;
    inside.y = centre.y;
    expect(acquire(arc, state)).toBe(inside);
    inside.x = centre.x + 6 * TILE + 1;
    expect(acquire(arc, state)).toBeNull();
  });
});

describe("the target", () => {
  it("takes the in-range unit furthest along its route", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    const behind = target(state, "mote", 18, 21);
    const ahead = target(state, "mote", 24, 21);
    expect(acquire(arc, state)).toBe(ahead);
    void behind;
  });

  it("separates a tie by the lower id", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    const first = target(state, "mote", 22, 21);
    const second = target(state, "mote", 22, 21);
    expect(acquire(arc, state)).toBe(first);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("gives the Flak flyers alone, whatever else is in range", () => {
    const state = scene();
    const flak = addTower(state, "flak", 20, 20, 0);
    const ground = target(state, "mote", 21, 22);
    expect(acquire(flak, state)).toBeNull();
    const flyer = target(state, "drift", 21, 22);
    expect(acquire(flak, state)).toBe(flyer);
    void ground;
  });

  it("gives every other emitter ground and air alike", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    const flyer = target(state, "drift", 21, 22);
    expect(acquire(arc, state)).toBe(flyer);
  });

  it("gives a mover nothing to fire on", () => {
    const state = scene();
    const forge = addTower(state, "forge", 20, 20, 0);
    target(state, "mote", 21, 21);
    expect(acquire(forge, state)).toBeNull();
  });

  it("takes a unit immune to slowing like any other", () => {
    const state = scene();
    const rime = addTower(state, "rime", 20, 20, 0);
    const core = target(state, "core", 21, 21);
    expect(acquire(rime, state)).toBe(core);
  });
});

describe("the fire clock", () => {
  it("lands its first shot one full interval after the target arrives", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.thermalEnabled = false;
    const unit = target(state, "mote", 21, 22);
    // Just under the 0.5 s interval: nothing has resolved yet.
    resolveCombat(state, 0.49);
    expect(unit.hp).toBe(1e6);
    const frame = resolveCombat(state, 0.02);
    expect(frame.shotsFired.get(arc.id)).toBe(1);
  });

  it("resolves several shots in one long frame and carries the remainder", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.thermalEnabled = false;
    target(state, "mote", 21, 22);
    const frame = resolveCombat(state, 1.6);
    expect(frame.shotsFired.get(arc.id)).toBe(3);
    expect(arc.fireAcc).toBeCloseTo(0.1, 10);
  });

  it("neither grows nor falls with no target", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.fireAcc = 0.3;
    resolveCombat(state, 1);
    expect(arc.fireAcc).toBeCloseTo(0.3, 10);
    expect(arc.firing).toBe(false);
    expect(arc.targeting).toBeNull();
  });

  it("stops a tripped tower firing and reports it as not firing", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.tripped = true;
    arc.tripTimer = 5;
    target(state, "mote", 21, 22);
    const frame = resolveCombat(state, 2);
    expect(frame.anyShot).toBe(false);
    expect(arc.firing).toBe(false);
  });

  it("stops a firing-gated tower acquiring anything at all", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.firingEnabled = false;
    target(state, "mote", 21, 22);
    const frame = resolveCombat(state, 2);
    expect(frame.anyShot).toBe(false);
    expect(arc.targeting).toBeNull();
  });
});

describe("damage", () => {
  it("removes base damage scaled by the multiplier its heat gives it", () => {
    const state = scene();
    const arc = addTower(state, "arc", 20, 20, 0);
    arc.thermalEnabled = false;
    arc.heat = 80;
    const unit = target(state, "mote", 21, 22);
    resolveCombat(state, 0.5);
    expect(1e6 - unit.hp).toBeCloseTo(6 * 3.5, 10);
    expect(arc.damageDealt).toBeCloseTo(6 * 3.5, 10);
  });

  it("removes the Rime's damage as well as applying its slow", () => {
    const state = scene();
    const rime = addTower(state, "rime", 20, 20, 0);
    rime.thermalEnabled = false;
    const unit = target(state, "mote", 21, 22);
    resolveCombat(state, 1 / 2.4 + 0.001);
    expect(1e6 - unit.hp).toBeCloseTo(damageOf(rime), 10);
    expect(unit.slowFactor).toBeCloseTo(0.55, 10);
    expect(unit.slowTimer).toBeCloseTo(SLOW_TIME, 10);
  });

  it("credits only the hp the killing blow actually removed", () => {
    const state = scene();
    const lance = addTower(state, "lance", 20, 20, 0);
    lance.thermalEnabled = false;
    lance.heat = 92;
    const unit = target(state, "mote", 22, 22, 5);
    const frame = resolveCombat(state, 1.3);
    expect(frame.deaths).toHaveLength(1);
    expect(lance.kills).toBe(1);
    expect(lance.damageDealt).toBe(5);
    expect(unit.hp).toBe(0);
  });
});

describe("the Bloom's splash", () => {
  it("removes the full per-shot damage from every unit inside the radius", () => {
    const state = scene();
    const bloom = addTower(state, "bloom", 20, 20, 0);
    bloom.thermalEnabled = false;
    const hit = target(state, "mote", 22, 23);
    // Both bystanders sit BEHIND the target on its route, so the Bloom still
    // picks the unit furthest along and the splash is what reaches them.
    const near = target(state, "mote", 22, 23);
    near.x = hit.x - (BLOOM_SPLASH * TILE - 1);
    const far = target(state, "mote", 22, 23);
    far.x = hit.x - (BLOOM_SPLASH * TILE + 2);
    resolveCombat(state, 1 / 1.2 + 0.01);
    const damage = damageOf(bloom);
    expect(1e6 - hit.hp).toBeCloseTo(damage, 8);
    expect(1e6 - near.hp).toBeCloseTo(damage, 8);
    expect(far.hp).toBe(1e6);
  });
});

describe("the slow rule", () => {
  const unitAt = (factor: number, timer: number): Unit => {
    const state = scene();
    const unit = addUnit(state, "mote", "left");
    unit.slowFactor = factor;
    unit.slowTimer = timer;
    return unit;
  };

  it("takes a stronger slow and resets the timer", () => {
    const unit = unitAt(0.3, 0.2);
    applySlow(unit, 0.5);
    expect(unit.slowFactor).toBeCloseTo(0.5, 10);
    expect(unit.slowTimer).toBeCloseTo(SLOW_TIME, 10);
  });

  it("keeps an equal slow and resets the timer", () => {
    const unit = unitAt(0.5, 0.2);
    applySlow(unit, 0.5);
    expect(unit.slowFactor).toBeCloseTo(0.5, 10);
    expect(unit.slowTimer).toBeCloseTo(SLOW_TIME, 10);
  });

  it("changes neither for a weaker slow", () => {
    const unit = unitAt(0.5, 0.2);
    applySlow(unit, 0.2);
    expect(unit.slowFactor).toBeCloseTo(0.5, 10);
    expect(unit.slowTimer).toBeCloseTo(0.2, 10);
  });

  it("applies nothing at all at factor zero", () => {
    const unit = unitAt(0, 0);
    applySlow(unit, 0);
    expect(unit.slowFactor).toBe(0);
    expect(unit.slowTimer).toBe(0);
  });

  it("never slows a unit that is not slowable", () => {
    const state = scene();
    const core = addUnit(state, "core", "left");
    applySlow(core, 0.8);
    expect(core.slowFactor).toBe(0);
  });
});
