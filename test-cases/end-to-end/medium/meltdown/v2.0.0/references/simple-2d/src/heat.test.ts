// The two-phase heat model of specs/heat.md, measured term by term.
//
// Every expected figure here is computed from the constants and the tower table
// rather than read off a run, and the two-phase check is built so a sequential,
// in-place resolution gives a plainly different answer.

import { describe, expect, it } from "vitest";
import {
  BASE_K,
  COND_K,
  FORGE_K,
  RAD_K,
  SINK_OUTPUT,
  TOWER_DEFS,
  TRIP_HEAT,
  TRIP_TIME,
} from "./constants";
import { facesOf, resolveHeat } from "./heat";
import { occupancy } from "./geometry";
import type { TowerType } from "./constants";
import type { TowerState } from "./game";

let nextId = 1;

function tower(
  type: TowerType,
  col: number,
  row: number,
  patch: Partial<TowerState> = {},
): TowerState {
  return {
    id: nextId++,
    type,
    col,
    row,
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
    ...patch,
  };
}

const DT = 1 / 120;

describe("air cooling", () => {
  it("sheds a lone Arc's radiator and plain edge-tiles at their own rates", () => {
    const arc = tower("arc", 10, 10, { heat: 80 });
    const next = resolveHeat([arc], [0], DT).towers[0];
    // A 2x2 Arc radiates N and S: two edge-tiles each, and two plain edge-tiles
    // on each of E and W.
    const loss = (RAD_K * 4 + BASE_K * 4) * 0.8 * DT;
    expect(next.heat).toBeCloseTo(80 - loss, 12);
  });

  it("sheds in proportion to the heat", () => {
    const hot = resolveHeat([tower("arc", 10, 10, { heat: 80 })], [0], DT);
    const warm = resolveHeat([tower("arc", 10, 10, { heat: 40 })], [0], DT);
    expect(80 - hot.towers[0].heat).toBeCloseTo(
      2 * (40 - warm.towers[0].heat),
      12,
    );
  });

  it("sheds nothing through a face another tower holds", () => {
    // Two Arcs flush along one 2x2 face, both at the same heat so they conduct
    // nothing and only the air term is left.
    const towers = [
      tower("arc", 10, 10, { heat: 80 }),
      tower("arc", 12, 10, { heat: 80 }),
    ];
    const next = resolveHeat(towers, [0, 0], DT).towers[0];
    // The E face is held, so two plain edge-tiles are gone.
    const loss = (RAD_K * 4 + BASE_K * 2) * 0.8 * DT;
    expect(next.heat).toBeCloseTo(80 - loss, 12);
  });

  it("counts one edge-tile per tile of a face", () => {
    const map = occupancy([tower("lance", 10, 10)]);
    const lance = facesOf([tower("lance", 10, 10)], 0, map);
    // A 4x4 Lance radiates N and E: four edge-tiles each, eight plain.
    expect(lance.radiator).toBe(8);
    expect(lance.plain).toBe(8);
  });

  it("treats the casing and an opening as air", () => {
    // Flush against the left casing: its W face is off the grid entirely.
    const atWall = resolveHeat([tower("arc", 0, 10, { heat: 80 })], [0], DT);
    const inField = resolveHeat([tower("arc", 10, 10, { heat: 80 })], [0], DT);
    expect(atWall.towers[0].heat).toBeCloseTo(inField.towers[0].heat, 12);
  });
});

describe("conduction", () => {
  it("runs hot to cold across every shared edge-tile", () => {
    const hot = tower("arc", 10, 10, { heat: 90 });
    const cold = tower("arc", 12, 10, { heat: 10 });
    const next = resolveHeat([hot, cold], [0, 0], DT).towers;
    const flow = COND_K * 2 * 80 * DT;
    const air90 = (RAD_K * 4 + BASE_K * 2) * 0.9 * DT;
    const air10 = (RAD_K * 4 + BASE_K * 2) * 0.1 * DT;
    expect(next[0].heat).toBeCloseTo(90 - flow - air90, 12);
    expect(next[1].heat).toBeCloseTo(10 + flow - air10, 12);
  });

  it("exchanges nothing between two emitters at the same heat", () => {
    const a = tower("arc", 10, 10, { heat: 50 });
    const b = tower("arc", 12, 10, { heat: 50 });
    const next = resolveHeat([a, b], [0, 0], DT).towers;
    expect(next[0].heat).toBeCloseTo(next[1].heat, 12);
  });

  it("exchanges nothing across a gap or at a corner", () => {
    const gap = resolveHeat(
      [tower("arc", 10, 10, { heat: 90 }), tower("arc", 13, 10, { heat: 10 })],
      [0, 0],
      DT,
    ).towers;
    const alone = resolveHeat([tower("arc", 10, 10, { heat: 90 })], [0], DT)
      .towers[0];
    expect(gap[0].heat).toBeCloseTo(alone.heat, 12);

    const corner = resolveHeat(
      [tower("arc", 10, 10, { heat: 90 }), tower("arc", 12, 12, { heat: 10 })],
      [0, 0],
      DT,
    ).towers;
    expect(corner[0].heat).toBeCloseTo(alone.heat, 12);
  });
});

describe("the movers", () => {
  it("warms toward the Forge's setpoint and never past it", () => {
    const arc = tower("arc", 10, 10, { heat: 20 });
    const forge = tower("forge", 12, 10);
    const next = resolveHeat([arc, forge], [0, 0], DT).towers;
    const gain = FORGE_K * 2 * (72 - 20) * DT;
    const air = (RAD_K * 4 + BASE_K * 2) * 0.2 * DT;
    expect(next[0].heat).toBeCloseTo(20 + gain - air, 12);
    expect(next[1].heat).toBe(0);

    const atSetpoint = resolveHeat(
      [tower("arc", 10, 10, { heat: 72 }), tower("forge", 12, 10)],
      [0, 0],
      DT,
    ).towers[0];
    const airAt72 = (RAD_K * 4 + BASE_K * 2) * 0.72 * DT;
    expect(atSetpoint.heat).toBeCloseTo(72 - airAt72, 12);
  });

  it("drains through a face nothing else could cool through", () => {
    // The Arc is walled on all four faces, one of them by a Sink, so its whole
    // air term is gone and the drain is all that is left.
    const arc = tower("arc", 10, 10, { heat: 60 });
    const sink = tower("sink", 12, 10);
    const north = tower("arc", 10, 8, { heat: 60 });
    const south = tower("arc", 10, 12, { heat: 60 });
    const west = tower("arc", 8, 10, { heat: 60 });
    const next = resolveHeat(
      [arc, sink, north, south, west],
      [0, 0, 0, 0, 0],
      DT,
    ).towers;
    const drain = SINK_OUTPUT[0] * 2 * 0.6 * DT;
    expect(next[0].heat).toBeCloseTo(60 - drain, 12);
  });

  it("never carries heat of its own", () => {
    const forge = tower("forge", 12, 10);
    const lance = tower("lance", 8, 8, { heat: 100 });
    const next = resolveHeat([forge, lance], [0, 0], DT).towers[0];
    expect(next.heat).toBe(0);
  });
});

describe("the two phases", () => {
  it("computes every term from the heats the frame opened with", () => {
    // Four Arcs in a row, hot and cold alternating, over one long frame. A
    // sequential resolution would feed each tower its neighbour's NEW heat.
    const dt = 1 / 30;
    const heats = [95, 5, 95, 5];
    const towers = heats.map((heat, i) =>
      tower("arc", 10 + i * 2, 10, { heat }),
    );
    const next = resolveHeat(towers, [0, 0, 0, 0], dt).towers;
    const mass = TOWER_DEFS.arc.kind === "emitter" ? TOWER_DEFS.arc.mass : 1;
    next.forEach((after, i) => {
      const heat = heats[i];
      const map = occupancy(towers);
      const face = facesOf(towers, i, map);
      const air = (RAD_K * face.radiator + BASE_K * face.plain) * (heat / 100);
      let conduct = 0;
      for (const [other, edges] of face.shared) {
        conduct += COND_K * edges * (heats[other] - heat);
      }
      const expected = heat + ((conduct - air) * dt) / mass;
      expect(after.heat).toBeCloseTo(Math.max(0, Math.min(100, expected)), 10);
    });
    // The end towers move by more than the tolerance a sequential pass would
    // land inside, so the two answers are unmistakably different.
    expect(Math.abs(next[0].heat - 95)).toBeGreaterThan(1);
  });
});

describe("the trip", () => {
  it("trips on the crossing and not on the value", () => {
    const climbing = tower("arc", 10, 10, { heat: 95 });
    const crossed = resolveHeat([climbing], [1], DT);
    expect(crossed.towers[0].tripped).toBe(true);
    expect(crossed.towers[0].heat).toBe(TRIP_HEAT);
    expect(crossed.tripped).toBe(true);

    const posed = tower("arc", 10, 10, { heat: 100 });
    const cooling = resolveHeat([posed], [0], DT);
    expect(cooling.towers[0].tripped).toBe(false);
    expect(cooling.towers[0].heat).toBeLessThan(100);
  });

  it("bleeds at 20 a second whatever stands beside it", () => {
    const tripped = tower("arc", 10, 10, {
      heat: 100,
      tripped: true,
      tripTimer: TRIP_TIME,
    });
    const forge = tower("forge", 12, 10, { level: 3 });
    const hot = tower("lance", 6, 8, { heat: 100 });
    const next = resolveHeat([tripped, forge, hot], [0, 0, 0], 0.5).towers[0];
    expect(next.heat).toBeCloseTo(100 - (TRIP_HEAT / TRIP_TIME) * 0.5, 12);
    expect(next.tripTimer).toBeCloseTo(TRIP_TIME - 0.5, 12);
  });

  it("returns online cold when the cooldown runs out", () => {
    const tripped = tower("arc", 10, 10, {
      heat: 20,
      tripped: true,
      tripTimer: 0.25,
    });
    const next = resolveHeat([tripped], [0], 0.25).towers[0];
    expect(next.tripped).toBe(false);
    expect(next.tripTimer).toBe(0);
    expect(next.heat).toBe(0);
  });
});

describe("the faculty gates", () => {
  it("holds a tower's heat where it was posed", () => {
    const held = tower("arc", 10, 10, { heat: 60, thermalEnabled: false });
    const forge = tower("forge", 12, 10);
    const next = resolveHeat([held, forge], [3, 0], 1).towers[0];
    expect(next.heat).toBe(60);
  });

  it("leaves a held tower out of its neighbours' terms as well", () => {
    const held = tower("arc", 12, 10, { heat: 100, thermalEnabled: false });
    const cool = tower("arc", 10, 10, { heat: 20 });
    const withHeld = resolveHeat([cool, held], [0, 0], DT).towers[0];
    const air = (RAD_K * 4 + BASE_K * 2) * 0.2 * DT;
    expect(withHeld.heat).toBeCloseTo(20 - air, 12);
  });
});
