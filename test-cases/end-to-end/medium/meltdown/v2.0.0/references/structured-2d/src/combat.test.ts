// Targeting, the fire clock, damage, splash, and the Rime's slow.

import { describe, expect, it } from "vitest";
import { BLOOM_SPLASH, SLOW_TIME, SURGE_DEFS, TILE } from "./constants";
import { footprintCentre } from "./constants";
import {
  createHarness,
  poseTarget,
  posePinnedTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

function tower(harness: Harness, id: number) {
  const read = harness.debug.snapshot().towers.find((t) => t.id === id);
  if (read === undefined) throw new Error(`no tower ${id}`);
  return read;
}

function unit(harness: Harness, id: number) {
  return harness.debug.snapshot().surge.find((u) => u.id === id) ?? null;
}

describe("the fire clock", () => {
  it("lands its first shot one full interval in, and then at its rate", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y);

    // The Arc fires twice a second, so nothing has landed at 0.4 s.
    await stepSeconds(harness, 0.4, 1);
    expect(tower(harness, arc).damageDealt).toBe(0);

    // One full interval in, exactly one shot, at the cold multiplier.
    await stepSeconds(harness, 0.1, 1);
    expect(tower(harness, arc).damageDealt).toBeCloseTo(6 * 0.35, 8);

    // A frame long enough for several intervals resolves that many in order.
    await stepSeconds(harness, 1, 1);
    expect(tower(harness, arc).damageDealt).toBeCloseTo(3 * 6 * 0.35, 8);
    expect(unit(harness, target)?.hp).toBeCloseTo(1e6 - 3 * 6 * 0.35, 6);
    harness.dispose();
  });

  it("neither grows nor falls without a target", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 0);
    await stepSeconds(harness, 5, 5);
    const read = tower(harness, arc);
    expect(read.firing).toBe(false);
    expect(read.targeting).toBeNull();
    expect(read.damageDealt).toBe(0);

    // The clock starts from zero when the target arrives, so the first shot is
    // still one full interval away.
    const centre = footprintCentre(10, 10, 2);
    poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 0.4, 1);
    expect(tower(harness, arc).damageDealt).toBe(0);
    harness.dispose();
  });
});

describe("range", () => {
  it("reaches exactly its radius from the footprint centre", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const inside = poseTarget(harness, "mote", centre.x + 6 * TILE, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).targeting).toBe(inside);

    harness.debug.removeUnit(inside);
    poseTarget(harness, "mote", centre.x + 6 * TILE + 1, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).targeting).toBeNull();
    harness.dispose();
  });
});

describe("the target", () => {
  it("is the in-range unit furthest along its route", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    // Both in range; the one further right is closer to the right exhaust.
    poseTarget(harness, "mote", centre.x - 40, centre.y);
    const ahead = poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).targeting).toBe(ahead);
    harness.dispose();
  });

  it("takes the next unit when the target goes", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const ahead = poseTarget(harness, "mote", centre.x + 60, centre.y);
    const behind = poseTarget(harness, "mote", centre.x - 40, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).targeting).toBe(ahead);
    harness.debug.removeUnit(ahead);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).targeting).toBe(behind);
    harness.dispose();
  });

  it("sees flyers alone from a Flak, and both from every other emitter", async () => {
    const harness = await createHarness();
    startRun(harness);
    const flak = posePinnedTower(harness, "flak", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const ground = poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, flak).targeting).toBeNull();

    const flyer = poseTarget(harness, "drift", centre.x + 40, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, flak).targeting).toBe(flyer);
    expect(unit(harness, ground)?.hp).toBe(1e6);
    harness.dispose();
  });
});

describe("damage", () => {
  it("scales every emitter's shot by its heat multiplier", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 80);
    const centre = footprintCentre(10, 10, 2);
    poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 0.5, 1);
    expect(tower(harness, arc).damageDealt).toBeCloseTo(6 * 3.5, 8);
    harness.dispose();
  });

  it("deals a Rime's shot ordinary damage besides its slow", async () => {
    const harness = await createHarness();
    startRun(harness);
    const rime = posePinnedTower(harness, "rime", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 1 / 2.4, 1);
    // Base damage 4 at a redline of 100, so the cold multiplier applies to it
    // exactly as it does to an Arc's.
    expect(tower(harness, rime).damageDealt).toBeCloseTo(4 * 0.35, 8);
    expect(unit(harness, target)?.slowFactor).toBeCloseTo(0.55, 8);
    harness.dispose();
  });

  it("splashes a Bloom's shot over its radius and no further", async () => {
    const harness = await createHarness();
    startRun(harness);
    posePinnedTower(harness, "bloom", 10, 10, 0);
    const centre = footprintCentre(10, 10, 3);
    // The three sit on one row, with the target furthest along its route, so
    // the Bloom fires on it and the splash is measured from where it stands.
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y, 100);
    const inside = poseTarget(
      harness,
      "mote",
      centre.x + 60 - (BLOOM_SPLASH * TILE - 1.6),
      centre.y,
      100,
    );
    const outside = poseTarget(
      harness,
      "mote",
      centre.x + 60 - (BLOOM_SPLASH * TILE + 1.4),
      centre.y,
      100,
    );
    await stepSeconds(harness, 1 / 1.2, 1);
    const damage = 10 * 0.35;
    expect(unit(harness, target)?.hp).toBeCloseTo(100 - damage, 6);
    expect(unit(harness, inside)?.hp).toBeCloseTo(100 - damage, 6);
    expect(unit(harness, outside)?.hp).toBe(100);
    harness.dispose();
  });
});

describe("the slow", () => {
  it("is strongest cold and nothing at all at 100", async () => {
    const harness = await createHarness();
    startRun(harness);
    const rime = posePinnedTower(harness, "rime", 10, 10, 50);
    const centre = footprintCentre(10, 10, 2);
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y);
    await stepSeconds(harness, 1 / 2.4, 1);
    expect(unit(harness, target)?.slowFactor).toBeCloseTo(0.55 * 0.5, 8);
    expect(unit(harness, target)?.speed).toBeCloseTo(
      SURGE_DEFS.mote.speed * (1 - 0.275),
      8,
    );

    harness.debug.setTowerHeat(rime, 100);
    harness.debug.setUnitSlow(target, 0);
    harness.debug.setUnitSlowTimer(target, 0);
    await stepSeconds(harness, 1 / 2.4, 1);
    expect(unit(harness, target)?.slowFactor).toBe(0);
    harness.dispose();
  });

  it("resolves an incoming slow in the three flat cases", async () => {
    const harness = await createHarness();
    startRun(harness);
    posePinnedTower(harness, "rime", 10, 10, 50);
    const centre = footprintCentre(10, 10, 2);
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y);

    // A stronger live slow is left alone, and it is still live when the shot
    // lands, so the weaker incoming one changes neither figure.
    harness.debug.setUnitSlow(target, 0.9);
    harness.debug.setUnitSlowTimer(target, SLOW_TIME);
    await stepSeconds(harness, 1 / 2.4, 1);
    expect(unit(harness, target)?.slowFactor).toBeCloseTo(0.9, 8);

    // A weaker live slow is replaced and its timer reset.
    harness.debug.setUnitSlow(target, 0.1);
    harness.debug.setUnitSlowTimer(target, SLOW_TIME);
    await stepSeconds(harness, 1 / 2.4, 1);
    expect(unit(harness, target)?.slowFactor).toBeCloseTo(0.275, 8);
    expect(unit(harness, target)?.slowTimer).toBeCloseTo(SLOW_TIME, 8);
    harness.dispose();
  });

  it("expires after its time and returns the unit to its base speed", async () => {
    const harness = await createHarness();
    startRun(harness);
    const target = poseTarget(harness, "mote", 400, 300);
    harness.debug.setUnitSlow(target, 0.5);
    harness.debug.setUnitSlowTimer(target, SLOW_TIME);
    await stepSeconds(harness, SLOW_TIME, 30);
    const read = unit(harness, target);
    expect(read?.slowFactor).toBe(0);
    expect(read?.slowed).toBe(false);
    expect(read?.speed).toBe(SURGE_DEFS.mote.speed);
    harness.dispose();
  });

  it("never touches a Core, which is an ordinary target otherwise", async () => {
    const harness = await createHarness();
    startRun(harness);
    const rime = posePinnedTower(harness, "rime", 10, 10, 0);
    const centre = footprintCentre(10, 10, 2);
    const core = poseTarget(harness, "core", centre.x + 60, centre.y);
    await stepSeconds(harness, 1 / 2.4, 1);
    expect(tower(harness, rime).targeting).toBe(core);
    expect(unit(harness, core)?.slowFactor).toBe(0);
    expect(tower(harness, rime).damageDealt).toBeCloseTo(4 * 0.35, 8);
    harness.dispose();
  });
});

describe("the tallies", () => {
  it("counts a kill and only the hp the killing blow removed", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = posePinnedTower(harness, "arc", 10, 10, 80);
    const centre = footprintCentre(10, 10, 2);
    const target = poseTarget(harness, "mote", centre.x + 60, centre.y, 5);
    const before = harness.debug.snapshot();
    await stepSeconds(harness, 0.5, 1);
    const read = tower(harness, arc);
    expect(read.kills).toBe(1);
    expect(read.damageDealt).toBe(5);
    expect(unit(harness, target)).toBeNull();
    expect(harness.debug.snapshot().money).toBe(
      before.money + SURGE_DEFS.mote.bounty,
    );
    expect(harness.debug.snapshot().score).toBe(
      before.score + SURGE_DEFS.mote.bounty,
    );
    harness.dispose();
  });
});
