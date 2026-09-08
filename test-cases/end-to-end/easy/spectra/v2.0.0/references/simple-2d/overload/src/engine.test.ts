// Spectra under the engine: the debug surface, the core beneath it, and the gates.
//
// Every check here drives a real engine over a headless canvas and reads the game's
// own state back, so what is asserted is what the game does rather than what a
// helper says it does.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  FIELD_TOP,
  FORM_CENTER_X,
  OVERLOAD_AT,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  START_LIVES,
  SUBSTEP_MAX,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  slotX,
  slotY,
  swayOffset,
} from "./constants";
import { LANE_CENTRE } from "./flow";
import {
  createHarness,
  droneOf,
  enemyBullets,
  last,
  playerBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the debug surface", () => {
  it("is returned beside the state and reports its version", () => {
    expect(h.debug.version).toBe(SPECTRA_DEBUG_VERSION);
    expect(typeof h.debug.snapshot).toBe("function");
    expect(typeof h.debug.reset).toBe("function");
  });

  it("carries every operation the specification names", () => {
    const names = [
      "reset",
      "snapshot",
      "setScreen",
      "setPhase",
      "setPhaseTimer",
      "setMenuIndex",
      "setScore",
      "setLives",
      "setStage",
      "setExtraLifeAwarded",
      "setChallengeHits",
      "setWaveEntry",
      "setDiveLaunching",
      "setStageClearing",
      "setShipContact",
      "setDiveClock",
      "setShipX",
      "setShipBand",
      "setFireLockout",
      "setFireCooldown",
      "setResonance",
      "setInversion",
      "addDrone",
      "setDronePosition",
      "setDroneBand",
      "setDronePhase",
      "setDroneSlot",
      "setDroneBandClock",
      "setDroneShell",
      "setDroneCharge",
      "setDroneTravel",
      "setDroneOscillation",
      "setDroneFire",
      "removeDrone",
      "clearDrones",
      "addPlayerBullet",
      "addEnemyBullet",
      "setBulletVelocity",
      "removeBullet",
      "clearPlayerBullets",
      "clearEnemyBullets",
      "removeBurst",
      "clearBursts",
    ] as const;
    const surface = h.debug as unknown as Record<string, unknown>;
    for (const name of names) expect(typeof surface[name]).toBe("function");
  });

  it("reports the full documented shape over a posed field", async () => {
    startPosed(h);
    poseDrone(h, "shard", 400, 200);
    poseDrone(h, "flux", 500, 200, { bandClock: fluxHold(1) });
    poseDrone(h, "prism", 600, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 500, 400, "magenta"));
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.frames(1);

    const snap = h.snapshot();
    expect(snap.version).toBe(SPECTRA_DEBUG_VERSION);
    expect(snap.mode).toBe("overload");
    expect(typeof snap.isChallenge).toBe("boolean");
    expect(typeof snap.dischargeReady).toBe("boolean");
    expect(typeof snap.inversionActive).toBe("boolean");
    expect(typeof snap.muted).toBe("boolean");
    expect(typeof snap.simTime).toBe("number");
    expect(snap.droneSpeedScale).toBeCloseTo(droneSpeedScale(1), 6);
    expect(snap.bulletSpeedScale).toBeCloseTo(bulletSpeedScale(1), 6);
    expect(snap.diveGapScale).toBeCloseTo(diveGapScale(1), 6);
    expect(snap.fluxHold).toBeCloseTo(fluxHold(1), 6);
    expect(snap.ship.alive).toBe(true);
    expect(snap.discharge.active).toBe(true);
    expect(snap.discharge.radius).toBeGreaterThan(0);
    expect(snap.drones).toHaveLength(3);
    for (const drone of snap.drones) {
      expect(typeof drone.id).toBe("number");
      expect(typeof drone.x).toBe("number");
      expect(typeof drone.y).toBe("number");
      expect(["cyan", "magenta"]).toContain(drone.band);
      expect(["cyan", "magenta"]).toContain(drone.effectiveBand);
      expect(typeof drone.slotX).toBe("number");
      expect(typeof drone.bandClock).toBe("number");
      expect(typeof drone.shimmer).toBe("boolean");
      expect(typeof drone.shellAlive).toBe("boolean");
      expect(typeof drone.travel).toBe("boolean");
      expect(typeof drone.oscillation).toBe("boolean");
      expect(typeof drone.fire).toBe("boolean");
      expect(typeof drone.charge).toBe("number");
    }
    for (const bullet of h.snapshot().bullets) {
      expect(typeof bullet.vx).toBe("number");
      expect(typeof bullet.effectiveBand).toBe("string");
      expect(typeof bullet.friendly).toBe("boolean");
    }
  });

  it("reads every pose back through the snapshot", () => {
    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setPhase(s, "ready"));
    h.pose((s, d) => d.setPhaseTimer(s, 0.75));
    h.pose((s, d) => d.setMenuIndex(s, 2));
    h.pose((s, d) => d.setScore(s, 4321));
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setStage(s, 7));
    h.pose((s, d) => d.setExtraLifeAwarded(s, true));
    h.pose((s, d) => d.setChallengeHits(s, 17));
    h.pose((s, d) => d.setWaveEntry(s, false));
    h.pose((s, d) => d.setDiveLaunching(s, false));
    h.pose((s, d) => d.setStageClearing(s, false));
    h.pose((s, d) => d.setShipContact(s, false));
    h.pose((s, d) => d.setDiveClock(s, 1.25));
    h.pose((s, d) => d.setShipX(s, 300));
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    h.pose((s, d) => d.setFireLockout(s, 0.2));
    h.pose((s, d) => d.setFireCooldown(s, 0.1));
    h.pose((s, d) => d.setResonance(s, 42));
    h.pose((s, d) => d.setInversion(s, 3));

    const snap = h.snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.phase).toBe("ready");
    expect(snap.phaseTimer).toBeCloseTo(0.75, 6);
    expect(snap.menuIndex).toBe(2);
    expect(snap.score).toBe(4321);
    expect(snap.lives).toBe(2);
    expect(snap.stage).toBe(7);
    expect(snap.extraLifeAwarded).toBe(true);
    expect(snap.challengeHits).toBe(17);
    expect(snap.waveEntry).toBe(false);
    expect(snap.diveLaunching).toBe(false);
    expect(snap.stageClearing).toBe(false);
    expect(snap.ship.contact).toBe(false);
    expect(snap.diveClock).toBeCloseTo(1.25, 6);
    expect(snap.ship.x).toBe(300);
    expect(snap.ship.band).toBe("magenta");
    expect(snap.ship.lockout).toBeCloseTo(0.2, 6);
    expect(snap.ship.cooldown).toBeCloseTo(0.1, 6);
    expect(snap.resonance).toBe(42);
    expect(snap.inversion).toBe(3);
    expect(snap.ship.alive).toBe(false);
  });

  it("reads every per-drone pose back, on each kind", () => {
    startPosed(h);
    for (const kind of ["shard", "flux", "prism"] as const) {
      const id = poseDrone(h, kind, 300, 200);
      h.pose((s, d) => d.setDronePosition(s, id, 420, 260));
      h.pose((s, d) => d.setDroneBand(s, id, "magenta"));
      h.pose((s, d) => d.setDronePhase(s, id, "diving"));
      h.pose((s, d) => d.setDroneSlot(s, id, 500, 300));
      // A BAND WINDOW BELONGS TO A FLUX AND A SHELL TO A PRISM, so each of those
      // two poses is made only on the kind that has the field: the surface fails
      // LOUDLY on any other kind rather than passing quietly with nothing written
      // (`specs/instrumentation.md`).
      if (kind === "flux") h.pose((s, d) => d.setDroneBandClock(s, id, 0.5));
      if (kind === "prism") h.pose((s, d) => d.setDroneShell(s, id, false));
      h.pose((s, d) => d.setDroneCharge(s, id, 2));
      h.pose((s, d) => d.setDroneTravel(s, id, true));
      h.pose((s, d) => d.setDroneOscillation(s, id, true));
      h.pose((s, d) => d.setDroneFire(s, id, true));

      const drone = droneOf(h, id);
      expect(drone?.x).toBe(420);
      expect(drone?.y).toBe(260);
      expect(drone?.band).toBe("magenta");
      expect(drone?.phase).toBe("diving");
      expect(drone?.slotX).toBe(500);
      expect(drone?.slotY).toBe(300);
      // The band clock is a Flux's and the shell a Prism's; on every other kind
      // the surface reports the fixed figure, and the pose was never made.
      expect(drone?.bandClock).toBeCloseTo(kind === "flux" ? 0.5 : 0, 6);
      expect(drone?.shellAlive).toBe(kind !== "prism");

      for (const wrong of ["shard", "flux", "prism"] as const) {
        if (wrong === kind) continue;
        const other = poseDrone(h, wrong, 900, 200);
        if (kind === "flux") {
          expect(() =>
            h.pose((s, d) => d.setDroneBandClock(s, other, 0.5)),
          ).toThrow(RangeError);
        }
        if (kind === "prism") {
          expect(() =>
            h.pose((s, d) => d.setDroneShell(s, other, false)),
          ).toThrow(RangeError);
        }
        h.pose((s, d) => d.removeDrone(s, other));
      }
      expect(drone?.charge).toBe(2);
      expect(drone?.travel).toBe(true);
      expect(drone?.oscillation).toBe(true);
      expect(drone?.fire).toBe(true);
    }
  });

  it("reads a bullet's posed velocity back", () => {
    startPosed(h);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    const id = last(h.snapshot().bullets).id;
    h.pose((s, d) => d.setBulletVelocity(s, id, 12, -34));
    const bullet = h.snapshot().bullets.find((entry) => entry.id === id);
    expect(bullet?.vx).toBe(12);
    expect(bullet?.vy).toBe(-34);
  });

  // The lane's bounds are the argument's DOMAIN, so both ends are reached exactly
  // and a value outside them FAILS LOUDLY rather than snapping to the nearer end.
  // A snap would leave the ship somewhere nobody asked for and report a pose that
  // never happened as one that did.
  it("takes a posed ship across its lane, and fails loudly outside it", () => {
    h.pose((s, d) => d.setShipX(s, SHIP_X_MIN));
    expect(h.snapshot().ship.x).toBe(SHIP_X_MIN);
    h.pose((s, d) => d.setShipX(s, SHIP_X_MAX));
    expect(h.snapshot().ship.x).toBe(SHIP_X_MAX);
    expect(() => h.pose((s, d) => d.setShipX(s, -400))).toThrow(RangeError);
    expect(() => h.pose((s, d) => d.setShipX(s, 4000))).toThrow(RangeError);
    expect(h.snapshot().ship.x).toBe(SHIP_X_MAX);
  });

  // `0` to `OVERLOAD_AT` is the charge argument's DOMAIN, on the same terms.
  it("takes a posed charge across its range, and fails loudly outside it", () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 400, 200);
    h.pose((s, d) => d.setDroneCharge(s, id, OVERLOAD_AT));
    expect(droneOf(h, id)?.charge).toBe(OVERLOAD_AT);
    h.pose((s, d) => d.setDroneCharge(s, id, 0));
    expect(droneOf(h, id)?.charge).toBe(0);
    expect(() => h.pose((s, d) => d.setDroneCharge(s, id, 99))).toThrow(
      RangeError,
    );
    expect(() => h.pose((s, d) => d.setDroneCharge(s, id, -4))).toThrow(
      RangeError,
    );
    expect(droneOf(h, id)?.charge).toBe(0);
  });

  it("adds a drone with the fields the specification fixes", () => {
    startPosed(h);
    h.pose((s, d) => d.addDrone(s, "prism", 411, 222));
    const drone = last(h.snapshot().drones);
    expect(drone.kind).toBe("prism");
    expect(drone.x).toBe(411);
    expect(drone.y).toBe(222);
    expect(drone.band).toBe("cyan");
    expect(drone.phase).toBe("formation");
    expect(drone.slotX).toBe(411);
    expect(drone.slotY).toBe(222);
    expect(drone.bandClock).toBe(0);
    expect(drone.shellAlive).toBe(true);
    expect(drone.charge).toBe(0);
    expect(drone.travel).toBe(true);
    expect(drone.oscillation).toBe(true);
    expect(drone.fire).toBe(true);
  });

  it("adds bullets travelling at the speeds their kinds carry", () => {
    startPosed(h, 5);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 500, 400, "magenta"));
    const [player, enemy] = h.snapshot().bullets;
    expect(player?.friendly).toBe(true);
    expect(player?.vy).toBeCloseTo(-PLAYER_BULLET_SPEED, 6);
    expect(enemy?.friendly).toBe(false);
    expect(enemy?.vy).toBeGreaterThan(0);
    expect(enemy?.vy).toBeCloseTo(320 * bulletSpeedScale(5), 6);
  });

  it("leaves the score's pose granting no extra life", () => {
    startPosed(h);
    h.pose((s, d) => d.setScore(s, 99999));
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().extraLifeAwarded).toBe(false);
  });

  it("moves only the derived figures when the stage is posed", () => {
    startPosed(h);
    poseDrone(h, "shard", 400, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.setStage(s, 9));
    const snap = h.snapshot();
    expect(snap.drones).toHaveLength(1);
    expect(snap.bullets).toHaveLength(1);
    expect(snap.isChallenge).toBe(true);
    expect(snap.droneSpeedScale).toBeCloseTo(droneSpeedScale(9), 6);
    expect(snap.bulletSpeedScale).toBeCloseTo(bulletSpeedScale(9), 6);
    expect(snap.diveGapScale).toBeCloseTo(diveGapScale(9), 6);
    expect(snap.fluxHold).toBeCloseTo(fluxHold(9), 6);
  });
});

// `reconcile` brings every reported reading into agreement with the game without
// advancing anything. This build works every derived reading out at the READ, so
// the call has nothing to rewrite; what these two cases pin is that it still
// ANSWERS for a posed game and that it costs no simulation time, which is the
// whole difference between it and stepping a frame.
describe("reconcile", () => {
  it("re-derives a reading from a posed source", () => {
    startPosed(h);

    h.pose((s, d) => d.setStage(s, 5));
    h.pose((s, d) => d.reconcile(s));
    expect(h.snapshot().fluxHold).toBeCloseTo(fluxHold(5), 6);

    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.pose((s, d) => d.reconcile(s));
    expect(h.snapshot().dischargeReady).toBe(true);

    h.pose((s, d) => d.setInversion(s, 2));
    h.pose((s, d) => d.reconcile(s));
    expect(h.snapshot().inversionActive).toBe(true);

    h.pose((s, d) => d.setPhase(s, "ready"));
    h.pose((s, d) => d.reconcile(s));
    expect(h.snapshot().ship.alive).toBe(false);
  });

  it("advances nothing, and twice matches once", () => {
    startPosed(h);
    h.pose((s, d) => d.setStage(s, 3));
    h.pose((s, d) => d.setPhaseTimer(s, 1.25));
    h.pose((s, d) => d.setDiveClock(s, 0.4));
    h.pose((s, d) => d.setInversion(s, 2.5));
    h.pose((s, d) => d.setFireLockout(s, 0.24));
    h.pose((s, d) => d.setShipX(s, 500));
    poseDrone(h, "flux", 400, 200, { bandClock: 0.5 });
    poseDrone(h, "prism", 600, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 500, "magenta"));

    const before = JSON.stringify(h.snapshot());
    h.pose((s, d) => d.reconcile(s));
    const once = JSON.stringify(h.snapshot());
    h.pose((s, d) => d.reconcile(s));
    const twice = JSON.stringify(h.snapshot());

    // The clock, the positions and every timer are untouched, so the whole
    // snapshot is byte-identical rather than merely close.
    expect(once).toBe(before);
    expect(twice).toBe(once);
  });
});

describe("reset", () => {
  it("restores every declared field to its title value", async () => {
    h.tap("Enter");
    await h.advance(6);
    h.pose((s, d) => d.setScore(s, 5000));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setStage(s, 4));
    h.pose((s, d) => d.setResonance(s, 80));
    h.pose((s, d) => d.setInversion(s, 2));
    h.pose((s, d) => d.setWaveEntry(s, false));
    h.pose((s, d) => d.setDiveLaunching(s, false));
    h.pose((s, d) => d.setShipContact(s, false));
    h.pose((s, d) => d.setDiveClock(s, 1));
    h.pose((s, d) => d.setExtraLifeAwarded(s, true));
    expect(h.snapshot().drones.length).toBeGreaterThan(0);

    h.pose((s, d) => d.reset(s));
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBe("live");
    expect(snap.phaseTimer).toBe(0);
    expect(snap.menuIndex).toBe(0);
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.stage).toBe(1);
    expect(snap.resonance).toBe(0);
    expect(snap.inversion).toBe(0);
    expect(snap.drones).toHaveLength(0);
    expect(snap.bullets).toHaveLength(0);
    expect(snap.bursts).toHaveLength(0);
    expect(snap.discharge.active).toBe(false);
    expect(snap.discharge.radius).toBe(0);
    expect(snap.ship.x).toBe(LANE_CENTRE);
    expect(snap.ship.band).toBe("cyan");
    expect(snap.ship.lockout).toBe(0);
    expect(snap.ship.cooldown).toBe(0);
    expect(snap.waveEntry).toBe(true);
    expect(snap.diveLaunching).toBe(true);
    expect(snap.ship.contact).toBe(true);
    expect(snap.diveClock).toBe(0);
    expect(snap.extraLifeAwarded).toBe(false);
    expect(snap.simTime).toBe(0);
  });

  it("leaves the runtime's mute bit exactly as it stands", async () => {
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
    h.pose((s, d) => d.reset(s));
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
  });
});

describe("the render-free core", () => {
  it("reaches the same state whichever way a second is divided", async () => {
    // Nothing on this field is drawn at random: a Flux runs its clock, a Shard
    // rides the sway, and two bullets fly clear of everything.
    const run = async (frames: number): Promise<string> => {
      const harness = await createHarness();
      startPosed(harness);
      harness.pose((s, d) => d.addDrone(s, "flux", 500, 180));
      const flux = harness.snapshot().drones.slice(-1)[0].id;
      harness.pose((s, d) => d.setDroneBandClock(s, flux, 1.5));
      harness.pose((s, d) => d.addDrone(s, "shard", 700, 260));
      harness.pose((s, d) => d.addPlayerBullet(s, 300, 640, "cyan"));
      harness.pose((s, d) => d.addEnemyBullet(s, 900, 100, "magenta"));
      harness.setStep(1 / frames);
      await harness.frames(frames * 3);
      const snap = harness.snapshot();
      harness.dispose();
      return JSON.stringify({
        simTime: snap.simTime.toFixed(6),
        stage: snap.stage,
        screen: snap.screen,
        drones: snap.drones.map((drone) => [
          drone.id,
          drone.kind,
          drone.band,
          drone.x.toFixed(6),
          drone.y.toFixed(6),
          drone.phase,
        ]),
        bullets: snap.bullets.map((bullet) => [
          bullet.id,
          bullet.x.toFixed(6),
          bullet.y.toFixed(6),
        ]),
      });
    };
    const one = await run(1);
    const sixty = await run(60);
    const twenty = await run(120);
    expect(sixty).toEqual(one);
    expect(twenty).toEqual(one);
  });

  it("accumulates the time its sub-steps cover", async () => {
    startPosed(h);
    const before = h.snapshot().simTime;
    await h.advance(1);
    expect(h.snapshot().simTime - before).toBeCloseTo(1, 6);
  });

  it("divides a frame into whole sub-steps of at most the ceiling", async () => {
    expect(SUBSTEP_MAX).toBeCloseTo(1 / 120, 9);
    startPosed(h);
    poseDrone(h, "shard", 640, 200, { phase: "diving", travel: true });
    const oneFrame = await (async (): Promise<number> => {
      h.setStep(0.5);
      await h.frames(1);
      return last(h.snapshot().drones).y;
    })();

    const other = await createHarness();
    startPosed(other);
    poseDrone(other, "shard", 640, 200, { phase: "diving", travel: true });
    other.setStep(0.5 / 60);
    await other.frames(60);
    const manyFrames = last(other.snapshot().drones).y;
    other.dispose();
    expect(manyFrames).toBeCloseTo(oneFrame, 6);
  });
});

describe("the rosters and their ids", () => {
  it("gives every entity a distinct id and keeps it across frames", async () => {
    startPosed(h);
    const first = poseDrone(h, "shard", 300, 200, { phase: "formation" });
    const second = poseDrone(h, "flux", 400, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 500, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 600, 400, "magenta"));
    const ids = [
      ...h.snapshot().drones.map((drone) => drone.id),
      ...h.snapshot().bullets.map((bullet) => bullet.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(second).toBeGreaterThan(first);

    h.pose((s, d) => d.setDronePhase(s, first, "diving"));
    await h.advance(0.3);
    expect(droneOf(h, first)?.id).toBe(first);
  });

  it("appends what it adds, so the last entry is the one added", () => {
    startPosed(h);
    poseDrone(h, "shard", 300, 200);
    const id = poseDrone(h, "prism", 400, 200);
    expect(last(h.snapshot().drones).id).toBe(id);
  });

  it("empties the drones alone", () => {
    startPosed(h);
    poseDrone(h, "shard", 300, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 500, 400, "magenta"));
    h.pose((s, d) => d.clearDrones(s));
    expect(h.snapshot().drones).toHaveLength(0);
    expect(h.snapshot().bullets).toHaveLength(2);
  });

  it("removes the player's bullets alone, and the enemy's alone", () => {
    startPosed(h);
    poseDrone(h, "shard", 300, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 500, 400, "magenta"));
    h.pose((s, d) => d.clearPlayerBullets(s));
    expect(playerBullets(h)).toHaveLength(0);
    expect(enemyBullets(h)).toHaveLength(1);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.clearEnemyBullets(s));
    expect(playerBullets(h)).toHaveLength(1);
    expect(enemyBullets(h)).toHaveLength(0);
    expect(h.snapshot().drones).toHaveLength(1);
  });

  it("removes one drone and one bullet by id", () => {
    startPosed(h);
    const first = poseDrone(h, "shard", 300, 200);
    const second = poseDrone(h, "shard", 400, 200);
    h.pose((s, d) => d.removeDrone(s, first));
    expect(h.snapshot().drones.map((drone) => drone.id)).toEqual([second]);

    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    const keep = last(h.snapshot().bullets).id;
    h.pose((s, d) => d.addEnemyBullet(s, 500, 400, "magenta"));
    const drop = last(h.snapshot().bullets).id;
    h.pose((s, d) => d.removeBullet(s, drop));
    expect(h.snapshot().bullets.map((bullet) => bullet.id)).toEqual([keep]);
  });
});

describe("the three world gates", () => {
  it("keeps the wave's drones away while entry is off", async () => {
    h.pose((s, d) => d.reset(s));
    h.pose((s, d) => d.setWaveEntry(s, false));
    h.tap("Enter");
    await h.advance(10);
    const held = h.snapshot().drones;
    expect(held.length).toBeGreaterThan(0);
    for (const drone of held) {
      expect(drone.phase).toBe("entering");
      expect(drone.y).toBeLessThan(FIELD_TOP);
    }

    h.pose((s, d) => d.setWaveEntry(s, true));
    await h.advance(2);
    expect(h.snapshot().drones.some((drone) => drone.y > FIELD_TOP)).toBe(true);
  });

  it("launches no dive while dive launching is off", async () => {
    startPosed(h);
    for (let col = 0; col < 5; col++) {
      poseDrone(h, "shard", slotX(col + 2), slotY(0), {
        phase: "formation",
        slotX: slotX(col + 2),
        slotY: slotY(0),
      });
    }
    await h.advance(20);
    expect(
      h.snapshot().drones.every((drone) => drone.phase === "formation"),
    ).toBe(true);

    h.pose((s, d) => d.setDiveClock(s, 0));
    h.pose((s, d) => d.setDiveLaunching(s, true));
    await h.advance(DIVE_FIRST_DELAY + 0.5);
    expect(h.snapshot().drones.some((drone) => drone.phase === "diving")).toBe(
      true,
    );
  });

  it("costs no life while the ship's contact test is off", async () => {
    startPosed(h);
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.5);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().phase).toBe("live");

    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.5);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("holds a drone still while its travel gate is off", async () => {
    startPosed(h);
    const still = poseDrone(h, "shard", 400, 200, { phase: "diving" });
    const moving = poseDrone(h, "shard", 700, 200, {
      phase: "diving",
      travel: true,
    });
    const before = droneOf(h, still);
    await h.advance(1);
    expect(droneOf(h, still)?.x).toBeCloseTo(before?.x ?? 0, 6);
    expect(droneOf(h, still)?.y).toBeCloseTo(before?.y ?? 0, 6);
    expect(droneOf(h, still)?.phase).toBe("diving");
    expect(droneOf(h, moving)?.y).toBeGreaterThan(220);
  });

  it("holds a Flux's band while its oscillation gate is off", async () => {
    startPosed(h);
    const id = poseDrone(h, "flux", 400, 200, { bandClock: 0.2 });
    await h.advance(fluxWindow(1) * 2 + 0.5);
    const drone = droneOf(h, id);
    expect(drone?.band).toBe("cyan");
    expect(drone?.bandClock).toBeCloseTo(0.2, 6);
    expect(drone?.shimmer).toBe(false);
  });

  it("flies a whole dive silent while the fire gate is off", async () => {
    startPosed(h);
    poseDrone(h, "shard", 640, 200, { phase: "diving", travel: true });
    await h.advance(2);
    expect(enemyBullets(h)).toHaveLength(0);

    startPosed(h);
    poseDrone(h, "shard", 640, 200, {
      phase: "diving",
      travel: true,
      fire: true,
    });
    await h.advance(1);
    expect(enemyBullets(h).length).toBeGreaterThan(0);
  });
});

describe("the formation's geometry", () => {
  it("puts a formation drone at its slot plus the sway", async () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 0, 0, {
      phase: "formation",
      slotX: slotX(2),
      slotY: slotY(1),
      travel: true,
    });
    await h.frames(1);
    const drone = droneOf(h, id);
    const sway = swayOffset(h.state.swayClock);
    expect(drone?.x).toBeCloseTo(slotX(2) + sway, 4);
    expect(drone?.y).toBeCloseTo(slotY(1), 6);
  });

  it("sways the whole block as one body", async () => {
    startPosed(h);
    const ids = [0, 3, 8].map((col) =>
      poseDrone(h, "shard", 0, 0, {
        phase: "formation",
        slotX: slotX(col),
        slotY: slotY(2),
        travel: true,
      }),
    );
    for (let step = 0; step < 12; step++) {
      await h.advance(5 / 12);
      const offsets = ids.map((id, index) => {
        const drone = droneOf(h, id);
        return (drone?.x ?? 0) - slotX([0, 3, 8][index] as number);
      });
      for (const offset of offsets) {
        expect(offset).toBeCloseTo(offsets[0] as number, 3);
      }
    }
  });

  it("swings the stated amplitude over the stated period", async () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 0, 0, {
      phase: "formation",
      slotX: FORM_CENTER_X,
      slotY: slotY(0),
      travel: true,
    });
    let low = Infinity;
    let high = -Infinity;
    for (let step = 0; step < 60; step++) {
      await h.advance(5 / 60);
      const x = droneOf(h, id)?.x ?? 0;
      low = Math.min(low, x);
      high = Math.max(high, x);
    }
    expect(high - FORM_CENTER_X).toBeGreaterThan(18);
    expect(FORM_CENTER_X - low).toBeGreaterThan(18);
    expect(high - low).toBeLessThan(44);
  });
});
