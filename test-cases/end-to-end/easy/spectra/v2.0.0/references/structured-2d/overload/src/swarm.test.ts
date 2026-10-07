import { describe, expect, it } from "vitest";
import {
  DIVE_FIRE_Y,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  OVERLOAD_DIVE_SCALE,
  PRISM_INVERT_Y,
  SWAY_AMP,
  SWAY_PERIOD,
  diveGapScale,
  droneSpeedScale,
  slotX,
  slotY,
  swayOffset,
} from "./constants";
import { liveState, poseDrone, run, runUntil, STEP } from "./fixtures";
import { buildWave } from "./waves";
import { diveSpeed, releaseTime, slotPoint, travelScale } from "./swarm";
import { addDroneTo } from "./drones";

function wave(stage = 1) {
  const state = liveState();
  state.stage = stage;
  state.waveEntry = true;
  buildWave(state);
  return state;
}

describe("the entrance", () => {
  it("releases a group when the wave's clock reaches its own gap", () => {
    const state = wave();
    for (const drone of state.drones) {
      expect(releaseTime(drone)).toBeCloseTo(
        ENTER_GROUP_GAP * drone.entryGroup,
        6,
      );
    }
  });

  it("holds an unreleased drone at its starting point", () => {
    const state = wave();
    const late = state.drones.filter((drone) => drone.entryGroup === 2);
    const before = late.map((drone) => `${drone.x},${drone.y}`);
    run(state, 0.4);
    expect(late.map((drone) => `${drone.x},${drone.y}`)).toEqual(before);
  });

  it("carries every drone across the field's top within a second of release", () => {
    // Over several drawn layouts, so the widest row a wave can draw is covered.
    for (let draw = 0; draw < 6; draw += 1) {
      const state = wave();
      const crossed = new Map<number, number>();
      for (let frame = 0; frame < 60 * 12; frame += 1) {
        run(state, STEP);
        for (const drone of state.drones) {
          if (drone.y >= FIELD_TOP && !crossed.has(drone.id)) {
            crossed.set(drone.id, state.simTime - releaseTime(drone));
          }
        }
      }
      expect(crossed.size).toBe(state.drones.length);
      for (const late of crossed.values()) expect(late).toBeLessThanOrEqual(1);
    }
  });

  it("settles every drone into its slot within six seconds of its release", () => {
    const state = wave();
    const settled = new Map<number, number>();
    for (let frame = 0; frame < 60 * 14; frame += 1) {
      run(state, STEP);
      for (const drone of state.drones) {
        if (drone.phase === "formation" && !settled.has(drone.id)) {
          settled.set(drone.id, state.simTime - releaseTime(drone));
        }
      }
      if (settled.size === state.drones.length) break;
    }
    expect(settled.size).toBe(state.drones.length);
    for (const took of settled.values()) expect(took).toBeLessThanOrEqual(6);
  });

  it("travels its entrance at the stage's own speed", () => {
    const state = wave();
    const drone = state.drones[0];
    run(state, 0.2);
    let covered = 0;
    let last = { x: drone.x, y: drone.y };
    for (let frame = 0; frame < 60; frame += 1) {
      run(state, STEP);
      covered += Math.hypot(drone.x - last.x, drone.y - last.y);
      last = { x: drone.x, y: drone.y };
    }
    expect(covered).toBeGreaterThan(ENTER_SPEED * 0.9);
    expect(covered).toBeLessThan(ENTER_SPEED * 1.1);
  });

  it("flies a continuous path, never jumping more than a frame's travel", () => {
    const state = wave();
    const drone = state.drones[0];
    let previous = { x: drone.x, y: drone.y };
    const limit = ENTER_SPEED * STEP * 1.4;
    for (let frame = 0; frame < 60 * 8; frame += 1) {
      run(state, STEP);
      if (drone.phase !== "entering") break;
      expect(
        Math.hypot(drone.x - previous.x, drone.y - previous.y),
      ).toBeLessThan(limit);
      previous = { x: drone.x, y: drone.y };
    }
  });

  it("brings a Prism in alongside two Shards of opposite bands", () => {
    const state = wave();
    let together = false;
    for (let frame = 0; frame < 60 * 10 && !together; frame += 1) {
      run(state, STEP);
      const prism = state.drones.find((drone) => drone.kind === "prism");
      if (prism === undefined || prism.phase !== "entering") continue;
      const near = state.drones.filter(
        (drone) =>
          drone.kind === "shard" &&
          drone.phase === "entering" &&
          Math.hypot(drone.x - prism.x, drone.y - prism.y) <= 320,
      );
      together =
        near.some((drone) => drone.band === "cyan") &&
        near.some((drone) => drone.band === "magenta");
    }
    expect(together).toBe(true);
  });

  it("runs faster at a later stage, and not on a challenge stage", () => {
    expect(travelScale(wave(5))).toBeCloseTo(droneSpeedScale(5), 6);
    expect(travelScale(wave(3))).toBe(1);
    expect(travelScale(wave(9))).toBe(1);
  });
});

describe("the formation", () => {
  it("holds every drone at its slot plus the one sway offset", () => {
    const state = liveState();
    const drones = [0, 2, 4, 6, 8].map((col) =>
      poseDrone(state, "shard", slotX(col), slotY(1), {
        slotX: slotX(col),
        slotY: slotY(1),
        travel: true,
      }),
    );
    for (let frame = 0; frame < 60 * 5; frame += 1) {
      run(state, STEP);
      const offset = swayOffset(state.swayClock);
      for (const drone of drones) {
        expect(drone.x).toBeCloseTo(drone.slotX + offset, 6);
        expect(drone.y).toBeCloseTo(drone.slotY, 6);
      }
    }
  });

  it("swings the whole block the stated amplitude over the stated period", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", slotX(4), slotY(0), {
      slotX: slotX(4),
      slotY: slotY(0),
      travel: true,
    });
    let low = Infinity;
    let high = -Infinity;
    for (let frame = 0; frame < Math.round(SWAY_PERIOD * 60); frame += 1) {
      run(state, STEP);
      low = Math.min(low, drone.x);
      high = Math.max(high, drone.x);
    }
    expect(high - low).toBeGreaterThan(SWAY_AMP * 2 * 0.9);
    expect(high - low).toBeLessThan(SWAY_AMP * 2 * 1.1);
  });

  it("holds a drone still while its travel is gated off", () => {
    const state = liveState();
    const held = poseDrone(state, "shard", 400, 200, { travel: false });
    const moving = poseDrone(state, "shard", 500, 200, {
      slotX: 500,
      slotY: 200,
      travel: true,
    });
    run(state, 1);
    expect(held.x).toBe(400);
    expect(held.y).toBe(200);
    expect(moving.x).not.toBe(500);
  });

  it("reports the slot point with the live sway", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 0, 0, { slotX: 100, slotY: 200 });
    state.swayClock = SWAY_PERIOD / 4;
    expect(slotPoint(state, drone).x).toBeCloseTo(100 + SWAY_AMP, 6);
  });
});

describe("the dive", () => {
  function posedFormation(stage = 1) {
    const state = liveState();
    state.stage = stage;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        poseDrone(state, "shard", slotX(col), slotY(row), {
          slotX: slotX(col),
          slotY: slotY(row),
          phase: "formation",
          travel: true,
        });
      }
    }
    return state;
  }

  it("launches its first dive when the clock reaches the first delay", () => {
    const state = posedFormation();
    state.diveClock = 0;
    state.diveLaunching = true;
    const { elapsed } = runUntil(
      state,
      () => state.drones.some((drone) => drone.phase === "diving"),
      6,
    );
    expect(elapsed).toBeGreaterThan(DIVE_FIRST_DELAY * 0.8);
    expect(elapsed).toBeLessThan(DIVE_FIRST_DELAY * 1.2);
  });

  it("keeps every later gap inside the stated range", () => {
    const state = posedFormation();
    state.diveClock = 0;
    state.diveLaunching = true;
    const launches: number[] = [];
    // A launch is a drone leaving the formation for a dive, counted whichever
    // drone the launcher drew and however often the same one is drawn again.
    const phases = new Map(
      state.drones.map((drone) => [drone.id, drone.phase]),
    );
    for (let frame = 0; frame < 60 * 20; frame += 1) {
      run(state, STEP);
      for (const drone of state.drones) {
        if (drone.phase === "diving" && phases.get(drone.id) === "formation") {
          launches.push(state.simTime);
        }
        phases.set(drone.id, drone.phase);
      }
    }
    expect(launches.length).toBeGreaterThan(3);
    for (let index = 1; index < launches.length; index += 1) {
      const gap = launches[index] - launches[index - 1];
      expect(gap).toBeGreaterThan(DIVE_GAP_MIN * 0.8);
      expect(gap).toBeLessThan(DIVE_GAP_MAX * 1.2);
    }
  });

  it("launches nothing while dive launching is gated off", () => {
    const state = posedFormation();
    state.diveLaunching = false;
    run(state, 20);
    expect(state.drones.every((drone) => drone.phase === "formation")).toBe(
      true,
    );
    expect(state.diveClock).toBe(0);
  });

  it("carries the diver away from its slot", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", slotX(4), slotY(0), {
      slotX: slotX(4),
      slotY: slotY(0),
      phase: "diving",
      travel: true,
    });
    run(state, 0.5);
    expect(drone.y).toBeGreaterThan(slotY(0) + 60);
  });

  it("runs at the stage's dive speed", () => {
    for (const stage of [1, 5]) {
      const state = liveState();
      state.stage = stage;
      const drone = poseDrone(state, "shard", 640, 200, {
        slotX: 640,
        slotY: 200,
        phase: "diving",
        travel: true,
      });
      let covered = 0;
      let last = { x: drone.x, y: drone.y };
      for (let frame = 0; frame < 60; frame += 1) {
        run(state, STEP);
        covered += Math.hypot(drone.x - last.x, drone.y - last.y);
        last = { x: drone.x, y: drone.y };
        if (drone.phase !== "diving") break;
      }
      const expected = DIVE_SPEED * droneSpeedScale(stage);
      expect(covered).toBeGreaterThan(expected * 0.85);
      expect(covered).toBeLessThan(expected * 1.15);
    }
  });

  it("bends toward the ship, whichever side it is on", () => {
    for (const shipX of [80, 1200]) {
      const state = liveState();
      state.ship.x = shipX;
      const drone = poseDrone(state, "shard", 640, slotY(0), {
        slotX: 640,
        slotY: slotY(0),
        phase: "diving",
        travel: true,
      });
      const gap = Math.abs(shipX - drone.x);
      let closest = gap;
      for (let frame = 0; frame < 60 * 4; frame += 1) {
        run(state, STEP);
        closest = Math.min(closest, Math.abs(shipX - drone.x));
        if (drone.phase !== "diving") break;
      }
      expect(gap - closest).toBeGreaterThan(gap / 3);
    }
  });

  it("holds at most one discontinuity, and only as a wrap through the bottom", () => {
    for (const id of [0, 1]) {
      const state = liveState();
      // Two dives, so both endings a dive may have are exercised.
      for (let index = 0; index <= id; index += 1) {
        poseDrone(state, "shard", 400 + index * 120, slotY(0), {
          slotX: 400 + index * 120,
          slotY: slotY(0),
          phase: "diving",
          travel: true,
        });
      }
      const drone = state.drones[id];
      const limit = DIVE_SPEED * STEP * 1.6;
      let jumps = 0;
      let previous = { x: drone.x, y: drone.y };
      for (let frame = 0; frame < 60 * 9; frame += 1) {
        run(state, STEP);
        const moved = Math.hypot(drone.x - previous.x, drone.y - previous.y);
        if (moved > limit) {
          jumps += 1;
          expect(previous.y).toBeGreaterThan(FIELD_BOTTOM - 40);
          expect(drone.y).toBeLessThan(FIELD_TOP + 40);
        }
        previous = { x: drone.x, y: drone.y };
        if (drone.phase === "formation") break;
      }
      expect(jumps).toBeLessThanOrEqual(1);
    }
  });

  it("turns a looping dive back above the bottom strip", () => {
    const state = liveState();
    // An even id never wraps, so this dive is the one that turns back.
    poseDrone(state, "shard", 400, slotY(0), {
      slotX: 400,
      slotY: slotY(0),
      phase: "diving",
      travel: true,
    });
    const drone = state.drones[0];
    let lowest = drone.y;
    for (let frame = 0; frame < 60 * 9; frame += 1) {
      run(state, STEP);
      lowest = Math.max(lowest, drone.y);
      if (drone.phase === "formation") break;
    }
    expect(lowest).toBeLessThan(HUD_BOTTOM_TOP);
    expect(drone.phase).toBe("formation");
  });

  it("brings a surviving diver home to its slot", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", slotX(4), slotY(1), {
      slotX: slotX(4),
      slotY: slotY(1),
      phase: "diving",
      travel: true,
    });
    const { held } = runUntil(state, () => drone.phase === "formation", 14);
    expect(held).toBe(true);
    expect(drone.x).toBeCloseTo(drone.slotX + swayOffset(state.swayClock), 3);
    expect(drone.y).toBeCloseTo(drone.slotY, 3);
  });

  it("plunges faster than a dive when the plunge is on", () => {
    const measure = (plunge: boolean): number => {
      const state = liveState();
      const drone = poseDrone(state, "shard", 640, 200, {
        slotX: 640,
        slotY: 200,
        phase: "diving",
        travel: true,
      });
      drone.plunge = plunge;
      let covered = 0;
      let last = { x: drone.x, y: drone.y };
      for (let frame = 0; frame < 40; frame += 1) {
        run(state, STEP);
        covered += Math.hypot(drone.x - last.x, drone.y - last.y);
        last = { x: drone.x, y: drone.y };
      }
      return covered;
    };
    const ratio = measure(true) / measure(false);
    expect(ratio).toBeGreaterThan(OVERLOAD_DIVE_SCALE * 0.9);
    expect(ratio).toBeLessThan(OVERLOAD_DIVE_SCALE * 1.1);
    const state = liveState();
    const drone = addDroneTo(state, "shard", 0, 0);
    drone.plunge = true;
    expect(diveSpeed(state, drone)).toBeCloseTo(
      DIVE_SPEED * OVERLOAD_DIVE_SCALE,
      6,
    );
  });
});

describe("enemy fire", () => {
  function diver(kind: "shard" | "flux" | "prism", bandClock = 0) {
    const state = liveState();
    const drone = poseDrone(state, kind, 640, DIVE_FIRE_Y - 40, {
      slotX: 640,
      slotY: slotY(0),
      phase: "diving",
      travel: true,
      fire: true,
      bandClock,
    });
    return { state, drone };
  }

  it("fires nothing until the diver crosses the fire line", () => {
    const { state, drone } = diver("shard");
    while (drone.y < DIVE_FIRE_Y) {
      expect(state.bullets.length).toBe(0);
      run(state, STEP);
    }
    expect(state.bullets.length).toBe(1);
  });

  it("gives a Shard exactly one shot over its dive", () => {
    const { state } = diver("shard");
    run(state, 6);
    const fired = state.bullets.filter((bullet) => !bullet.friendly);
    expect(fired.length).toBeLessThanOrEqual(1);
    const seen = new Set<number>();
    const state2 = diver("shard").state;
    for (let frame = 0; frame < 60 * 6; frame += 1) {
      run(state2, STEP);
      for (const bullet of state2.bullets) {
        if (!bullet.friendly) seen.add(bullet.id);
      }
    }
    expect(seen.size).toBe(1);
  });

  it("gives a Prism two shots, one of each band, together", () => {
    const { state } = diver("prism");
    const seen = new Map<number, string>();
    for (let frame = 0; frame < 60 * 6; frame += 1) {
      run(state, STEP);
      for (const bullet of state.bullets) {
        if (!bullet.friendly) seen.set(bullet.id, bullet.band);
      }
    }
    expect(seen.size).toBe(2);
    expect(new Set(seen.values())).toEqual(new Set(["cyan", "magenta"]));
  });

  it("keeps a shimmering Flux silent until it settles", () => {
    const { state, drone } = diver("flux", 1.6);
    drone.oscillation = true;
    let firedWhileShimmering = 0;
    for (let frame = 0; frame < 60 * 3; frame += 1) {
      const before = state.bullets.length;
      run(state, STEP);
      if (state.bullets.length > before && drone.bandClock >= 1.6) {
        firedWhileShimmering += 1;
      }
    }
    expect(firedWhileShimmering).toBe(0);
    expect(
      state.bullets.filter((bullet) => !bullet.friendly).length,
    ).toBeLessThanOrEqual(1);
  });

  it("stays silent through a whole dive while its fire is gated off", () => {
    const { state, drone } = diver("shard");
    drone.fire = false;
    run(state, 6);
    expect(state.bullets.length).toBe(0);
  });

  it("fires nothing at all from the formation", () => {
    const state = liveState();
    for (let col = 0; col < 9; col += 1) {
      poseDrone(state, "shard", slotX(col), slotY(0), {
        slotX: slotX(col),
        slotY: slotY(0),
        phase: "formation",
        travel: true,
        fire: true,
      });
    }
    run(state, 10);
    expect(state.bullets.length).toBe(0);
  });

  it("gives a Prism reaching the invert line an inversion and a way home", () => {
    const state = liveState();
    const prism = poseDrone(state, "prism", 640, PRISM_INVERT_Y - 60, {
      slotX: 640,
      slotY: slotY(0),
      phase: "diving",
      travel: true,
    });
    const cues = runUntil(state, () => state.inversion > 0, 3);
    expect(cues.held).toBe(true);
    expect(prism.phase).toBe("returning");
    expect(state.drones).toContain(prism);
  });

  it("scales the gap between dives with the stage", () => {
    expect(diveGapScale(1)).toBe(1);
    expect(diveGapScale(5)).toBeCloseTo(0.8, 6);
    expect(diveGapScale(20)).toBeCloseTo(0.55, 6);
    expect(diveGapScale(40)).toBeCloseTo(0.55, 6);
  });
});
