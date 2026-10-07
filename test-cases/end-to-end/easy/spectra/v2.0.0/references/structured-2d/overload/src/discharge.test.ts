import { describe, expect, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  MAX_BURSTS,
  RESONANCE_MAX,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
} from "./constants";
import { addEnemyBulletTo, addPlayerBulletTo } from "./bullets";
import { releaseDischarge } from "./ship";
import { noCues } from "./audio";
import { liveState, poseDrone, run } from "./fixtures";

function charged() {
  const state = liveState();
  state.resonance = RESONANCE_MAX;
  return state;
}

describe("releasing a discharge", () => {
  it("spends the whole meter and starts the wave", () => {
    const state = charged();
    const cues = noCues();
    releaseDischarge(state, cues);
    expect(state.resonance).toBe(0);
    expect(state.discharge.active).toBe(true);
    expect(cues.discharge).toBe(true);
  });

  it("does nothing a point below full", () => {
    const state = liveState();
    state.resonance = RESONANCE_MAX - 1;
    releaseDischarge(state, noCues());
    expect(state.resonance).toBe(RESONANCE_MAX - 1);
    expect(state.discharge.active).toBe(false);
  });

  it("runs for its own span and then stops", () => {
    const state = charged();
    releaseDischarge(state, noCues());
    run(state, DISCHARGE_TIME * 0.8);
    expect(state.discharge.active).toBe(true);
    expect(state.discharge.radius).toBeGreaterThan(DISCHARGE_MAX_R * 0.7);
    run(state, DISCHARGE_TIME * 0.4);
    expect(state.discharge.active).toBe(false);
    expect(state.discharge.radius).toBe(0);
  });
});

describe("what the wave takes", () => {
  it("destroys every entering, diving and returning drone", () => {
    for (const phase of ["entering", "diving", "returning"] as const) {
      const state = charged();
      poseDrone(state, "shard", 400, 300, { phase });
      releaseDischarge(state, noCues());
      run(state, DISCHARGE_TIME);
      expect(state.drones).toHaveLength(0);
    }
  });

  it("spares the formation", () => {
    const state = charged();
    poseDrone(state, "shard", 400, 300, { phase: "formation" });
    releaseDischarge(state, noCues());
    run(state, DISCHARGE_TIME);
    expect(state.drones).toHaveLength(1);
  });

  it("ignores the bands it and its targets carry", () => {
    for (const shipBand of ["cyan", "magenta"] as const) {
      const state = charged();
      state.ship.band = shipBand;
      poseDrone(state, "shard", 300, 300, { phase: "diving", band: "cyan" });
      poseDrone(state, "shard", 900, 300, { phase: "diving", band: "magenta" });
      releaseDischarge(state, noCues());
      run(state, DISCHARGE_TIME);
      expect(state.drones).toHaveLength(0);
    }
  });

  it("clears the enemy fire and spares the player's own", () => {
    const state = charged();
    addEnemyBulletTo(state, 500, 560, "cyan");
    const mine = addPlayerBulletTo(state, 520, 580, "cyan");
    releaseDischarge(state, noCues());
    run(state, 0.2);
    expect(state.bullets).toEqual([mine]);
  });

  it("destroys a diving Prism whole, paying both layers", () => {
    const state = charged();
    // A bystander in the formation, which the wave spares, so the stage does not
    // clear and its bonus does not join the figure under test.
    poseDrone(state, "shard", 900, 200, { phase: "formation" });
    poseDrone(state, "prism", 400, 300, { phase: "diving" });
    releaseDischarge(state, noCues());
    run(state, DISCHARGE_TIME);
    expect(state.drones.map((drone) => drone.kind)).toEqual(["shard"]);
    expect(state.score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    expect(state.bursts).toHaveLength(1);
  });

  it("pays each drone its diving figure and fills no meter", () => {
    const state = charged();
    poseDrone(state, "shard", 900, 200, { phase: "formation" });
    for (let index = 0; index < 3; index += 1) {
      poseDrone(state, "shard", 300 + index * 100, 300, { phase: "diving" });
    }
    releaseDischarge(state, noCues());
    run(state, DISCHARGE_TIME);
    expect(state.drones).toHaveLength(1);
    expect(state.score).toBe(SCORE_SHARD_DIVE * 3);
    expect(state.resonance).toBe(0);
    expect(state.bursts).toHaveLength(3);
  });

  it("caps how many bursts play at once", () => {
    const state = charged();
    for (let index = 0; index < MAX_BURSTS + 6; index += 1) {
      poseDrone(state, "shard", 200 + index * 30, 300, { phase: "diving" });
    }
    releaseDischarge(state, noCues());
    run(state, DISCHARGE_TIME * 0.5);
    expect(state.bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
  });

  it("reaches only what is inside its radius", () => {
    const state = charged();
    const near = poseDrone(state, "shard", state.ship.x, 560, {
      phase: "diving",
    });
    const far = poseDrone(state, "shard", 100, 100, { phase: "diving" });
    releaseDischarge(state, noCues());
    run(state, 1 / 60);
    expect(state.drones).toContain(far);
    expect(state.drones).not.toContain(near);
  });
});
