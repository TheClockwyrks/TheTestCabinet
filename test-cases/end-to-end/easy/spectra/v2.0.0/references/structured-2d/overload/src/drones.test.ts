import { describe, expect, it } from "vitest";
import {
  FLUX_HALF,
  FLUX_SIZE,
  OVERLOAD_AT,
  PRISM_CORE_HALF,
  PRISM_CORE_SIZE,
  PRISM_HALF,
  PRISM_SIZE,
  SHARD_HALF,
  SHARD_SIZE,
  fluxCycle,
  fluxHold,
} from "./constants";
import { fluxWindowAt, shimmering } from "./bands";
import {
  addDroneTo,
  advanceOscillation,
  droneById,
  droneFootprint,
  droneHalf,
  droneShots,
  removeDrone,
  setDronePhase,
} from "./drones";
import { liveState, titleState } from "./fixtures";

describe("adding a drone", () => {
  it("appends it with a fresh id and every faculty on", () => {
    const state = titleState();
    const first = addDroneTo(state, "shard", 100, 200);
    const second = addDroneTo(state, "flux", 300, 200);
    expect(state.drones[state.drones.length - 1]).toBe(second);
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({
      band: "cyan",
      phase: "formation",
      slotX: 100,
      slotY: 200,
      bandClock: 0,
      shellAlive: true,
      charge: 0,
      travel: true,
      oscillation: true,
      fire: true,
    });
  });

  it("finds and removes one by id, leaving the others alone", () => {
    const state = titleState();
    const a = addDroneTo(state, "shard", 100, 200);
    const b = addDroneTo(state, "shard", 200, 200);
    expect(droneById(state, b.id)).toBe(b);
    removeDrone(state, a.id);
    expect(state.drones).toEqual([b]);
    expect(b.id).toBe(2);
  });
});

describe("each kind's figures", () => {
  it("draws and collides at its own extent", () => {
    const state = titleState();
    const shard = addDroneTo(state, "shard", 0, 0);
    const flux = addDroneTo(state, "flux", 0, 0);
    const prism = addDroneTo(state, "prism", 0, 0);
    expect([droneFootprint(shard), droneHalf(shard)]).toEqual([
      SHARD_SIZE,
      SHARD_HALF,
    ]);
    expect([droneFootprint(flux), droneHalf(flux)]).toEqual([
      FLUX_SIZE,
      FLUX_HALF,
    ]);
    expect([droneFootprint(prism), droneHalf(prism)]).toEqual([
      PRISM_SIZE,
      PRISM_HALF,
    ]);
    prism.shellAlive = false;
    expect([droneFootprint(prism), droneHalf(prism)]).toEqual([
      PRISM_CORE_SIZE,
      PRISM_CORE_HALF,
    ]);
  });

  it("takes its own number of shots over a dive", () => {
    const state = titleState();
    expect(droneShots(addDroneTo(state, "shard", 0, 0))).toBe(1);
    expect(droneShots(addDroneTo(state, "flux", 0, 0))).toBe(1);
    expect(droneShots(addDroneTo(state, "prism", 0, 0))).toBe(2);
  });
});

describe("a phase change", () => {
  it("restarts the clock the phase's path runs from", () => {
    const state = titleState();
    const drone = addDroneTo(state, "shard", 0, 0);
    drone.phaseClock = 3;
    drone.shotsFired = 1;
    drone.plunge = true;
    setDronePhase(drone, "diving");
    expect(drone.phase).toBe("diving");
    expect(drone.phaseClock).toBe(0);
    expect(drone.shotsFired).toBe(0);
    expect(drone.plunge).toBe(false);
  });

  it("changes nothing when the phase is already the one asked for", () => {
    const state = titleState();
    const drone = addDroneTo(state, "shard", 0, 0);
    drone.phaseClock = 3;
    setDronePhase(drone, "formation");
    expect(drone.phaseClock).toBe(3);
  });
});

describe("a Flux's rhythm", () => {
  it("holds its band for the hold, then shimmers for the telegraph", () => {
    const state = liveState();
    const flux = addDroneTo(state, "flux", 300, 200);
    for (let step = 0; step < 1000; step += 1) {
      advanceOscillation(state, flux, fluxHold(1) / 1000);
    }
    expect(flux.band).toBe("cyan");
    expect(shimmering(flux, 1)).toBe(true);
  });

  it("flips its stored band at the end of a window and rewinds the clock", () => {
    const state = liveState();
    const flux = addDroneTo(state, "flux", 300, 200);
    const window = fluxWindowAt(1);
    for (let step = 0; step < 1000; step += 1) {
      advanceOscillation(state, flux, window / 1000);
    }
    expect(flux.band).toBe("magenta");
    expect(flux.bandClock).toBeCloseTo(0, 6);
    expect(shimmering(flux, 1)).toBe(false);
  });

  it("comes back to the band it started on after a full cycle", () => {
    const state = liveState();
    const flux = addDroneTo(state, "flux", 300, 200);
    for (let step = 0; step < 2000; step += 1) {
      advanceOscillation(state, flux, fluxCycle(1) / 2000);
    }
    expect(flux.band).toBe("cyan");
  });

  it("holds its band and its clock while the oscillation is gated off", () => {
    const state = liveState();
    const flux = addDroneTo(state, "flux", 300, 200);
    flux.oscillation = false;
    for (let step = 0; step < 2000; step += 1) {
      advanceOscillation(state, flux, fluxCycle(1) / 2000);
    }
    expect(flux.band).toBe("cyan");
    expect(flux.bandClock).toBe(0);
  });

  it("moves no other kind's band or clock", () => {
    const state = liveState();
    const shard = addDroneTo(state, "shard", 300, 200);
    const prism = addDroneTo(state, "prism", 400, 200);
    for (const drone of [shard, prism]) {
      for (let step = 0; step < 500; step += 1) {
        advanceOscillation(state, drone, 0.01);
      }
      expect(drone.band).toBe("cyan");
      expect(drone.bandClock).toBe(0);
    }
  });

  it("shortens its hold at a later stage", () => {
    expect(fluxHold(1)).toBeCloseTo(1.6, 6);
    expect(fluxHold(10)).toBeCloseTo(1.15, 6);
    expect(fluxHold(20)).toBeCloseTo(1, 6);
    expect(fluxHold(40)).toBeCloseTo(1, 6);
  });

  it("carries a charge no larger than the overload", () => {
    expect(OVERLOAD_AT).toBe(3);
  });
});
