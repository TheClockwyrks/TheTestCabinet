// The stage sequence, the challenge flyover, and how a later stage scales.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  FIELD_BOTTOM,
  FIELD_TOP,
  SCORE_CHALLENGE_DRONE,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  SHIP_Y,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "./constants";
import { LANE_CENTRE } from "./flow";
import {
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  startStage,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s));
});

afterEach(() => {
  h.dispose();
});

/** The stage's own wave, with its entry running and nothing else. */
async function openWave(stage: number): Promise<void> {
  startPosed(h, stage);
  h.pose((s, d) => d.setWaveEntry(s, true));
  await startStage(h, stage);
}

describe("a stage's sequence", () => {
  it("builds its wave as the intro gives way, and not before", async () => {
    startPosed(h);
    h.pose((s, d) => d.setWaveEntry(s, true));
    h.pose((s, d) => d.setScreen(s, "stageIntro"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_INTRO_HOLD));
    await h.advance(STAGE_INTRO_HOLD * 0.8);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().drones).toHaveLength(0);

    await h.advance(STAGE_INTRO_HOLD * 0.4);
    expect(h.snapshot().screen).toBe("inWave");
    expect(h.snapshot().drones.length).toBeGreaterThan(0);
  });

  it("plays on rather than clearing while its wave never held a drone", async () => {
    startPosed(h);
    await h.advance(10);
    expect(h.snapshot().screen).toBe("inWave");
    expect(h.snapshot().drones).toHaveLength(0);
  });

  it("clears as the last drone of its own wave is destroyed", async () => {
    await openWave(1);
    await h.advance(0.2);
    h.pose((s, d) => d.setWaveEntry(s, false));
    const drones = h.snapshot().drones;
    expect(drones.length).toBeGreaterThan(1);
    for (const drone of drones.slice(0, -1)) {
      h.pose((s, d) => d.removeDrone(s, drone.id));
    }
    expect(h.snapshot().screen).toBe("inWave");

    const survivor = h.snapshot().drones[0];
    h.pose((s, d) => d.setDroneShell(s, survivor?.id ?? 0, false));
    h.pose((s, d) => d.setDronePosition(s, survivor?.id ?? 0, 400, 300));
    const band = h.snapshot().drones[0]?.effectiveBand ?? "cyan";
    const before = h.snapshot().score;
    h.pose((s, d) => d.addPlayerBullet(s, 400, 340, band));
    await h.advance(0.2);
    expect(h.snapshot().drones).toHaveLength(0);
    expect(h.snapshot().screen).toBe("stageCleared");
    expect(h.snapshot().score).toBeGreaterThanOrEqual(
      before + SCORE_STAGE_CLEAR,
    );
  });

  it("opens the next stage's intro one number higher", async () => {
    startPosed(h);
    h.pose((s, d) => d.setStage(s, 4));
    h.pose((s, d) => d.setScreen(s, "stageCleared"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_CLEARED_HOLD));
    await h.advance(STAGE_CLEARED_HOLD * 0.8);
    expect(h.snapshot().screen).toBe("stageCleared");
    await h.advance(STAGE_CLEARED_HOLD * 0.4);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().stage).toBe(5);
  });
});

describe("a challenge stage", () => {
  it("falls on every third stage", () => {
    for (let stage = 1; stage <= 12; stage++) {
      h.pose((s, d) => d.setStage(s, stage));
      expect(h.snapshot().isChallenge).toBe(stage % CHALLENGE_EVERY === 0);
      expect(isChallengeStage(stage)).toBe(stage % CHALLENGE_EVERY === 0);
    }
  });

  it("sends its groups and never fires", async () => {
    await openWave(3);
    expect(h.snapshot().drones).toHaveLength(CHALLENGE_TOTAL);
    const groups = new Set(h.state.drones.map((drone) => drone.entryGroup));
    expect(groups.size).toBe(CHALLENGE_GROUPS);
    for (const group of groups) {
      expect(
        h.state.drones.filter((drone) => drone.entryGroup === group),
      ).toHaveLength(CHALLENGE_PER_GROUP);
    }
    for (let frame = 0; frame < 60 * 12; frame++) {
      await h.frames(1);
      expect(enemyBullets(h)).toHaveLength(0);
      if (h.snapshot().screen !== "inWave") break;
    }
  });

  it("sweeps every drone across and off the field", async () => {
    await openWave(3);
    let insideEver = false;
    for (let frame = 0; frame < 60 * 14; frame++) {
      await h.frames(1);
      const drones = h.snapshot().drones;
      if (
        drones.some(
          (drone) =>
            drone.x > 0 &&
            drone.x < 1280 &&
            drone.y > FIELD_TOP &&
            drone.y < FIELD_BOTTOM,
        )
      ) {
        insideEver = true;
      }
      expect(drones.every((drone) => drone.phase === "entering")).toBe(true);
      if (drones.length === 0) break;
    }
    expect(insideEver).toBe(true);
    expect(h.snapshot().drones).toHaveLength(0);
    expect(h.snapshot().screen).toBe("stageCleared");
  });

  it("costs no life when a drone reaches the ship", async () => {
    startPosed(h, 3);
    h.pose((s, d) => d.setShipContact(s, true));
    poseDrone(h, "shard", LANE_CENTRE, SHIP_Y);
    await h.advance(0.2);
    expect(h.snapshot().lives).toBe(START_LIVES);
  });

  it("pays each drone and the perfect bonus only when none survived", async () => {
    startPosed(h, 3);
    const first = poseDrone(h, "shard", 500, 300, { band: "cyan" });
    h.pose((s, d) => d.addPlayerBullet(s, 500, 340, "cyan"));
    await h.advance(0.2);
    expect(h.snapshot().score).toBe(SCORE_CHALLENGE_DRONE);
    expect(first).toBeGreaterThan(0);

    // A whole flyover, every drone taken, pays the bonus above the per-drone total.
    await openWave(3);
    h.pose((s, d) => d.setScore(s, 0));
    for (const drone of h.snapshot().drones) {
      h.pose((s, d) => d.setDronePosition(s, drone.id, 400, 300));
      h.pose((s, d) => d.addPlayerBullet(s, 400, 340, drone.effectiveBand));
      await h.advance(0.1);
    }
    expect(h.snapshot().screen).toBe("stageCleared");
    expect(h.snapshot().score).toBe(
      CHALLENGE_TOTAL * SCORE_CHALLENGE_DRONE + SCORE_PERFECT_BONUS,
    );
  });

  it("pays no stage bonus, and no perfect bonus when one got away", async () => {
    await openWave(3);
    h.pose((s, d) => d.setScore(s, 0));
    const drones = h.snapshot().drones;
    for (const drone of drones.slice(1)) {
      h.pose((s, d) => d.setDronePosition(s, drone.id, 400, 300));
      h.pose((s, d) => d.addPlayerBullet(s, 400, 340, drone.effectiveBand));
      await h.advance(0.1);
    }
    // The one left alive sweeps off the field on its own.
    for (let frame = 0; frame < 60 * 14; frame++) {
      await h.frames(1);
      if (h.snapshot().screen !== "inWave") break;
    }
    expect(h.snapshot().screen).toBe("stageCleared");
    expect(h.snapshot().score).toBe(
      (CHALLENGE_TOTAL - 1) * SCORE_CHALLENGE_DRONE,
    );
  });
});

describe("how a later stage scales", () => {
  it("reports the four figures its formulas give", () => {
    for (const stage of [1, 5, 10, 20, 40]) {
      h.pose((s, d) => d.setStage(s, stage));
      const snap = h.snapshot();
      expect(snap.droneSpeedScale).toBeCloseTo(droneSpeedScale(stage), 6);
      expect(snap.bulletSpeedScale).toBeCloseTo(bulletSpeedScale(stage), 6);
      expect(snap.diveGapScale).toBeCloseTo(diveGapScale(stage), 6);
      expect(snap.fluxHold).toBeCloseTo(fluxHold(stage), 6);
    }
    expect(droneSpeedScale(20)).toBe(1.5);
    expect(droneSpeedScale(40)).toBe(1.5);
    expect(bulletSpeedScale(20)).toBe(1.4);
    expect(bulletSpeedScale(40)).toBe(1.4);
    expect(diveGapScale(20)).toBe(0.55);
    expect(diveGapScale(40)).toBe(0.55);
    expect(fluxHold(20)).toBe(1);
    expect(fluxHold(40)).toBe(1);
  });

  it("flies a dive faster at a later stage", async () => {
    const travel = async (stage: number): Promise<number> => {
      startPosed(h, stage);
      const id = poseDrone(h, "shard", 640, 140, {
        phase: "diving",
        travel: true,
      });
      const from = h.snapshot().drones.find((drone) => drone.id === id);
      await h.advance(0.5);
      const now = h.snapshot().drones.find((drone) => drone.id === id);
      return Math.hypot(
        (now?.x ?? 0) - (from?.x ?? 0),
        (now?.y ?? 0) - (from?.y ?? 0),
      );
    };
    const one = await travel(1);
    const five = await travel(5);
    expect(five / one).toBeCloseTo(droneSpeedScale(5), 1);
  });

  it("runs a challenge flyover at the stage-one figures whatever stage it falls on", async () => {
    const sweep = async (stage: number): Promise<number> => {
      await openWave(stage);
      const from = h.snapshot().drones[0];
      await h.advance(1);
      const now = h.snapshot().drones.find((drone) => drone.id === from?.id);
      return Math.hypot(
        (now?.x ?? 0) - (from?.x ?? 0),
        (now?.y ?? 0) - (from?.y ?? 0),
      );
    };
    const third = await sweep(3);
    const ninth = await sweep(9);
    expect(ninth).toBeCloseTo(third, 1);
  });
});
