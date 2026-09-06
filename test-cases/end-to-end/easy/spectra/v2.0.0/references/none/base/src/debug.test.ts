import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DIVE_FIRST_DELAY,
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  START_LIVES,
  bulletSpeedScale,
} from "./constants";
import {
  createDebugApi,
  installDebugApi,
  SPECTRA_HANDLE,
  type SpectraDebugApi,
} from "./debug";
import { LANE_CENTER } from "./game";
import { harnessWith, stubArt, type Harness } from "./harness.test-support";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(() => {
  h = harnessWith(stubArt());
  d = createDebugApi(h.state, h.clock);
  d.reset();
});

describe("the surface", () => {
  it("reports the version the specification fixes", () => {
    expect(d.version).toBe(SPECTRA_DEBUG_VERSION);
    expect(d.snapshot().version).toBe(SPECTRA_DEBUG_VERSION);
  });

  it("names the mode this build ships", () => {
    expect(d.snapshot().mode).toBe("sortie");
  });

  it("returns the whole snapshot shape, with every declared field", () => {
    d.setScreen("inWave");
    const id = d.addDrone("flux", 400, 200);
    d.addPlayerBullet(300, 400, "cyan");
    const snapshot = d.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "version",
        "screen",
        "phase",
        "phaseTimer",
        "menuIndex",
        "mode",
        "stage",
        "isChallenge",
        "score",
        "lives",
        "extraLifeAwarded",
        "challengeHits",
        "resonance",
        "dischargeReady",
        "inversion",
        "inversionActive",
        "muted",
        "waveEntry",
        "diveLaunching",
        "stageClearing",
        "diveClock",
        "diveGap",
        "droneSpeedScale",
        "bulletSpeedScale",
        "diveGapScale",
        "fluxHold",
        "ship",
        "discharge",
        "drones",
        "bullets",
        "bursts",
        "simTime",
      ].sort(),
    );
    expect(Object.keys(snapshot.ship).sort()).toEqual(
      ["x", "band", "alive", "lockout", "cooldown", "contact"].sort(),
    );
    expect(Object.keys(snapshot.discharge).sort()).toEqual(
      ["active", "radius"].sort(),
    );
    expect(Object.keys(snapshot.drones[0] ?? {}).sort()).toEqual(
      [
        "id",
        "kind",
        "x",
        "y",
        "band",
        "effectiveBand",
        "phase",
        "slotX",
        "slotY",
        "bandClock",
        "shimmer",
        "shellAlive",
        "travel",
        "oscillation",
        "fire",
      ].sort(),
    );
    expect(Object.keys(snapshot.bullets[0] ?? {}).sort()).toEqual(
      ["id", "x", "y", "vx", "vy", "band", "effectiveBand", "friendly"].sort(),
    );
    expect(id).toBeGreaterThan(0);
  });

  it("reports a burst's own fields once one is playing", () => {
    d.setScreen("inWave");
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    d.addDrone("shard", 400, 480);
    d.addDrone("shard", 640, 300);
    d.addPlayerBullet(640, 316, "cyan");
    h.advance(0.06, 8);
    const burst = d.snapshot().bursts[0];
    expect(Object.keys(burst ?? {}).sort()).toEqual(
      ["id", "x", "y", "size", "elapsed", "particles"].sort(),
    );
    expect(burst?.particles).toBeGreaterThan(0);
  });

  it("changes nothing when it is read", () => {
    d.setScreen("inWave");
    d.addDrone("flux", 400, 200);
    const before = JSON.stringify(d.snapshot());
    d.snapshot();
    d.snapshot();
    expect(JSON.stringify(d.snapshot())).toBe(before);
  });

  it("is installed on the window and removed again", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.window;
    globals.window = {};
    try {
      const remove = installDebugApi(h.state, h.clock);
      const installed = (globals.window as Record<string, unknown>)[
        SPECTRA_HANDLE
      ] as SpectraDebugApi;
      expect(installed.version).toBe(SPECTRA_DEBUG_VERSION);
      remove();
      expect(
        (globals.window as Record<string, unknown>)[SPECTRA_HANDLE],
      ).toBeUndefined();
      // Removing twice is harmless.
      remove();
    } finally {
      globals.window = previous;
    }
  });
});

describe("reset", () => {
  it("restores every field the specification lists", () => {
    d.setScreen("gameOver");
    d.setPhase("ready");
    d.setPhaseTimer(9);
    d.setMenuIndex(2);
    d.setScore(4321);
    d.setLives(9);
    d.setStage(7);
    d.setResonance(80);
    d.setInversion(3);
    d.setExtraLifeAwarded(true);
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    d.setShipContact(false);
    d.setDiveClock(1.8);
    d.setShipX(200);
    d.setShipBand("magenta");
    d.setFireLockout(0.2);
    d.setFireCooldown(0.1);
    d.addDrone("prism", 400, 200);
    d.addEnemyBullet(400, 300, "cyan");
    d.setScreen("inWave");
    h.advance(0.1, 6);

    d.reset();
    const s = d.snapshot();
    expect(s.screen).toBe("title");
    expect(s.phase).toBe("live");
    expect(s.phaseTimer).toBe(0);
    expect(s.menuIndex).toBe(0);
    expect(s.score).toBe(0);
    expect(s.lives).toBe(START_LIVES);
    expect(s.stage).toBe(1);
    expect(s.resonance).toBe(0);
    expect(s.inversion).toBe(0);
    expect(s.extraLifeAwarded).toBe(false);
    expect(s.waveEntry).toBe(true);
    expect(s.diveLaunching).toBe(true);
    expect(s.stageClearing).toBe(true);
    expect(s.ship.contact).toBe(true);
    expect(s.diveClock).toBe(0);
    expect(s.diveGap).toBe(DIVE_FIRST_DELAY);
    expect(s.ship.x).toBe(LANE_CENTER);
    expect(s.ship.band).toBe("cyan");
    expect(s.ship.lockout).toBe(0);
    expect(s.ship.cooldown).toBe(0);
    expect(s.drones).toEqual([]);
    expect(s.bullets).toEqual([]);
    expect(s.bursts).toEqual([]);
    expect(s.discharge).toEqual({ active: false, radius: 0 });
    expect(s.simTime).toBe(0);
  });

  it("leaves the mute bit exactly as it stands", () => {
    h.press("mute");
    h.advance(1 / 60, 1);
    expect(d.snapshot().muted).toBe(true);
    d.reset();
    h.advance(1 / 60, 1);
    expect(d.snapshot().muted).toBe(true);
  });
});

describe("the clock", () => {
  it("takes the game off real time and gives it back", () => {
    const clock = { setAutoStep: vi.fn(), advance: vi.fn() };
    const api = createDebugApi(h.state, clock);
    api.setAutoStep(false);
    expect(clock.setAutoStep).toHaveBeenCalledWith(false);
    api.setAutoStep(true);
    expect(clock.setAutoStep).toHaveBeenCalledWith(true);
    api.advance(1, 60);
    expect(clock.advance).toHaveBeenCalledWith(1, 60);
    api.advance(1);
    expect(clock.advance).toHaveBeenLastCalledWith(1, 1);
  });

  it("runs whole frames of game time immediately", () => {
    const before = d.snapshot().simTime;
    d.advance(0.5, 30);
    expect(d.snapshot().simTime - before).toBeCloseTo(0.5, 6);
  });
});

describe("every pose reads back", () => {
  it("poses the screen and the run", () => {
    for (const screen of [
      "title",
      "howto",
      "stageIntro",
      "inWave",
      "paused",
      "stageCleared",
      "gameOver",
    ] as const) {
      d.setScreen(screen);
      expect(d.snapshot().screen).toBe(screen);
    }
    for (const phase of ["live", "ready"] as const) {
      d.setPhase(phase);
      expect(d.snapshot().phase).toBe(phase);
    }
    d.setPhaseTimer(1.75);
    expect(d.snapshot().phaseTimer).toBe(1.75);
    d.setMenuIndex(2);
    expect(d.snapshot().menuIndex).toBe(2);
    d.setScore(9876);
    expect(d.snapshot().score).toBe(9876);
    d.setLives(5);
    expect(d.snapshot().lives).toBe(5);
    d.setStage(11);
    expect(d.snapshot().stage).toBe(11);
    d.setExtraLifeAwarded(true);
    expect(d.snapshot().extraLifeAwarded).toBe(true);
    d.setChallengeHits(17);
    expect(d.snapshot().challengeHits).toBe(17);
  });

  it("poses the four world gates and the dive clock", () => {
    for (const enabled of [false, true]) {
      d.setWaveEntry(enabled);
      expect(d.snapshot().waveEntry).toBe(enabled);
      d.setDiveLaunching(enabled);
      expect(d.snapshot().diveLaunching).toBe(enabled);
      d.setStageClearing(enabled);
      expect(d.snapshot().stageClearing).toBe(enabled);
      d.setShipContact(enabled);
      expect(d.snapshot().ship.contact).toBe(enabled);
    }
    d.setDiveClock(1.25);
    expect(d.snapshot().diveClock).toBe(1.25);
    d.setDiveClock(0);
    expect(d.snapshot().diveClock).toBe(0);
    d.setDiveGap(1.75);
    expect(d.snapshot().diveGap).toBe(1.75);
  });

  it("poses the ship and its cannon", () => {
    d.setShipX(300);
    expect(d.snapshot().ship.x).toBe(300);
    // The lane's clamp applies, so the ship never lands outside it.
    d.setShipX(-500);
    expect(d.snapshot().ship.x).toBe(SHIP_X_MIN);
    d.setShipX(9999);
    expect(d.snapshot().ship.x).toBe(SHIP_X_MAX);
    for (const band of ["magenta", "cyan"] as const) {
      d.setShipBand(band);
      expect(d.snapshot().ship.band).toBe(band);
    }
    // Setting the band starts no lockout.
    expect(d.snapshot().ship.lockout).toBe(0);
    d.setFireLockout(0.24);
    expect(d.snapshot().ship.lockout).toBe(0.24);
    d.setFireCooldown(0.08);
    expect(d.snapshot().ship.cooldown).toBe(0.08);
  });

  it("poses the meter and the inversion, and the derived pair follows", () => {
    d.setResonance(RESONANCE_MAX);
    expect(d.snapshot().resonance).toBe(RESONANCE_MAX);
    expect(d.snapshot().dischargeReady).toBe(true);
    d.setResonance(0);
    expect(d.snapshot().dischargeReady).toBe(false);
    // Out-of-range values are held inside the meter's own bounds.
    d.setResonance(500);
    expect(d.snapshot().resonance).toBe(RESONANCE_MAX);
    d.setResonance(-5);
    expect(d.snapshot().resonance).toBe(0);
    d.setInversion(2.5);
    expect(d.snapshot().inversion).toBe(2.5);
    expect(d.snapshot().inversionActive).toBe(true);
    d.setInversion(0);
    expect(d.snapshot().inversionActive).toBe(false);
  });

  it("poses every field of a drone, one at a time", () => {
    const id = d.addDrone("flux", 400, 200);
    d.setDronePosition(id, 512, 256);
    d.setDroneSlot(id, 600, 300);
    d.setDroneBand(id, "magenta");
    d.setDroneBandClock(id, 0.75);
    d.setDroneShell(id, false);
    d.setDroneTravel(id, false);
    d.setDroneOscillation(id, false);
    d.setDroneFire(id, false);
    const drone = d.snapshot().drones[0];
    expect(drone).toMatchObject({
      id,
      kind: "flux",
      x: 512,
      y: 256,
      slotX: 600,
      slotY: 300,
      band: "magenta",
      bandClock: 0.75,
      // A Flux has no shell, so setDroneShell moves nothing on one
      // (specs/instrumentation.md); it is posed on a Prism below.
      shellAlive: true,
      travel: false,
      oscillation: false,
      fire: false,
    });
    for (const phase of [
      "entering",
      "diving",
      "returning",
      "formation",
    ] as const) {
      d.setDronePhase(id, phase);
      expect(d.snapshot().drones[0]?.phase).toBe(phase);
    }
  });

  it("poses a shell on a Prism and on no other kind", () => {
    for (const kind of ["shard", "flux", "prism"] as const) {
      d.clearDrones();
      const id = d.addDrone(kind, 400, 200);
      d.setDroneShell(id, false);
      expect(d.snapshot().drones[0]?.shellAlive).toBe(kind !== "prism");
    }
  });

  it("poses a band clock on a Flux and on no other kind", () => {
    for (const kind of ["shard", "flux", "prism"] as const) {
      d.clearDrones();
      const id = d.addDrone(kind, 400, 200);
      d.setDroneBandClock(id, 0.5);
      expect(d.snapshot().drones[0]?.bandClock).toBe(kind === "flux" ? 0.5 : 0);
    }
  });

  it("moves a drone's band and its band clock independently", () => {
    const id = d.addDrone("flux", 400, 200);
    d.setDroneBandClock(id, 1.1);
    d.setDroneBand(id, "magenta");
    expect(d.snapshot().drones[0]?.bandClock).toBe(1.1);
    d.setDroneBandClock(id, 0.2);
    expect(d.snapshot().drones[0]?.band).toBe("magenta");
  });

  it("gives a fresh drone its stated resting values", () => {
    const id = d.addDrone("prism", 333, 222);
    const drone = d.snapshot().drones[0];
    expect(drone).toMatchObject({
      id,
      kind: "prism",
      x: 333,
      y: 222,
      slotX: 333,
      slotY: 222,
      band: "cyan",
      phase: "formation",
      bandClock: 0,
      shellAlive: true,
      travel: true,
      oscillation: true,
      fire: true,
    });
  });

  it("reports a Flux's clock and nothing else's", () => {
    const flux = d.addDrone("flux", 100, 100);
    const shard = d.addDrone("shard", 200, 100);
    d.setDroneBandClock(flux, 0.5);
    d.setDroneBandClock(shard, 0.5);
    const drones = d.snapshot().drones;
    expect(drones.find((entry) => entry.id === flux)?.bandClock).toBe(0.5);
    expect(drones.find((entry) => entry.id === shard)?.bandClock).toBe(0);
    expect(drones.find((entry) => entry.id === shard)?.shimmer).toBe(false);
  });

  it("adds a bullet of each kind, appended with a fresh id", () => {
    const friendly = d.addPlayerBullet(400, 500, "magenta");
    const enemy = d.addEnemyBullet(500, 200, "cyan");
    const bullets = d.snapshot().bullets;
    expect(bullets.length).toBe(2);
    expect(bullets[0]).toMatchObject({
      id: friendly,
      x: 400,
      y: 500,
      vx: 0,
      vy: -PLAYER_BULLET_SPEED,
      band: "magenta",
      friendly: true,
    });
    expect(bullets[1]).toMatchObject({
      id: enemy,
      x: 500,
      y: 200,
      vx: 0,
      vy: ENEMY_BULLET_SPEED * bulletSpeedScale(1),
      band: "cyan",
      friendly: false,
    });
    // The last entry is the one just added, so its id is read from there.
    expect(bullets[bullets.length - 1]?.id).toBe(enemy);
  });

  it("scales an added enemy bullet's speed for the current stage", () => {
    d.setStage(6);
    d.addEnemyBullet(500, 200, "cyan");
    expect(d.snapshot().bullets[0]?.vy).toBeCloseTo(
      ENEMY_BULLET_SPEED * bulletSpeedScale(6),
      6,
    );
  });

  it("sets a bullet's velocity", () => {
    const id = d.addPlayerBullet(400, 500, "cyan");
    d.setBulletVelocity(id, 120, -40);
    expect(d.snapshot().bullets[0]).toMatchObject({ vx: 120, vy: -40 });
  });
});

describe("the removals", () => {
  it("removes one drone by id and leaves the rest", () => {
    const a = d.addDrone("shard", 100, 100);
    const b = d.addDrone("shard", 200, 100);
    d.removeDrone(a);
    expect(d.snapshot().drones.map((entry) => entry.id)).toEqual([b]);
    // Removing an id that is already gone is harmless.
    d.removeDrone(a);
    expect(d.snapshot().drones.length).toBe(1);
  });

  it("clears the drones, leaving the bullets and the bursts standing", () => {
    d.addDrone("shard", 100, 100);
    d.addPlayerBullet(300, 300, "cyan");
    d.clearDrones();
    expect(d.snapshot().drones).toEqual([]);
    expect(d.snapshot().bullets.length).toBe(1);
  });

  it("clears each kind of bullet without touching the other", () => {
    d.addPlayerBullet(100, 300, "cyan");
    d.addEnemyBullet(200, 300, "cyan");
    d.clearPlayerBullets();
    expect(d.snapshot().bullets.map((entry) => entry.friendly)).toEqual([
      false,
    ]);
    d.addPlayerBullet(100, 300, "cyan");
    d.clearEnemyBullets();
    expect(d.snapshot().bullets.map((entry) => entry.friendly)).toEqual([true]);
  });

  it("removes one bullet by id", () => {
    const a = d.addPlayerBullet(100, 300, "cyan");
    const b = d.addPlayerBullet(200, 300, "cyan");
    d.removeBullet(a);
    expect(d.snapshot().bullets.map((entry) => entry.id)).toEqual([b]);
  });

  it("clears the bursts, leaving the drones and the bullets standing", () => {
    d.setScreen("inWave");
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    d.addDrone("shard", 200, 480);
    d.addDrone("shard", 640, 300);
    d.addPlayerBullet(640, 316, "cyan");
    h.advance(0.06, 8);
    expect(d.snapshot().bursts.length).toBe(1);
    const burst = d.snapshot().bursts[0];
    d.removeBurst(burst?.id ?? 0);
    expect(d.snapshot().bursts).toEqual([]);
    expect(d.snapshot().drones.length).toBe(1);
    d.clearBursts();
    expect(d.snapshot().bursts).toEqual([]);
  });
});

describe("identity", () => {
  it("gives every live entity a distinct id, kept for its whole life", () => {
    d.setScreen("inWave");
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1)
      ids.push(d.addDrone("shard", 100 + i * 60, 200));
    // Well clear of the drones, so nothing is destroyed on the way up.
    for (let i = 0; i < 3; i += 1)
      ids.push(d.addPlayerBullet(900 + i * 60, 400, "cyan"));
    expect(new Set(ids).size).toBe(ids.length);
    const before = d.snapshot().drones.map((entry) => entry.id);
    h.advance(0.5, 30);
    expect(d.snapshot().drones.map((entry) => entry.id)).toEqual(before);
  });

  it("appends an added entity, so its id is read from the last entry", () => {
    const first = d.addDrone("shard", 100, 100);
    const second = d.addDrone("flux", 200, 100);
    const drones = d.snapshot().drones;
    expect(drones[0]?.id).toBe(first);
    expect(drones[drones.length - 1]?.id).toBe(second);
  });
});

describe("a caller error", () => {
  it("names the id of a drone that is not there", () => {
    expect(() => d.setDronePosition(999, 1, 1)).toThrow(/no drone with id 999/);
    expect(() => d.setDroneBand(999, "cyan")).toThrow(/no drone with id 999/);
    expect(() => d.setDronePhase(999, "diving")).toThrow(/no drone/);
    expect(() => d.setBulletVelocity(999, 0, 0)).toThrow(/no bullet with id/);
  });

  it("names a value that is not a band", () => {
    expect(() => d.setShipBand("teal" as unknown as "cyan")).toThrow(
      /is not a band/,
    );
  });

  it("holds a stage at one or above, as a whole number", () => {
    d.setStage(0);
    expect(d.snapshot().stage).toBe(1);
    d.setStage(-4);
    expect(d.snapshot().stage).toBe(1);
    d.setStage(4.8);
    expect(d.snapshot().stage).toBe(4);
    d.setStage(Number.NaN);
    expect(d.snapshot().stage).toBe(1);
  });

  it("holds a posed duration at zero or above", () => {
    d.setFireLockout(-1);
    expect(d.snapshot().ship.lockout).toBe(0);
    d.setInversion(-3);
    expect(d.snapshot().inversion).toBe(0);
    d.setDiveClock(-2);
    expect(d.snapshot().diveClock).toBe(0);
  });
});
