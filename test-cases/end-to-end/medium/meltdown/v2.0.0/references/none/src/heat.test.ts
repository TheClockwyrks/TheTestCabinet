import { describe, expect, it } from "vitest";
import { BASE_K, COND_K, FORGE_K, RAD_K, TRIP_TIME } from "./constants";
import { addTower } from "./build";
import { accountEdges, resolveHeat } from "./heat";
import { createState, type MeltdownState } from "./state";

const NO_SHOTS = new Map<number, number>();

/** A floor with nothing on it but the towers a scenario asks for. */
function floorWith(
  towers: Array<[Parameters<typeof addTower>[1], number, number, number?]>,
): MeltdownState {
  const state = createState();
  for (const [type, col, row, rotation] of towers) {
    addTower(state, type, col, row, (rotation ?? 0) as 0 | 1 | 2 | 3);
  }
  return state;
}

describe("edges", () => {
  it("counts every face of a free-standing tower as facing air", () => {
    const state = floorWith([["arc", 20, 20]]);
    const account = accountEdges(state.towers[0], state.floor);
    expect(account.radiatorEdges).toBe(4);
    expect(account.plainEdges).toBe(4);
    expect(account.shared.size).toBe(0);
  });

  it("counts the casing as air, so a tower in the corner still sheds", () => {
    const state = floorWith([["arc", 0, 0]]);
    const account = accountEdges(state.towers[0], state.floor);
    expect(account.radiatorEdges + account.plainEdges).toBe(8);
  });

  it("spends an edge on a neighbour rather than on air", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    const account = accountEdges(state.towers[0], state.floor);
    expect(account.shared.get(state.towers[1].id)).toBe(2);
    expect(account.radiatorEdges + account.plainEdges).toBe(6);
  });

  it("shares nothing with a tower touching only at a corner", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 22],
    ]);
    expect(accountEdges(state.towers[0], state.floor).shared.size).toBe(0);
  });
});

describe("air cooling", () => {
  it("sheds at the stated rate per edge, proportional to the heat", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    tower.heat = 100;
    const dt = 0.01;
    resolveHeat(state.towers, state.floor, dt, NO_SHOTS);
    const expected = 100 - (RAD_K * 4 + BASE_K * 4) * 1.0 * dt;
    expect(tower.heat).toBeCloseTo(expected, 10);
  });

  it("sheds almost nothing when cold and most near the trip", () => {
    const cold = floorWith([["arc", 20, 20]]);
    cold.towers[0].heat = 10;
    resolveHeat(cold.towers, cold.floor, 0.1, NO_SHOTS);
    const coldLoss = 10 - cold.towers[0].heat;

    const hot = floorWith([["arc", 20, 20]]);
    hot.towers[0].heat = 90;
    resolveHeat(hot.towers, hot.floor, 0.1, NO_SHOTS);
    const hotLoss = 90 - hot.towers[0].heat;
    expect(hotLoss).toBeCloseTo(coldLoss * 9, 8);
  });

  it("divides the change by the tower's own thermal mass", () => {
    const light = floorWith([["stutter", 20, 20]]);
    const heavy = floorWith([["lance", 20, 20]]);
    light.towers[0].heat = 50;
    heavy.towers[0].heat = 50;
    resolveHeat(light.towers, light.floor, 0.05, NO_SHOTS);
    resolveHeat(heavy.towers, heavy.floor, 0.05, NO_SHOTS);
    expect(50 - light.towers[0].heat).toBeGreaterThan(
      50 - heavy.towers[0].heat,
    );
  });

  it("leaves a tower boxed in on all four faces with nothing to shed to", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 18, 20],
      ["arc", 22, 20],
      ["arc", 20, 18],
      ["arc", 20, 22],
    ]);
    const boxed = state.towers[0];
    const account = accountEdges(boxed, state.floor);
    expect(account.radiatorEdges + account.plainEdges).toBe(0);
  });
});

describe("conduction", () => {
  it("moves the same flow in both directions across a shared edge", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    const [hot, cool] = state.towers;
    hot.heat = 60;
    cool.heat = 20;
    const dt = 0.001;
    resolveHeat(state.towers, state.floor, dt, NO_SHOTS);
    const flow = COND_K * 2 * 40 * dt;
    // Both towers also shed to air, which is why the gains are checked
    // against each other rather than against the raw flow.
    expect(hot.heat).toBeLessThan(60);
    expect(cool.heat).toBeGreaterThan(20 + flow * 0.5);
  });

  it("exchanges nothing between two emitters at the same heat", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    for (const tower of state.towers) tower.heat = 50;
    resolveHeat(state.towers, state.floor, 0.01, NO_SHOTS);
    expect(state.towers[0].heat).toBeCloseTo(state.towers[1].heat, 10);
  });

  it("resolves both towers from the heats the frame opened with", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    const [a, b] = state.towers;
    a.heat = 80;
    b.heat = 0;
    const dt = 1 / 30;
    resolveHeat(state.towers, state.floor, dt, NO_SHOTS);
    // Sequentially, `b` would have read `a`'s ALREADY-COOLED heat and gained
    // less. The two-phase rule fixes the gain at the opening difference.
    const air = (RAD_K * 4 + BASE_K * 4) * (0 / 100);
    const gain = (COND_K * 2 * 80 - air) * dt;
    expect(b.heat).toBeCloseTo(gain, 10);
  });
});

describe("the movers", () => {
  it("warms an emitter toward the Forge's setpoint and never past it", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["forge", 22, 20],
    ]);
    const arc = state.towers[0];
    arc.heat = 0;
    const dt = 0.001;
    resolveHeat(state.towers, state.floor, dt, NO_SHOTS);
    expect(arc.heat).toBeCloseTo(FORGE_K * 2 * 72 * dt, 10);

    arc.heat = 90;
    const before = arc.heat;
    resolveHeat(state.towers, state.floor, 0.01, NO_SHOTS);
    expect(arc.heat).toBeLessThan(before);
  });

  it("drains an emitter through a face nothing else could cool", () => {
    const boxed = floorWith([
      ["arc", 20, 20],
      ["arc", 18, 20],
      ["arc", 20, 18],
      ["arc", 20, 22],
      ["sink", 22, 20],
    ]);
    const arc = boxed.towers[0];
    for (const tower of boxed.towers) tower.heat = 50;
    const dt = 0.001;
    resolveHeat(boxed.towers, boxed.floor, dt, NO_SHOTS);
    expect(arc.heat).toBeLessThan(50);
  });

  it("carries no heat on a mover, whatever it is touching", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["forge", 22, 20],
    ]);
    state.towers[0].heat = 100;
    resolveHeat(state.towers, state.floor, 0.1, NO_SHOTS);
    expect(state.towers[1].heat).toBe(0);
  });

  it("stacks two Forges on one emitter", () => {
    const one = floorWith([
      ["arc", 20, 20],
      ["forge", 22, 20],
    ]);
    const two = floorWith([
      ["arc", 20, 20],
      ["forge", 22, 20],
      ["forge", 18, 20],
    ]);
    resolveHeat(one.towers, one.floor, 0.01, NO_SHOTS);
    resolveHeat(two.towers, two.floor, 0.01, NO_SHOTS);
    expect(two.towers[0].heat).toBeGreaterThan(one.towers[0].heat);
  });
});

describe("shots", () => {
  it("adds the frame's shots at their full per-shot heat, undivided by dt", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    resolveHeat(state.towers, state.floor, 0.001, new Map([[tower.id, 2]]));
    expect(tower.heat).toBeCloseTo(2 * 10.3, 6);
  });
});

describe("the trip", () => {
  it("trips on the frame its heat reaches 100 from below", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    tower.heat = 95;
    const tripped = resolveHeat(
      state.towers,
      state.floor,
      0.001,
      new Map([[tower.id, 1]]),
    );
    expect(tripped).toEqual([tower.id]);
    expect(tower.tripped).toBe(true);
    expect(tower.tripTimer).toBeCloseTo(TRIP_TIME, 10);
    expect(tower.heat).toBe(100);
  });

  it("does not trip a tower posed at 100, because it is cooling", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    tower.heat = 100;
    const tripped = resolveHeat(state.towers, state.floor, 0.01, NO_SHOTS);
    expect(tripped).toEqual([]);
    expect(tower.tripped).toBe(false);
    expect(tower.heat).toBeLessThan(100);
  });

  it("bleeds a tripped tower at twenty a second whatever its faces", () => {
    const boxed = floorWith([
      ["arc", 20, 20],
      ["arc", 18, 20],
      ["arc", 22, 20],
      ["arc", 20, 18],
      ["arc", 20, 22],
    ]);
    const tower = boxed.towers[0];
    tower.heat = 100;
    tower.tripped = true;
    tower.tripTimer = TRIP_TIME;
    resolveHeat(boxed.towers, boxed.floor, 1, NO_SHOTS);
    expect(tower.heat).toBeCloseTo(80, 10);
    expect(tower.tripTimer).toBeCloseTo(TRIP_TIME - 1, 10);
    expect(tower.tripped).toBe(true);
  });

  it("returns a tripped tower online at heat zero when its cooldown ends", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    tower.heat = 100;
    tower.tripped = true;
    tower.tripTimer = TRIP_TIME;
    for (let i = 0; i < 299; i += 1) {
      resolveHeat(state.towers, state.floor, TRIP_TIME / 300, NO_SHOTS);
    }
    expect(tower.tripped).toBe(true);
    resolveHeat(state.towers, state.floor, TRIP_TIME / 100, NO_SHOTS);
    expect(tower.tripped).toBe(false);
    expect(tower.tripTimer).toBe(0);
    expect(tower.heat).toBe(0);
  });

  it("takes a tripped tower out of every term of the frame", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    const [tripped, neighbour] = state.towers;
    tripped.heat = 100;
    tripped.tripped = true;
    tripped.tripTimer = TRIP_TIME;
    neighbour.heat = 0;
    resolveHeat(state.towers, state.floor, 0.01, NO_SHOTS);
    expect(neighbour.heat).toBe(0);
  });
});

describe("the faculty gates", () => {
  it("holds a tower's heat exactly where it was posed with thermal off", () => {
    const state = floorWith([["arc", 20, 20]]);
    const tower = state.towers[0];
    tower.heat = 70;
    tower.thermalEnabled = false;
    resolveHeat(state.towers, state.floor, 1, new Map([[tower.id, 3]]));
    expect(tower.heat).toBe(70);
    expect(tower.tripped).toBe(false);
  });

  it("runs a tower's thermal model exactly as an idle one's with firing off", () => {
    const gated = floorWith([["arc", 20, 20]]);
    const idle = floorWith([["arc", 20, 20]]);
    gated.towers[0].firingEnabled = false;
    gated.towers[0].heat = 60;
    idle.towers[0].heat = 60;
    resolveHeat(gated.towers, gated.floor, 0.05, NO_SHOTS);
    resolveHeat(idle.towers, idle.floor, 0.05, NO_SHOTS);
    expect(gated.towers[0].heat).toBeCloseTo(idle.towers[0].heat, 12);
  });

  it("takes a thermal-gated tower out of its neighbour's conduction", () => {
    const state = floorWith([
      ["arc", 20, 20],
      ["arc", 22, 20],
    ]);
    const [held, neighbour] = state.towers;
    held.heat = 100;
    held.thermalEnabled = false;
    neighbour.heat = 0;
    resolveHeat(state.towers, state.floor, 0.05, NO_SHOTS);
    expect(neighbour.heat).toBe(0);
    expect(held.heat).toBe(100);
  });
});
