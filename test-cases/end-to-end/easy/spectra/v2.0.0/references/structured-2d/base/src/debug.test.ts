// The debug surface: every pose read back through the snapshot, and every
// derived field following what it is derived from.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "./constants";
import {
  createHarness,
  lastBulletId,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  startPosed(h.debug);
});

afterEach(() => {
  h.dispose();
});

describe("the surface itself", () => {
  it("reports its version", () => {
    expect(h.debug.version).toBe(SPECTRA_DEBUG_VERSION);
    expect(h.debug.snapshot().version).toBe(SPECTRA_DEBUG_VERSION);
  });

  it("names the mode this build ships", () => {
    expect(h.debug.snapshot().mode).toBe("sortie");
  });

  it("changes nothing when it only reads", async () => {
    h.debug.addDrone("flux", 400, 200);
    const before = JSON.stringify(h.debug.snapshot());
    h.debug.snapshot();
    h.debug.snapshot();
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("every pose reads back", () => {
  it("poses the screen, the phase, the hold and the highlight", () => {
    h.debug.setScreen("paused");
    h.debug.setPhase("ready");
    h.debug.setPhaseTimer(1.25);
    h.debug.setMenuIndex(2);
    const s = h.debug.snapshot();
    expect(s.screen).toBe("paused");
    expect(s.phase).toBe("ready");
    expect(s.phaseTimer).toBe(1.25);
    expect(s.menuIndex).toBe(2);
  });

  it("poses the run's figures", () => {
    h.debug.setScore(1234);
    h.debug.setLives(2);
    h.debug.setStage(4);
    h.debug.setExtraLifeAwarded(true);
    h.debug.setChallengeHits(17);
    const s = h.debug.snapshot();
    expect(s.score).toBe(1234);
    expect(s.lives).toBe(2);
    expect(s.stage).toBe(4);
    expect(s.extraLifeAwarded).toBe(true);
    expect(s.challengeHits).toBe(17);
  });

  it("poses the four world gates and the dive clock", () => {
    h.debug.setWaveEntry(true);
    h.debug.setDiveLaunching(true);
    h.debug.setStageClearing(true);
    h.debug.setShipContact(true);
    h.debug.setDiveClock(1.4);
    let s = h.debug.snapshot();
    expect(s.waveEntry).toBe(true);
    expect(s.diveLaunching).toBe(true);
    expect(s.stageClearing).toBe(true);
    expect(s.ship.contact).toBe(true);
    expect(s.diveClock).toBe(1.4);

    h.debug.setWaveEntry(false);
    h.debug.setDiveLaunching(false);
    h.debug.setStageClearing(false);
    h.debug.setShipContact(false);
    s = h.debug.snapshot();
    expect(s.waveEntry).toBe(false);
    expect(s.diveLaunching).toBe(false);
    expect(s.stageClearing).toBe(false);
    expect(s.ship.contact).toBe(false);
  });

  it("poses the ship and its cannon's clocks", () => {
    h.debug.setShipX(300);
    h.debug.setShipBand("magenta");
    h.debug.setFireLockout(0.2);
    h.debug.setFireCooldown(0.1);
    const s = h.debug.snapshot();
    expect(s.ship.x).toBe(300);
    expect(s.ship.band).toBe("magenta");
    expect(s.ship.lockout).toBe(0.2);
    expect(s.ship.cooldown).toBe(0.1);
  });

  // The lane's bounds are the argument's DOMAIN, so both ends are reached exactly
  // and a value outside them FAILS LOUDLY rather than snapping to the nearer end.
  // A snap would leave the ship somewhere nobody asked for and report a pose that
  // never happened as one that did.
  it("takes the ship across its lane, and fails loudly outside it", () => {
    h.debug.setShipX(SHIP_X_MIN);
    expect(h.debug.snapshot().ship.x).toBe(SHIP_X_MIN);
    h.debug.setShipX(SHIP_X_MAX);
    expect(h.debug.snapshot().ship.x).toBe(SHIP_X_MAX);
    expect(() => h.debug.setShipX(-500)).toThrow(RangeError);
    expect(() => h.debug.setShipX(5000)).toThrow(RangeError);
    expect(h.debug.snapshot().ship.x).toBe(SHIP_X_MAX);
  });

  it("poses the band without starting a lockout", () => {
    h.debug.setFireLockout(0);
    h.debug.setShipBand("magenta");
    expect(h.debug.snapshot().ship.lockout).toBe(0);
  });

  it("poses the meter and the inversion", () => {
    h.debug.setResonance(40);
    h.debug.setInversion(2);
    const s = h.debug.snapshot();
    expect(s.resonance).toBe(40);
    expect(s.inversion).toBe(2);
  });

  it("poses every field of a drone", () => {
    h.debug.addDrone("flux", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDronePosition(id, 500, 250);
    h.debug.setDroneBand(id, "magenta");
    h.debug.setDronePhase(id, "diving");
    h.debug.setDroneSlot(id, 600, 300);
    h.debug.setDroneBandClock(id, 0.5);
    // `setDroneShell` is NOT called here: this drone is a Flux, which has no
    // shell, so the call would fail loudly. It is posed on a Prism below.
    h.debug.setDroneTravel(id, false);
    h.debug.setDroneOscillation(id, false);
    h.debug.setDroneFire(id, false);

    const drone = h.debug.snapshot().drones[0];
    expect(drone?.x).toBe(500);
    expect(drone?.y).toBe(250);
    expect(drone?.band).toBe("magenta");
    expect(drone?.phase).toBe("diving");
    expect(drone?.slotX).toBe(600);
    expect(drone?.slotY).toBe(300);
    expect(drone?.bandClock).toBe(0.5);
    expect(drone?.shellAlive).toBe(true);
    expect(drone?.travel).toBe(false);
    expect(drone?.oscillation).toBe(false);
    expect(drone?.fire).toBe(false);
  });

  // A SHELL BELONGS TO A PRISM. On a Shard or a Flux the call names no state to
  // reach, so it FAILS LOUDLY rather than passing quietly with nothing written
  // (`specs/instrumentation.md`): a call that vanished would grade a check that
  // never posed what it meant to as one that did.
  it("poses a Prism's shell, and fails loudly on any other kind", () => {
    h.debug.clearDrones();
    h.debug.addDrone("prism", 400, 200);
    h.debug.setDroneShell(lastDroneId(h.debug), false);
    expect(h.debug.snapshot().drones[0]?.shellAlive).toBe(false);

    for (const kind of ["shard", "flux"] as const) {
      h.debug.clearDrones();
      h.debug.addDrone(kind, 400, 200);
      const id = lastDroneId(h.debug);
      expect(() => h.debug.setDroneShell(id, false)).toThrow(RangeError);
      expect(h.debug.snapshot().drones[0]?.shellAlive).toBe(true);
    }
  });

  // A BAND WINDOW BELONGS TO A FLUX, on the same terms as the shell above.
  it("poses a Flux's band clock, and fails loudly on any other kind", () => {
    h.debug.clearDrones();
    h.debug.addDrone("flux", 400, 200);
    h.debug.setDroneBandClock(lastDroneId(h.debug), 0.5);
    expect(h.debug.snapshot().drones[0]?.bandClock).toBe(0.5);

    for (const kind of ["shard", "prism"] as const) {
      h.debug.clearDrones();
      h.debug.addDrone(kind, 400, 200);
      const id = lastDroneId(h.debug);
      expect(() => h.debug.setDroneBandClock(id, 0.5)).toThrow(RangeError);
      expect(h.debug.snapshot().drones[0]?.bandClock).toBe(0);
    }
  });

  it("reads a band back on all three kinds", () => {
    for (const kind of ["shard", "flux", "prism"] as const) {
      h.debug.clearDrones();
      h.debug.addDrone(kind, 400, 200);
      const id = lastDroneId(h.debug);
      h.debug.setDroneBand(id, "magenta");
      expect(h.debug.snapshot().drones[0]?.band).toBe("magenta");
    }
  });

  it("moves the band and the band clock one at a time", () => {
    h.debug.addDrone("flux", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneBandClock(id, 0.4);
    h.debug.setDroneBand(id, "magenta");
    let drone = h.debug.snapshot().drones[0];
    // The band moved and the clock stayed exactly where it stood.
    expect(drone?.band).toBe("magenta");
    expect(drone?.bandClock).toBe(0.4);

    h.debug.setDroneBandClock(id, 0.9);
    drone = h.debug.snapshot().drones[0];
    // The clock moved and the band stayed exactly where it stood.
    expect(drone?.bandClock).toBe(0.9);
    expect(drone?.band).toBe("magenta");
  });

  it("poses a bullet's velocity", () => {
    h.debug.addPlayerBullet(400, 400, "cyan");
    const id = lastBulletId(h.debug);
    h.debug.setBulletVelocity(id, 30, -40);
    const bullet = h.debug.snapshot().bullets[0];
    expect(bullet?.vx).toBe(30);
    expect(bullet?.vy).toBe(-40);
  });
});

describe("what a pose adds", () => {
  it("adds a drone with its declared opening fields, appended and identified", () => {
    h.debug.addDrone("prism", 320, 180);
    const drones = h.debug.snapshot().drones;
    const drone = drones[drones.length - 1];
    expect(drone?.kind).toBe("prism");
    expect(drone?.x).toBe(320);
    expect(drone?.y).toBe(180);
    expect(drone?.band).toBe("cyan");
    expect(drone?.phase).toBe("formation");
    expect(drone?.slotX).toBe(320);
    expect(drone?.slotY).toBe(180);
    expect(drone?.bandClock).toBe(0);
    expect(drone?.shellAlive).toBe(true);
    expect(drone?.travel).toBe(true);
    expect(drone?.oscillation).toBe(true);
    expect(drone?.fire).toBe(true);
    expect(drone?.id).toBeGreaterThan(0);
  });

  it("appends each entity to its roster, so the last entry is the new one", () => {
    h.debug.addDrone("shard", 100, 100);
    const first = lastDroneId(h.debug);
    h.debug.addDrone("shard", 200, 100);
    const second = lastDroneId(h.debug);
    expect(second).not.toBe(first);
    expect(h.debug.snapshot().drones.map((d) => d.id)).toEqual([first, second]);
  });

  it("adds the player's bullet climbing at its own speed", () => {
    h.debug.addPlayerBullet(200, 400, "magenta");
    const bullet = h.debug.snapshot().bullets[0];
    expect(bullet?.friendly).toBe(true);
    expect(bullet?.vy).toBe(-PLAYER_BULLET_SPEED);
    expect(bullet?.vx).toBe(0);
    expect(bullet?.band).toBe("magenta");
  });

  it("adds an enemy bullet falling at the stage's own speed", () => {
    h.debug.setStage(5);
    h.debug.addEnemyBullet(200, 200, "cyan");
    const bullet = h.debug.snapshot().bullets[0];
    expect(bullet?.friendly).toBe(false);
    expect(bullet?.vy).toBeCloseTo(ENEMY_BULLET_SPEED * bulletSpeedScale(5), 6);
  });
});

describe("what a pose removes", () => {
  it("removes one drone by id and leaves the rest standing", () => {
    h.debug.addDrone("shard", 100, 100);
    const first = lastDroneId(h.debug);
    h.debug.addDrone("shard", 200, 100);
    h.debug.removeDrone(first);
    const left = h.debug.snapshot().drones;
    expect(left).toHaveLength(1);
    expect(left[0]?.id).not.toBe(first);
  });

  it("clears the drones and leaves the bullets standing", () => {
    h.debug.addDrone("shard", 100, 100);
    h.debug.addPlayerBullet(100, 300, "cyan");
    h.debug.clearDrones();
    expect(h.debug.snapshot().drones).toHaveLength(0);
    expect(h.debug.snapshot().bullets).toHaveLength(1);
  });

  it("clears each bullet roster on its own", () => {
    h.debug.addPlayerBullet(100, 300, "cyan");
    h.debug.addEnemyBullet(200, 200, "cyan");
    h.debug.clearPlayerBullets();
    expect(h.debug.snapshot().bullets.map((b) => b.friendly)).toEqual([false]);

    h.debug.addPlayerBullet(100, 300, "cyan");
    h.debug.clearEnemyBullets();
    expect(h.debug.snapshot().bullets.map((b) => b.friendly)).toEqual([true]);
  });

  it("removes one bullet by id", () => {
    h.debug.addPlayerBullet(100, 300, "cyan");
    const id = lastBulletId(h.debug);
    h.debug.addPlayerBullet(200, 300, "cyan");
    h.debug.removeBullet(id);
    expect(h.debug.snapshot().bullets).toHaveLength(1);
  });

  it("removes a burst, and clears the roster, leaving the drones standing", async () => {
    h.debug.addDrone("shard", 400, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    h.debug.addDrone("shard", 900, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    h.debug.addPlayerBullet(900, 205, "cyan");
    await h.advance(2);
    expect(h.debug.snapshot().bursts.length).toBeGreaterThan(0);

    const id = h.debug.snapshot().bursts[0]?.id ?? 0;
    h.debug.removeBurst(id);
    expect(h.debug.snapshot().bursts.map((b) => b.id)).not.toContain(id);

    h.debug.clearBursts();
    expect(h.debug.snapshot().bursts).toHaveLength(0);
    expect(h.debug.snapshot().drones).toHaveLength(1);
  });

  // AN ID NOTHING HOLDS NAMES NO STATE TO REACH, so the call fails loudly where
  // the caller sees it rather than returning with the roster exactly as it was
  // (`specs/instrumentation.md`).
  it("fails loudly on a pose naming an entity that is not there", () => {
    expect(() => h.debug.setDronePosition(9999, 1, 1)).toThrow(RangeError);
    expect(() => h.debug.setDroneBand(9999, "magenta")).toThrow(RangeError);
    expect(() => h.debug.setBulletVelocity(9999, 1, 1)).toThrow(RangeError);
    expect(() => h.debug.removeDrone(9999)).toThrow(RangeError);
    expect(() => h.debug.removeBullet(9999)).toThrow(RangeError);
    expect(() => h.debug.removeBurst(9999)).toThrow(RangeError);
  });
});

describe("every derived field follows what it is derived from", () => {
  it("follows the stage", () => {
    for (const stage of [1, 3, 5, 9]) {
      h.debug.setStage(stage);
      const s = h.debug.snapshot();
      expect(s.isChallenge).toBe(isChallengeStage(stage));
      expect(s.droneSpeedScale).toBeCloseTo(droneSpeedScale(stage), 10);
      expect(s.bulletSpeedScale).toBeCloseTo(bulletSpeedScale(stage), 10);
      expect(s.diveGapScale).toBeCloseTo(diveGapScale(stage), 10);
      expect(s.fluxHold).toBeCloseTo(fluxHold(stage), 10);
    }
  });

  it("follows the meter", () => {
    h.debug.setResonance(RESONANCE_MAX - 1);
    expect(h.debug.snapshot().dischargeReady).toBe(false);
    h.debug.setResonance(RESONANCE_MAX);
    expect(h.debug.snapshot().dischargeReady).toBe(true);
  });

  it("follows the inversion", () => {
    h.debug.setInversion(0);
    expect(h.debug.snapshot().inversionActive).toBe(false);
    h.debug.setInversion(1);
    expect(h.debug.snapshot().inversionActive).toBe(true);
  });

  it("follows the phase, for the ship's own life", () => {
    h.debug.setPhase("live");
    expect(h.debug.snapshot().ship.alive).toBe(true);
    h.debug.setPhase("ready");
    expect(h.debug.snapshot().ship.alive).toBe(false);
  });

  it("follows a Flux's band clock, for its shimmer", () => {
    h.debug.addDrone("flux", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneBandClock(id, fluxHold(1) - 0.01);
    expect(h.debug.snapshot().drones[0]?.shimmer).toBe(false);
    h.debug.setDroneBandClock(id, fluxHold(1));
    expect(h.debug.snapshot().drones[0]?.shimmer).toBe(true);
  });

  it("follows the shell and the inversion, for an effective band", () => {
    h.debug.addDrone("prism", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneBand(id, "cyan");
    expect(h.debug.snapshot().drones[0]?.effectiveBand).toBe("cyan");

    h.debug.setDroneShell(id, false);
    expect(h.debug.snapshot().drones[0]?.effectiveBand).toBe("magenta");

    h.debug.setInversion(2);
    expect(h.debug.snapshot().drones[0]?.effectiveBand).toBe("cyan");
  });

  it("never inverts one of the player's bullets", () => {
    h.debug.addPlayerBullet(200, 400, "cyan");
    h.debug.addEnemyBullet(300, 200, "cyan");
    h.debug.setInversion(2);
    const bullets = h.debug.snapshot().bullets;
    expect(bullets[0]?.effectiveBand).toBe("cyan");
    expect(bullets[1]?.effectiveBand).toBe("magenta");
  });

  // THE WINDOW IS NOT THE ARGUMENT'S DOMAIN. `fluxWindow(stage)` is a live figure
  // the stage moves, so it is a game rule rather than a bound on this pose: the
  // clock takes the seconds it was handed and the oscillation is what carries it
  // over (`specs/instrumentation.md`).
  it("takes a band clock past the end of the window as given", () => {
    h.debug.addDrone("flux", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneBandClock(id, 99);
    expect(h.debug.snapshot().drones[0]?.bandClock).toBe(99);
  });
});

// `reconcile` brings every reported reading into agreement with the game without
// advancing anything. This build works every derived reading out at the READ, so
// the call has nothing to rewrite; what these two cases pin is that it still
// ANSWERS for a posed game and that it costs no simulation time, which is the
// whole difference between it and stepping a frame.
describe("reconcile", () => {
  it("re-derives a reading from a posed source", () => {
    h.debug.setStage(5);
    h.debug.reconcile();
    expect(h.debug.snapshot().fluxHold).toBeCloseTo(fluxHold(5), 10);

    h.debug.setResonance(RESONANCE_MAX);
    h.debug.reconcile();
    expect(h.debug.snapshot().dischargeReady).toBe(true);

    h.debug.setInversion(2);
    h.debug.reconcile();
    expect(h.debug.snapshot().inversionActive).toBe(true);

    h.debug.setPhase("ready");
    h.debug.reconcile();
    expect(h.debug.snapshot().ship.alive).toBe(false);
  });

  it("advances nothing, and twice matches once", () => {
    h.debug.setScreen("inWave");
    h.debug.setStage(3);
    h.debug.setPhaseTimer(1.25);
    h.debug.setDiveClock(0.4);
    h.debug.setInversion(2.5);
    h.debug.setFireLockout(0.24);
    h.debug.setShipX(500);
    h.debug.addDrone("flux", 400, 200);
    h.debug.setDroneBandClock(lastDroneId(h.debug), 0.5);
    h.debug.addDrone("prism", 600, 200);
    h.debug.addPlayerBullet(400, 500, "magenta");

    const before = JSON.stringify(h.debug.snapshot());
    h.debug.reconcile();
    const once = JSON.stringify(h.debug.snapshot());
    h.debug.reconcile();
    const twice = JSON.stringify(h.debug.snapshot());

    // The clock, the positions and every timer are untouched, so the whole
    // snapshot is byte-identical rather than merely close.
    expect(once).toBe(before);
    expect(twice).toBe(once);
  });
});

describe("the preconditions a pose is", () => {
  it("grants no extra life, whatever boundary the score is carried across", () => {
    h.debug.setLives(3);
    h.debug.setScore(50000);
    const s = h.debug.snapshot();
    expect(s.lives).toBe(3);
    expect(s.extraLifeAwarded).toBe(false);
  });

  it("spawns nothing and clears nothing when the stage is posed", () => {
    h.debug.addDrone("shard", 100, 100);
    h.debug.setStage(7);
    expect(h.debug.snapshot().drones).toHaveLength(1);
  });
});

describe("the reset", () => {
  it("restores the title screen and empties every roster", () => {
    h.debug.addDrone("shard", 100, 100);
    h.debug.addPlayerBullet(100, 300, "cyan");
    h.debug.setScore(900);
    h.debug.reset();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("title");
    expect(s.score).toBe(0);
    expect(s.drones).toHaveLength(0);
    expect(s.bullets).toHaveLength(0);
    expect(s.bursts).toHaveLength(0);
    expect(s.simTime).toBe(0);
    expect(s.waveEntry).toBe(true);
    expect(s.diveLaunching).toBe(true);
    expect(s.stageClearing).toBe(true);
    expect(s.ship.contact).toBe(true);
  });

  it("seeds the game's randomness, so a replay reproduces a wave exactly", async () => {
    const wave = async (seed: number): Promise<string> => {
      h.debug.reset({ seed });
      h.debug.setScreen("stageIntro");
      h.debug.setPhaseTimer(0.05);
      await h.seconds(1);
      return JSON.stringify(h.debug.snapshot().drones);
    };

    const first = await wave(DEFAULT_SEED);
    expect(await wave(DEFAULT_SEED)).toBe(first);
    expect(await wave(DEFAULT_SEED + 1)).not.toBe(first);
  });

  it("leaves muting exactly as it stands", async () => {
    await h.tap("KeyM");
    expect(h.debug.snapshot().muted).toBe(true);
    h.debug.reset();
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(true);
  });
});
