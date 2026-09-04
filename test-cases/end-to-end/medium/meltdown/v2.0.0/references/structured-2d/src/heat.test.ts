// The heat model: the curve, the two-phase resolution, the flows, and the trip.

import { describe, expect, it } from "vitest";
import {
  BASE_K,
  COND_K,
  FORGE_K,
  RAD_K,
  TRIP_TIME,
  TOWER_DEFS,
  TOWER_TYPES,
  heatMultiplier,
} from "./constants";
import { censusFaces } from "./heat";
import { occupancy } from "./geometry";
import {
  createHarness,
  poseIdleTower,
  poseTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

function towerOf(harness: Harness, id: number) {
  const tower = harness.debug.snapshot().towers.find((t) => t.id === id);
  if (tower === undefined) throw new Error(`no tower ${id}`);
  return tower;
}

describe("the damage curve", () => {
  it("is 0.35 cold and 3.5 from the redline up", () => {
    expect(heatMultiplier(0, 80)).toBeCloseTo(0.35, 10);
    expect(heatMultiplier(80, 80)).toBeCloseTo(3.5, 10);
    expect(heatMultiplier(100, 80)).toBeCloseTo(3.5, 10);
  });

  it("is quadratic to the redline", () => {
    expect(heatMultiplier(40, 80)).toBeCloseTo(0.35 + 3.15 * 0.25, 10);
  });
});

describe("what a tower's faces see", () => {
  it("counts an edge-tile per tile of the footprint's side", () => {
    const owners = occupancy([
      {
        id: 1,
        type: "arc",
        col: 10,
        row: 10,
        rotation: 0,
        level: 1,
        heat: 0,
        tripped: false,
        tripTimer: 0,
        fireClock: 0,
        targeting: null,
        firing: false,
        kills: 0,
        damageDealt: 0,
        spent: 0,
        fresh: true,
        firingEnabled: true,
        thermalEnabled: true,
      },
    ]);
    const census = censusFaces(
      {
        id: 1,
        type: "arc",
        col: 10,
        row: 10,
        rotation: 0,
        level: 1,
        heat: 0,
        tripped: false,
        tripTimer: 0,
        fireClock: 0,
        targeting: null,
        firing: false,
        kills: 0,
        damageDealt: 0,
        spent: 0,
        fresh: true,
        firingEnabled: true,
        thermalEnabled: true,
      },
      owners,
    );
    // An Arc is 2x2 with radiator faces N and S: four radiator edge-tiles and
    // four plain ones, all of them facing open floor.
    expect(census.radiatorEdges).toBe(4);
    expect(census.plainEdges).toBe(4);
    expect(census.shared.size).toBe(0);
  });
});

describe("air cooling", () => {
  it("sheds at the stated rate, proportional to heat", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseIdleTower(harness, "arc", 10, 10, 0, 50);
    await stepSeconds(harness, 1 / 30, 1);
    const expected =
      50 - ((RAD_K * 4 + BASE_K * 4) * (50 / 100) * (1 / 30)) / 1.0;
    expect(towerOf(harness, id).heat).toBeCloseTo(expected, 8);
    harness.dispose();
  });

  it("sheds nothing at all when every face is blocked", async () => {
    const harness = await createHarness();
    startRun(harness);
    const centre = poseIdleTower(harness, "arc", 10, 10, 0, 60);
    for (const [col, row] of [
      [10, 8],
      [10, 12],
      [8, 10],
      [12, 10],
    ]) {
      poseIdleTower(harness, "arc", col, row, 0, 60);
    }
    await stepSeconds(harness, 1 / 30, 1);
    // Every edge faces another tower, and every neighbour opened the frame at
    // the same heat, so nothing flows at all.
    expect(towerOf(harness, centre).heat).toBeCloseTo(60, 10);
    harness.dispose();
  });

  it("divides every change by the thermal mass", async () => {
    const harness = await createHarness();
    startRun(harness);
    // A Stutter is 2x2 with radiators N and E and a mass of 0.5.
    const id = poseIdleTower(harness, "stutter", 10, 10, 0, 50);
    await stepSeconds(harness, 1 / 30, 1);
    const expected =
      50 - ((RAD_K * 4 + BASE_K * 4) * (50 / 100) * (1 / 30)) / 0.5;
    expect(towerOf(harness, id).heat).toBeCloseTo(expected, 8);
    harness.dispose();
  });

  it("never falls below zero", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseIdleTower(harness, "arc", 10, 10, 0, 4);
    await stepSeconds(harness, 4, 4);
    expect(towerOf(harness, id).heat).toBeGreaterThanOrEqual(0);
    harness.dispose();
  });
});

describe("conduction", () => {
  it("runs from the hotter emitter to the cooler, symmetrically", async () => {
    const harness = await createHarness();
    startRun(harness);
    const hot = poseIdleTower(harness, "arc", 10, 10, 0, 80);
    const cold = poseIdleTower(harness, "arc", 12, 10, 0, 20);
    const dt = 1 / 240;
    const before = {
      hot: towerOf(harness, hot).heat,
      cold: towerOf(harness, cold).heat,
    };
    await stepSeconds(harness, dt, 1);
    const after = {
      hot: towerOf(harness, hot).heat,
      cold: towerOf(harness, cold).heat,
    };
    // Two 2x2 Arcs sharing one face share two edge-tiles.
    const flow = COND_K * 2 * (before.hot - before.cold) * dt;
    // Each also sheds through the six edges it still faces air with; the Arc's
    // radiators are N and S, so the shared face is a plain one on both.
    const hotAir = (RAD_K * 4 + BASE_K * 2) * (before.hot / 100) * dt;
    const coldAir = (RAD_K * 4 + BASE_K * 2) * (before.cold / 100) * dt;
    expect(after.hot).toBeCloseTo(before.hot - flow - hotAir, 8);
    expect(after.cold).toBeCloseTo(before.cold + flow - coldAir, 8);
    harness.dispose();
  });

  it("exchanges nothing between two emitters at the same heat", async () => {
    const harness = await createHarness();
    startRun(harness);
    const left = poseIdleTower(harness, "arc", 10, 10, 0, 50);
    const right = poseIdleTower(harness, "arc", 12, 10, 0, 50);
    await stepSeconds(harness, 1 / 240, 1);
    expect(towerOf(harness, left).heat).toBeCloseTo(
      towerOf(harness, right).heat,
      10,
    );
    harness.dispose();
  });

  it("exchanges nothing across a gap or at a corner", async () => {
    const harness = await createHarness();
    startRun(harness);
    const lone = poseIdleTower(harness, "arc", 10, 10, 0, 80);
    poseIdleTower(harness, "arc", 13, 10, 0, 0); // a one-tile gap
    poseIdleTower(harness, "arc", 12, 12, 0, 0); // touching at a corner
    const dt = 1 / 240;
    await stepSeconds(harness, dt, 1);
    const expected = 80 - (RAD_K * 4 + BASE_K * 4) * (80 / 100) * dt;
    expect(towerOf(harness, lone).heat).toBeCloseTo(expected, 8);
    harness.dispose();
  });
});

describe("the movers", () => {
  it("warms an emitter toward the Forge's setpoint and no further", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = poseIdleTower(harness, "arc", 10, 10, 0, 0);
    poseTower(harness, "forge", 12, 10, 0);
    const dt = 1 / 240;
    await stepSeconds(harness, dt, 1);
    const gain = FORGE_K * 2 * (72 - 0) * dt;
    expect(towerOf(harness, arc).heat).toBeCloseTo(gain, 8);

    // Already above the setpoint, the Forge adds nothing.
    harness.debug.setTowerHeat(arc, 90);
    await stepSeconds(harness, dt, 1);
    const cooled = 90 - (RAD_K * 4 + BASE_K * 2) * (90 / 100) * dt;
    expect(towerOf(harness, arc).heat).toBeCloseTo(cooled, 8);
    harness.dispose();
  });

  it("drains through a face nothing else could cool through", async () => {
    const harness = await createHarness();
    startRun(harness);
    const arc = poseIdleTower(harness, "arc", 10, 10, 0, 60);
    poseTower(harness, "sink", 12, 10, 0);
    const dt = 1 / 240;
    await stepSeconds(harness, dt, 1);
    const air = (RAD_K * 4 + BASE_K * 2) * (60 / 100) * dt;
    const drain = 16 * 2 * (60 / 100) * dt;
    expect(towerOf(harness, arc).heat).toBeCloseTo(60 - air - drain, 8);
    harness.dispose();
  });

  it("carries no heat, fires nothing, and never conducts", async () => {
    const harness = await createHarness();
    startRun(harness);
    const forge = poseTower(harness, "forge", 10, 10, 0);
    const sink = poseTower(harness, "sink", 12, 10, 0);
    harness.debug.setTowerHeat(forge, 90);
    await stepSeconds(harness, 1, 4);
    const read = towerOf(harness, forge);
    expect(read.heat).toBe(0);
    expect(read.damage).toBe(0);
    expect(read.heatMult).toBe(0);
    expect(read.radiatorFaces).toEqual([]);
    expect(towerOf(harness, sink).heat).toBe(0);
    harness.dispose();
  });
});

describe("the two-phase resolution", () => {
  it("computes every change from the heats the frame opened with", async () => {
    const harness = await createHarness();
    startRun(harness);
    // Three Arcs in a row, so the middle one's neighbours both change on the
    // same frame. A sequential pass would read one new heat and one old one.
    const a = poseIdleTower(harness, "arc", 10, 10, 0, 90);
    const b = poseIdleTower(harness, "arc", 12, 10, 0, 45);
    const c = poseIdleTower(harness, "arc", 14, 10, 0, 0);
    const dt = 1 / 30;
    await stepSeconds(harness, dt, 1);
    const air = (heat: number, plain: number) =>
      (RAD_K * 4 + BASE_K * plain) * (heat / 100) * dt;
    expect(towerOf(harness, a).heat).toBeCloseTo(
      90 + COND_K * 2 * (45 - 90) * dt - air(90, 2),
      8,
    );
    expect(towerOf(harness, b).heat).toBeCloseTo(
      45 +
        COND_K * 2 * (90 - 45) * dt +
        COND_K * 2 * (0 - 45) * dt -
        air(45, 0),
      8,
    );
    expect(towerOf(harness, c).heat).toBeCloseTo(
      0 + COND_K * 2 * (45 - 0) * dt - air(0, 2),
      8,
    );
    harness.dispose();
  });
});

describe("the trip", () => {
  it("does not fire for a tower posed at 100 and cooling", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseIdleTower(harness, "arc", 10, 10, 0, 100);
    await stepSeconds(harness, 1 / 30, 1);
    const read = towerOf(harness, id);
    expect(read.tripped).toBe(false);
    expect(read.heat).toBeLessThan(100);
    harness.dispose();
  });

  it("bleeds a tripped tower to zero and returns it online cold", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerTripped(id, true);
    harness.debug.setTowerTripTimer(id, TRIP_TIME);
    harness.debug.setTowerHeat(id, 100);

    await stepSeconds(harness, 1, 60);
    const midway = towerOf(harness, id);
    expect(midway.tripped).toBe(true);
    expect(midway.heat).toBeCloseTo(80, 6);
    expect(midway.tripTimer).toBeCloseTo(TRIP_TIME - 1, 6);
    expect(midway.firing).toBe(false);

    await stepSeconds(harness, TRIP_TIME, 60);
    const returned = towerOf(harness, id);
    expect(returned.tripped).toBe(false);
    expect(returned.heat).toBe(0);
    expect(returned.tripTimer).toBe(0);
    harness.dispose();
  });

  it("takes no part in any flow while it is tripped", async () => {
    const harness = await createHarness();
    startRun(harness);
    const tripped = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerTripped(tripped, true);
    harness.debug.setTowerTripTimer(tripped, TRIP_TIME);
    harness.debug.setTowerHeat(tripped, 100);
    const neighbour = poseIdleTower(harness, "arc", 12, 10, 0, 0);
    const dt = 1 / 240;
    await stepSeconds(harness, dt, 1);
    // The neighbour's shared face still sheds nothing to air, and the tripped
    // tower conducts nothing into it, so it holds at zero.
    expect(towerOf(harness, neighbour).heat).toBeCloseTo(0, 10);
    harness.dispose();
  });

  it("holds a tower's heat exactly while its thermal gate is off", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerThermal(id, false);
    harness.debug.setTowerHeat(id, 55);
    await stepSeconds(harness, 3, 12);
    expect(towerOf(harness, id).heat).toBe(55);
    harness.dispose();
  });
});

describe("the roster's figures", () => {
  it("reports every emitter's redline unchanged by level", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of TOWER_TYPES) {
      const def = TOWER_DEFS[type];
      if (def.kind !== "emitter") continue;
      const id = poseIdleTower(harness, type, 10, 10, 0, 0);
      expect(towerOf(harness, id).redline).toBe(def.redline);
      harness.debug.setTowerLevel(id, 3);
      expect(towerOf(harness, id).redline).toBe(def.redline);
      harness.debug.removeTower(id);
    }
    harness.dispose();
  });

  it("reports a mover no redline, no multiplier, and no damage", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of ["forge", "sink"] as const) {
      const id = poseTower(harness, type, 10, 10, 0);
      const read = towerOf(harness, id);
      expect(read.redline).toBe(0);
      expect(read.heatMult).toBe(0);
      expect(read.damage).toBe(0);
      harness.debug.removeTower(id);
    }
    harness.dispose();
  });
});
