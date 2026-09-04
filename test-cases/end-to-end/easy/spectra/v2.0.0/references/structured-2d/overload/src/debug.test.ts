import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  OVERLOAD_AT,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SPECTRA_DEBUG_VERSION,
  START_LIVES,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
} from "./constants";
import { fluxWindowAt } from "./bands";
import {
  createHarness,
  lastBulletId,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";

let harness: Harness | null = null;

async function posed(): Promise<Harness> {
  harness ??= await createHarness();
  startPosed(harness.debug);
  return harness;
}

describe("the surface", () => {
  it("is the object the instance returned, at the stated version", async () => {
    const h = await posed();
    expect(h.engine.debug).toBe(h.debug);
    expect(h.debug.version).toBe(SPECTRA_DEBUG_VERSION);
  });

  it("reports every pose back through the snapshot", async () => {
    const h = await posed();
    const d = h.debug;

    d.setScreen("paused");
    d.setPhase("ready");
    d.setPhaseTimer(1.25);
    d.setMenuIndex(2);
    d.setScore(4321);
    d.setLives(5);
    d.setStage(6);
    d.setExtraLifeAwarded(true);
    d.setChallengeHits(17);
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    d.setStageClearing(false);
    d.setShipContact(false);
    d.setDiveClock(0.75);
    d.setShipX(300);
    d.setShipBand("magenta");
    d.setFireLockout(0.2);
    d.setFireCooldown(0.1);
    d.setResonance(64);
    d.setInversion(2.5);

    const before = d.snapshot();
    expect(before).toMatchObject({
      screen: "paused",
      phase: "ready",
      phaseTimer: 1.25,
      menuIndex: 2,
      mode: "overload",
      score: 4321,
      lives: 5,
      stage: 6,
      extraLifeAwarded: true,
      challengeHits: 17,
      waveEntry: false,
      diveLaunching: false,
      stageClearing: false,
      diveClock: 0.75,
      resonance: 64,
      inversion: 2.5,
      inversionActive: true,
      dischargeReady: false,
      isChallenge: true,
    });
    expect(before.ship).toMatchObject({
      x: 300,
      band: "magenta",
      alive: false,
      lockout: 0.2,
      cooldown: 0.1,
      contact: false,
    });
    expect(before.droneSpeedScale).toBeCloseTo(droneSpeedScale(6), 9);
    expect(before.bulletSpeedScale).toBeCloseTo(bulletSpeedScale(6), 9);
    expect(before.diveGapScale).toBeCloseTo(diveGapScale(6), 9);
    expect(before.fluxHold).toBeCloseTo(fluxHold(6), 9);
  });

  it("reports every drone pose back, on every kind", async () => {
    const h = await posed();
    const d = h.debug;
    for (const kind of ["shard", "flux", "prism"] as const) {
      d.addDrone(kind, 300, 220);
      const id = lastDroneId(d);
      d.setDronePosition(id, 410, 260);
      d.setDroneBand(id, "magenta");
      d.setDronePhase(id, "diving");
      d.setDroneSlot(id, 500, 180);
      d.setDroneBandClock(id, 0.5);
      d.setDroneShell(id, false);
      d.setDroneCharge(id, 2);
      d.setDroneTravel(id, false);
      d.setDroneOscillation(id, false);
      d.setDroneFire(id, false);
      const drone = d.snapshot().drones.find((entry) => entry.id === id);
      expect(drone).toMatchObject({
        kind,
        x: 410,
        y: 260,
        band: "magenta",
        phase: "diving",
        slotX: 500,
        slotY: 180,
        // A Flux's clock and a Prism's shell; on the other kinds the surface
        // reports the fixed figure (specs/instrumentation.md).
        bandClock: kind === "flux" ? 0.5 : 0,
        shellAlive: kind !== "prism",
        charge: 2,
        travel: false,
        oscillation: false,
        fire: false,
      });
    }
  });

  it("appends what it adds, with an id of its own", async () => {
    const h = await posed();
    const d = h.debug;
    d.addDrone("shard", 200, 200);
    const first = lastDroneId(d);
    d.addDrone("flux", 300, 200);
    const second = lastDroneId(d);
    expect(second).not.toBe(first);
    d.addPlayerBullet(400, 400, "cyan");
    const bullet = lastBulletId(d);
    d.addEnemyBullet(500, 400, "magenta");
    expect(lastBulletId(d)).not.toBe(bullet);
    const ids = d
      .snapshot()
      .drones.map((drone) => drone.id)
      .concat(d.snapshot().bullets.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an id across frames and across a phase change", async () => {
    const h = await posed();
    const d = h.debug;
    d.addDrone("prism", 400, 200);
    const id = lastDroneId(d);
    d.setDronePhase(id, "diving");
    d.setDroneShell(id, false);
    await h.advance(30);
    expect(d.snapshot().drones[0]?.id).toBe(id);
  });

  it("clamps a pose to the domain its own row states", async () => {
    const h = await posed();
    const d = h.debug;
    d.setStage(-4);
    expect(d.snapshot().stage).toBe(1);
    d.setResonance(9999);
    expect(d.snapshot().resonance).toBe(RESONANCE_MAX);
    expect(d.snapshot().dischargeReady).toBe(true);
    d.setResonance(-5);
    expect(d.snapshot().resonance).toBe(0);
    d.setShipX(99999);
    expect(d.snapshot().ship.x).toBe(SHIP_X_MAX);
    d.addDrone("flux", 400, 200);
    const id = lastDroneId(d);
    d.setDroneBandClock(id, 99);
    expect(d.snapshot().drones[0]?.bandClock).toBeCloseTo(fluxWindowAt(1), 9);
    d.setDroneCharge(id, 99);
    expect(d.snapshot().drones[0]?.charge).toBe(OVERLOAD_AT);
  });

  it("grants no extra life for posing the score across the threshold", async () => {
    const h = await posed();
    h.debug.setLives(START_LIVES);
    h.debug.setScore(999999);
    expect(h.debug.snapshot().lives).toBe(START_LIVES);
    expect(h.debug.snapshot().extraLifeAwarded).toBe(false);
  });

  it("spawns and clears nothing when the stage is posed", async () => {
    const h = await posed();
    h.debug.addDrone("shard", 400, 200);
    h.debug.addPlayerBullet(400, 500, "cyan");
    h.debug.setStage(9);
    const snap = h.debug.snapshot();
    expect(snap.drones).toHaveLength(1);
    expect(snap.bullets).toHaveLength(1);
    expect(snap.isChallenge).toBe(true);
  });

  it("removes one entity at a time, and one roster at a time", async () => {
    const h = await posed();
    const d = h.debug;
    d.addDrone("shard", 200, 200);
    const keep = lastDroneId(d);
    d.addDrone("shard", 300, 200);
    const drop = lastDroneId(d);
    d.addPlayerBullet(400, 500, "cyan");
    const mine = lastBulletId(d);
    d.addEnemyBullet(420, 300, "magenta");
    d.removeDrone(drop);
    expect(d.snapshot().drones.map((drone) => drone.id)).toEqual([keep]);
    d.removeBullet(mine);
    expect(d.snapshot().bullets.every((bullet) => !bullet.friendly)).toBe(true);
    d.addPlayerBullet(400, 500, "cyan");
    d.clearEnemyBullets();
    expect(d.snapshot().bullets.every((bullet) => bullet.friendly)).toBe(true);
    d.clearPlayerBullets();
    expect(d.snapshot().bullets).toHaveLength(0);
    expect(d.snapshot().drones).toHaveLength(1);
    d.clearDrones();
    expect(d.snapshot().drones).toHaveLength(0);
  });

  it("clears the bursts alone, leaving the drones and bullets standing", async () => {
    const h = await posed();
    const d = h.debug;
    d.addDrone("shard", 400, 200);
    d.addPlayerBullet(400, 200, "cyan");
    await h.advance(2);
    expect(d.snapshot().bursts.length).toBeGreaterThan(0);
    d.addDrone("shard", 800, 200);
    d.addPlayerBullet(200, 500, "cyan");
    d.clearBursts();
    const snap = d.snapshot();
    expect(snap.bursts).toHaveLength(0);
    expect(snap.drones).toHaveLength(1);
    expect(snap.bullets).toHaveLength(1);
  });

  it("steers a bullet where a caller puts it", async () => {
    const h = await posed();
    h.debug.addPlayerBullet(400, 400, "cyan");
    const id = lastBulletId(h.debug);
    h.debug.setBulletVelocity(id, 120, -60);
    const bullet = h.debug.snapshot().bullets[0];
    expect([bullet.vx, bullet.vy]).toEqual([120, -60]);
  });

  it("restores the title values and seeds the randomness", async () => {
    const h = await posed();
    h.debug.setScore(500);
    h.debug.addDrone("shard", 400, 200);
    h.debug.reset({ seed: 7 });
    const snap = h.debug.snapshot();
    expect(snap).toMatchObject({
      screen: "title",
      score: 0,
      lives: START_LIVES,
      stage: 1,
      resonance: 0,
      inversion: 0,
      waveEntry: true,
      diveLaunching: true,
      stageClearing: true,
      diveClock: 0,
      simTime: 0,
      extraLifeAwarded: false,
    });
    expect(snap.drones).toHaveLength(0);
    expect(snap.ship.contact).toBe(true);
    expect(DEFAULT_SEED).toBe(1);
  });

  it("builds the same wave from one seed and a different one from another", async () => {
    const h = await createHarness();
    const build = async (seed: number): Promise<string> => {
      h.debug.reset({ seed });
      h.debug.setScreen("stageIntro");
      h.debug.setPhaseTimer(0);
      await h.advance(1);
      return h.debug
        .snapshot()
        .drones.map(
          (drone) =>
            `${drone.kind}@${drone.slotX},${drone.slotY}:${drone.band}`,
        )
        .join("|");
    };
    const seven = await build(7);
    expect(await build(7)).toBe(seven);
    expect(await build(8)).not.toBe(seven);
    h.dispose();
  });
});
