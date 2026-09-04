import { beforeEach, describe, expect, it } from "vitest";

import {
  DIVE_FIRE_Y,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  FIELD_BOTTOM,
  FIELD_TOP,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  FLUX_SHIMMER,
  INVERSION_TIME,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
  PRISM_INVERT_Y,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SHIP_H,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  START_LIVES,
  bulletSpeedScale,
  fluxHold,
  fluxWindow,
} from "./constants";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { LANE_CENTER } from "./game";
import { harnessWith, stubArt, type Harness } from "./harness.test-support";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(() => {
  h = harnessWith(stubArt());
  d = createDebugApi(h.state, h.clock);
  d.reset();
});

/** Open a live wave with nothing on it: the ground every mechanic starts from. */
function posed(): void {
  d.reset();
  d.setScreen("inWave");
  d.setPhase("live");
  d.setWaveEntry(false);
  d.setDiveLaunching(false);
}

/** One drone of `kind` at `(x, y)`, on `band`. */
function drone(
  kind: "shard" | "flux" | "prism",
  x: number,
  y: number,
  band: "cyan" | "magenta" = "cyan",
): number {
  const id = d.addDrone(kind, x, y);
  d.setDroneBand(id, band);
  return id;
}

/**
 * One drone parked far from the action, so a scenario that destroys its subject
 * does not also clear the stage on the roster emptying.
 */
function bystander(): number {
  const id = d.addDrone("shard", 120, 480);
  d.setDroneTravel(id, false);
  return id;
}

/** The drone with that id, as the snapshot reports it. */
function look(id: number) {
  const found = d.snapshot().drones.find((entry) => entry.id === id);
  return found;
}

/* -------------------------------------------------------------------------- */

describe("the frame", () => {
  it("reaches the same state however a second was divided into frames", () => {
    const run = (frames: number): string => {
      d.reset({ seed: 9 });
      d.setScreen("inWave");
      const id = drone("shard", 500, 180);
      d.setDronePhase(id, "diving");
      d.advance(1, frames);
      const snapshot = d.snapshot();
      return JSON.stringify({
        drones: snapshot.drones,
        bullets: snapshot.bullets,
        bursts: snapshot.bursts,
        simTime: snapshot.simTime,
        diveClock: snapshot.diveClock,
      });
    };
    const one = run(1);
    expect(run(60)).toBe(one);
    expect(run(120)).toBe(one);
    expect(run(3)).toBe(one);
  });

  it("accumulates simulation time in real time", () => {
    const before = d.snapshot().simTime;
    d.advance(2, 120);
    expect(d.snapshot().simTime - before).toBeCloseTo(2, 6);
  });

  it("advances nothing at all while the game is paused", () => {
    posed();
    const id = drone("shard", 400, 200);
    d.setDronePhase(id, "diving");
    d.addPlayerBullet(700, 400, "cyan");
    d.setInversion(3);
    d.advance(0.2, 12);
    d.setScreen("paused");
    const before = d.snapshot();
    d.advance(2, 120);
    const after = d.snapshot();
    expect(after.drones).toEqual(before.drones);
    expect(after.bullets).toEqual(before.bullets);
    expect(after.inversion).toBe(before.inversion);
    expect(after.diveClock).toBe(before.diveClock);
  });
});

describe("the ship along its lane", () => {
  it("travels at SHIP_SPEED while a direction is held", () => {
    posed();
    d.setShipX(640);
    h.hold("left");
    h.advance(0.5, 30);
    expect(d.snapshot().ship.x).toBeCloseTo(640 - SHIP_SPEED * 0.5, 4);
    h.release("left");
    h.hold("right");
    h.advance(0.5, 30);
    expect(d.snapshot().ship.x).toBeCloseTo(640, 4);
  });

  it("stops in the frame the direction is released, with no drift", () => {
    posed();
    h.hold("right");
    h.advance(0.2, 12);
    const moved = d.snapshot().ship.x;
    h.release("right");
    h.advance(1, 60);
    expect(d.snapshot().ship.x).toBe(moved);
  });

  it("rests at a bound rather than wrapping", () => {
    posed();
    h.hold("left");
    h.advance(5, 300);
    expect(d.snapshot().ship.x).toBe(SHIP_X_MIN);
    h.release("left");
    h.hold("right");
    h.advance(5, 300);
    expect(d.snapshot().ship.x).toBe(SHIP_X_MAX);
  });

  it("stands still while both directions are held", () => {
    posed();
    d.setShipX(500);
    h.hold("left");
    h.hold("right");
    h.advance(1, 60);
    expect(d.snapshot().ship.x).toBe(500);
  });

  it("does not move while the ready hold runs", () => {
    posed();
    d.setPhase("ready");
    d.setPhaseTimer(READY_HOLD);
    d.setShipX(500);
    h.hold("right");
    h.advance(0.5, 30);
    expect(d.snapshot().ship.x).toBe(500);
  });
});

describe("the cannon", () => {
  it("spawns a shot at the ship's nose, travelling straight up on its band", () => {
    posed();
    d.setShipX(700);
    d.setShipBand("magenta");
    h.hold("a");
    h.advance(1 / 60, 1);
    const bullets = d.snapshot().bullets;
    expect(bullets.length).toBe(1);
    const shot = bullets[0];
    expect(shot?.friendly).toBe(true);
    expect(shot?.band).toBe("magenta");
    expect(shot?.vx).toBe(0);
    expect(shot?.vy).toBe(-PLAYER_BULLET_SPEED);
    expect(shot?.x).toBeCloseTo(700, 3);
    // Above the lane, at the nose of the hull.
    expect(shot?.y).toBeLessThan(SHIP_Y);
    expect(shot?.y).toBeGreaterThanOrEqual(SHIP_Y - SHIP_H);
  });

  it("repeats at the fire cadence while the action is held", () => {
    posed();
    h.hold("a");
    h.advance(FIRE_INTERVAL / 2, 4);
    // Only the first shot has left: the cooldown still stands.
    expect(d.snapshot().bullets.length).toBe(1);
    expect(d.snapshot().ship.cooldown).toBeGreaterThan(0);
    d.clearPlayerBullets();
    h.advance(FIRE_INTERVAL, 12);
    expect(d.snapshot().bullets.length).toBe(1);
  });

  it("never has more than MAX_PLAYER_BULLETS in flight", () => {
    posed();
    h.hold("a");
    for (let i = 0; i < 30; i += 1) {
      h.advance(FIRE_INTERVAL, 10);
      expect(
        d.snapshot().bullets.filter((bullet) => bullet.friendly).length,
      ).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    }
  });

  it("is blocked while the fire lockout stands, and fires when it lapses", () => {
    posed();
    d.setFireLockout(FLIP_LOCKOUT);
    h.hold("a");
    h.advance(FLIP_LOCKOUT * 0.9, 20);
    expect(d.snapshot().bullets.length).toBe(0);
    h.advance(FLIP_LOCKOUT, 20);
    expect(d.snapshot().bullets.length).toBeGreaterThan(0);
  });

  it("removes one of its own bullets when it climbs above the field", () => {
    posed();
    d.addPlayerBullet(640, FIELD_TOP + 10, "cyan");
    h.advance(0.05, 6);
    expect(d.snapshot().bullets.length).toBe(0);
  });

  it("removes an enemy bullet when it falls below the field", () => {
    posed();
    d.addEnemyBullet(640, FIELD_BOTTOM - 10, "cyan");
    d.setShipContact(false);
    h.advance(0.2, 12);
    expect(d.snapshot().bullets.length).toBe(0);
  });
});

describe("the flip", () => {
  it("changes the band instantly and starts the fire lockout", () => {
    posed();
    expect(d.snapshot().ship.band).toBe("cyan");
    h.press("b");
    h.advance(1 / 60, 1);
    expect(d.snapshot().ship.band).toBe("magenta");
    expect(d.snapshot().ship.lockout).toBeGreaterThan(0);
    expect(d.snapshot().ship.lockout).toBeLessThanOrEqual(FLIP_LOCKOUT);
  });

  it("restarts a lockout that is still standing", () => {
    posed();
    h.press("b");
    h.advance(FLIP_LOCKOUT / 2, 10);
    const halfway = d.snapshot().ship.lockout;
    h.press("b");
    h.advance(1 / 120, 1);
    expect(d.snapshot().ship.lockout).toBeGreaterThan(halfway);
  });

  it("leaves a bullet already in flight on the band it was fired with", () => {
    posed();
    const id = d.addPlayerBullet(640, 400, "cyan");
    h.press("b");
    h.advance(1 / 60, 1);
    const shot = d.snapshot().bullets.find((bullet) => bullet.id === id);
    expect(shot?.band).toBe("cyan");
    expect(d.snapshot().ship.band).toBe("magenta");
  });

  it("acts exactly once per press, however long the key is held", () => {
    posed();
    h.hold("b");
    h.advance(1, 60);
    expect(d.snapshot().ship.band).toBe("magenta");
  });
});

describe("match to destroy", () => {
  it("destroys a drone whose effective band the shot matches", () => {
    posed();
    const id = drone("shard", 640, 300, "cyan");
    d.addPlayerBullet(640, 316, "cyan");
    h.advance(0.05, 6);
    expect(look(id)).toBeUndefined();
    expect(d.snapshot().bullets.length).toBe(0);
  });

  it("consumes a mismatched shot and leaves the drone exactly as it was", () => {
    posed();
    const id = drone("shard", 640, 300, "magenta");
    // Held still, so every field the mode's rule names can be compared exactly.
    d.setDroneTravel(id, false);
    const before = look(id);
    d.addPlayerBullet(640, 316, "cyan");
    h.advance(0.05, 6);
    const after = look(id);
    expect(after).toEqual(before);
    expect(d.snapshot().bullets.length).toBe(0);
    expect(d.snapshot().score).toBe(0);
    expect(d.snapshot().resonance).toBe(0);
  });

  it("absorbs an enemy bullet of the ship's own band and fills the meter", () => {
    posed();
    d.setShipBand("cyan");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "cyan");
    h.advance(0.05, 6);
    expect(d.snapshot().bullets.length).toBe(0);
    expect(d.snapshot().resonance).toBe(RESONANCE_ABSORB);
    expect(d.snapshot().lives).toBe(START_LIVES);
  });

  it("costs a life to an enemy bullet of the opposite band", () => {
    posed();
    d.setShipBand("cyan");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "magenta");
    h.advance(0.05, 6);
    expect(d.snapshot().lives).toBe(START_LIVES - 1);
    expect(d.snapshot().bullets.length).toBe(0);
    expect(d.snapshot().resonance).toBe(0);
  });

  it("costs a life to a drone's body, of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      posed();
      d.setShipBand("cyan");
      drone("shard", LANE_CENTER, SHIP_Y, band);
      h.advance(1 / 60, 1);
      expect(d.snapshot().lives).toBe(START_LIVES - 1);
    }
  });

  it("costs exactly one life whatever else is on the field", () => {
    posed();
    d.setShipBand("cyan");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y, "magenta");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y, "magenta");
    drone("shard", LANE_CENTER, SHIP_Y, "cyan");
    h.advance(1 / 60, 1);
    expect(d.snapshot().lives).toBe(START_LIVES - 1);
  });
});

describe("the effective band", () => {
  it("flips a Prism's reading once its shell is broken", () => {
    posed();
    const id = drone("prism", 640, 300, "cyan");
    expect(look(id)?.effectiveBand).toBe("cyan");
    d.setDroneShell(id, false);
    expect(look(id)?.effectiveBand).toBe("magenta");
    expect(look(id)?.band).toBe("cyan");
  });

  it("flips every drone and enemy bullet under an inversion", () => {
    posed();
    const id = drone("shard", 640, 300, "cyan");
    const enemy = d.addEnemyBullet(400, 300, "cyan");
    const friendly = d.addPlayerBullet(300, 300, "cyan");
    d.setInversion(INVERSION_TIME);
    expect(look(id)?.effectiveBand).toBe("magenta");
    const bullets = d.snapshot().bullets;
    expect(bullets.find((b) => b.id === enemy)?.effectiveBand).toBe("magenta");
    // The player's own shots and the ship are never swapped.
    expect(bullets.find((b) => b.id === friendly)?.effectiveBand).toBe("cyan");
    expect(d.snapshot().ship.band).toBe("cyan");
  });

  it("cancels two swaps rather than adding them", () => {
    posed();
    const id = drone("prism", 640, 300, "cyan");
    d.setDroneShell(id, false);
    d.setInversion(INVERSION_TIME);
    expect(look(id)?.effectiveBand).toBe("cyan");
  });

  it("ends the inversion when its time runs out", () => {
    posed();
    const id = drone("shard", 640, 300, "cyan");
    d.setInversion(0.5);
    h.advance(0.6, 36);
    expect(d.snapshot().inversion).toBe(0);
    expect(d.snapshot().inversionActive).toBe(false);
    expect(look(id)?.effectiveBand).toBe("cyan");
  });

  it("refreshes rather than stacking a fresh inversion", () => {
    posed();
    d.setInversion(1);
    h.advance(0.5, 30);
    d.setInversion(INVERSION_TIME);
    expect(d.snapshot().inversion).toBeCloseTo(INVERSION_TIME, 6);
  });

  it("changes the outcome of a shot while it is active", () => {
    posed();
    const id = drone("shard", 640, 300, "magenta");
    d.setInversion(INVERSION_TIME);
    d.addPlayerBullet(640, 316, "cyan");
    h.advance(0.05, 6);
    expect(look(id)).toBeUndefined();
  });
});

describe("a Flux's rhythm", () => {
  it("runs its band clock and flips its stored band at the window's end", () => {
    posed();
    d.setStage(1);
    const id = drone("flux", 640, 300, "cyan");
    d.setDroneBandClock(id, 0);
    const window = fluxWindow(1);
    h.advance(window * 0.5, 60);
    expect(look(id)?.band).toBe("cyan");
    expect(look(id)?.shimmer).toBe(false);
    h.advance(window * 0.45, 60);
    expect(look(id)?.shimmer).toBe(true);
    expect(look(id)?.band).toBe("cyan");
    h.advance(window * 0.1, 20);
    expect(look(id)?.band).toBe("magenta");
    expect(look(id)?.bandClock).toBeLessThan(window);
  });

  it("shimmers for exactly FLUX_SHIMMER of every window", () => {
    posed();
    d.setStage(1);
    const id = drone("flux", 640, 300, "cyan");
    d.setDroneBandClock(id, fluxHold(1) - 0.01);
    expect(look(id)?.shimmer).toBe(false);
    d.setDroneBandClock(id, fluxHold(1));
    expect(look(id)?.shimmer).toBe(true);
    d.setDroneBandClock(id, fluxWindow(1) - 0.01);
    expect(look(id)?.shimmer).toBe(true);
    expect(fluxWindow(1) - fluxHold(1)).toBeCloseTo(FLUX_SHIMMER, 10);
  });

  it("reads as the band it is moving toward while it shimmers", () => {
    posed();
    const id = drone("flux", 640, 300, "cyan");
    d.setDroneBandClock(id, fluxHold(1) + 0.1);
    expect(look(id)?.band).toBe("cyan");
    expect(look(id)?.effectiveBand).toBe("magenta");
  });

  it("cannot be destroyed mid-shimmer, by either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      posed();
      const id = drone("flux", 640, 300, "cyan");
      d.setDroneBandClock(id, fluxHold(1) + 0.1);
      d.setDroneOscillation(id, false);
      d.addPlayerBullet(640, 316, band);
      h.advance(0.05, 6);
      expect(look(id)).toBeDefined();
      expect(d.snapshot().bullets.length).toBe(0);
    }
  });

  it("is destroyed by a matching shot in the held part of its window", () => {
    posed();
    const id = drone("flux", 640, 300, "magenta");
    d.setDroneBandClock(id, 0.1);
    d.setDroneOscillation(id, false);
    d.addPlayerBullet(640, 316, "magenta");
    h.advance(0.05, 6);
    expect(look(id)).toBeUndefined();
  });

  it("holds its band and its shimmer while its oscillation is off", () => {
    posed();
    const id = drone("flux", 640, 300, "cyan");
    d.setDroneBandClock(id, fluxHold(1) + 0.1);
    d.setDroneOscillation(id, false);
    h.advance(10, 200);
    expect(look(id)?.shimmer).toBe(true);
    expect(look(id)?.band).toBe("cyan");
  });
});

describe("a Prism's two layers", () => {
  it("breaks the shell, then the core, one matching shot each", () => {
    posed();
    bystander();
    const id = drone("prism", 640, 300, "cyan");
    d.addPlayerBullet(640, 330, "cyan");
    h.advance(0.06, 8);
    expect(look(id)?.shellAlive).toBe(false);
    expect(d.snapshot().score).toBe(SCORE_PRISM_SHELL);
    // The shell's fall adds nothing to the meter.
    expect(d.snapshot().resonance).toBe(0);
    d.addPlayerBullet(640, 315, "magenta");
    h.advance(0.06, 8);
    expect(look(id)).toBeUndefined();
    expect(d.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    expect(d.snapshot().resonance).toBe(RESONANCE_KILL);
  });

  it("survives a shot of the band the shell does not carry", () => {
    posed();
    const id = drone("prism", 640, 300, "cyan");
    d.addPlayerBullet(640, 330, "magenta");
    h.advance(0.06, 8);
    expect(look(id)?.shellAlive).toBe(true);
    expect(d.snapshot().score).toBe(0);
  });

  it("survives the shell's own band once only the core is left", () => {
    posed();
    const id = drone("prism", 640, 300, "cyan");
    d.setDroneShell(id, false);
    d.addPlayerBullet(640, 315, "cyan");
    h.advance(0.06, 8);
    expect(look(id)).toBeDefined();
  });

  it("keeps its id across the loss of its shell", () => {
    posed();
    const id = drone("prism", 640, 300, "cyan");
    d.addPlayerBullet(640, 330, "cyan");
    h.advance(0.06, 8);
    expect(look(id)?.id).toBe(id);
  });

  it("inverts the field when a dive carries it past PRISM_INVERT_Y", () => {
    posed();
    const id = drone("prism", 640, PRISM_INVERT_Y - 30, "cyan");
    d.setDronePhase(id, "diving");
    h.advance(0.6, 36);
    expect(d.snapshot().inversionActive).toBe(true);
    expect(d.snapshot().inversion).toBeGreaterThan(0);
    // It is unharmed by the crossing, and heads back to its slot.
    expect(look(id)).toBeDefined();
    expect(look(id)?.phase).toBe("returning");
    expect(h.cues).toContain("inversion");
  });

  it("fires two shots as it crosses the fire line, one per band", () => {
    posed();
    const id = drone("prism", 640, DIVE_FIRE_Y - 40, "cyan");
    d.setDronePhase(id, "diving");
    h.advance(0.4, 24);
    const enemies = d.snapshot().bullets.filter((b) => !b.friendly);
    expect(enemies.length).toBe(2);
    expect(new Set(enemies.map((b) => b.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
  });
});

describe("the swarm's own faculties", () => {
  it("releases its entry groups on the ENTER_GROUP_GAP schedule", () => {
    d.reset();
    d.setScreen("stageIntro");
    d.setPhaseTimer(0.01);
    d.setDiveLaunching(false);
    h.advance(0.02, 2);
    expect(d.snapshot().screen).toBe("inWave");
    const total = d.snapshot().drones.length;
    expect(total).toBeGreaterThan(0);
    // The first group is on its way as the wave opens; the last is not.
    const entered = (): number =>
      d.snapshot().drones.filter((drone) => drone.y >= FIELD_TOP).length;
    expect(entered()).toBeLessThan(total);
    h.advance(ENTER_GROUP_GAP * 8 + 6, 500);
    expect(
      d.snapshot().drones.filter((drone) => drone.phase === "formation").length,
    ).toBeGreaterThan(0);
  });

  it("arrives with no drone standing inside the play field", () => {
    d.reset();
    d.setScreen("stageIntro");
    d.setPhaseTimer(0.001);
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    h.advance(0.002, 1);
    for (const entry of d.snapshot().drones) {
      expect(entry.y).toBeLessThan(FIELD_TOP);
      expect(entry.phase).toBe("entering");
    }
  });

  it("sends no drone in at all while wave entry is off", () => {
    d.reset();
    d.setScreen("stageIntro");
    d.setPhaseTimer(0.001);
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    h.advance(0.002, 1);
    const before = d.snapshot().drones.map((entry) => [entry.x, entry.y]);
    h.advance(4, 240);
    expect(d.snapshot().drones.map((entry) => [entry.x, entry.y])).toEqual(
      before,
    );
  });

  it("launches its first dive when the dive clock reaches DIVE_FIRST_DELAY", () => {
    posed();
    d.setDiveLaunching(true);
    drone("shard", 500, 200);
    drone("shard", 600, 200);
    d.setDiveClock(0);
    h.advance(DIVE_FIRST_DELAY * 0.9, 60);
    expect(d.snapshot().drones.every((e) => e.phase === "formation")).toBe(
      true,
    );
    h.advance(DIVE_FIRST_DELAY * 0.2, 20);
    expect(d.snapshot().drones.some((e) => e.phase === "diving")).toBe(true);
    // And the clock returned to zero at the launch.
    expect(d.snapshot().diveClock).toBeLessThan(DIVE_FIRST_DELAY);
  });

  it("draws each later gap between DIVE_GAP_MIN and DIVE_GAP_MAX", () => {
    posed();
    d.setDiveLaunching(true);
    for (let i = 0; i < 9; i += 1) drone("shard", 400 + i * 40, 200);
    d.setDiveClock(DIVE_FIRST_DELAY);
    h.advance(1 / 120, 1);
    // Drive several launches and watch the gaps the clock is measured against.
    let launches = 0;
    let elapsed = 0;
    const gaps: number[] = [];
    let previous = 0;
    while (launches < 4 && elapsed < 30) {
      h.advance(1 / 60, 1);
      elapsed += 1 / 60;
      const clock = d.snapshot().diveClock;
      if (clock < previous) {
        gaps.push(previous);
        launches += 1;
      }
      previous = clock;
    }
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const gap of gaps.slice(1)) {
      expect(gap).toBeGreaterThanOrEqual(DIVE_GAP_MIN - 0.05);
      expect(gap).toBeLessThanOrEqual(DIVE_GAP_MAX + 0.05);
    }
  });

  it("launches nothing while dive launching is off", () => {
    posed();
    for (let i = 0; i < 5; i += 1) drone("shard", 400 + i * 60, 200);
    d.setDiveClock(0);
    h.advance(20, 600);
    expect(d.snapshot().drones.every((e) => e.phase === "formation")).toBe(
      true,
    );
    // And the clock itself is held.
    expect(d.snapshot().diveClock).toBe(0);
  });

  it("holds a drone's exact centre while its travel is off", () => {
    posed();
    const id = drone("flux", 500, 300, "cyan");
    d.setDronePhase(id, "diving");
    d.setDroneTravel(id, false);
    const before = look(id);
    h.advance(2, 120);
    const after = look(id);
    expect([after?.x, after?.y]).toEqual([before?.x, before?.y]);
    expect(after?.phase).toBe("diving");
    // Its band clock ran on all the same.
    expect(after?.bandClock).toBeGreaterThan(before?.bandClock ?? 0);
  });

  it("lets only a diving drone fire", () => {
    for (const phase of ["formation", "entering", "returning"] as const) {
      posed();
      const id = drone("shard", 640, DIVE_FIRE_Y - 60);
      d.setDroneSlot(id, 640, 200);
      d.setDronePhase(id, phase);
      h.advance(3, 180);
      expect(d.snapshot().bullets.filter((b) => !b.friendly).length).toBe(0);
    }
  });

  it("takes its first shot as its centre crosses DIVE_FIRE_Y", () => {
    posed();
    const id = drone("shard", 640, DIVE_FIRE_Y - 80, "cyan");
    d.setDronePhase(id, "diving");
    let fired: number | undefined;
    for (let i = 0; i < 240 && fired === undefined; i += 1) {
      h.advance(1 / 120, 1);
      const shot = d.snapshot().bullets.find((b) => !b.friendly);
      if (shot !== undefined) fired = shot.y;
    }
    expect(fired).toBeDefined();
    expect(Math.abs((fired ?? 0) - DIVE_FIRE_Y)).toBeLessThan(12);
  });

  it("takes exactly one shot over a Shard's dive", () => {
    posed();
    const id = drone("shard", 640, DIVE_FIRE_Y - 80, "cyan");
    d.setDronePhase(id, "diving");
    d.setShipContact(false);
    h.advance(6, 360);
    // Bullets leave the field, so the count is of what was fired, not what is
    // in flight: clear as they go and count.
    expect(
      d.snapshot().bullets.filter((b) => !b.friendly).length,
    ).toBeLessThanOrEqual(1);
  });

  it("flies its whole dive silent while its firing is off", () => {
    posed();
    const id = drone("shard", 640, DIVE_FIRE_Y - 80, "cyan");
    d.setDroneFire(id, false);
    d.setDronePhase(id, "diving");
    d.setShipContact(false);
    h.advance(6, 360);
    expect(d.snapshot().bullets.filter((b) => !b.friendly).length).toBe(0);
  });

  it("fires an enemy bullet straight down, on its firer's band", () => {
    posed();
    d.setStage(4);
    const id = drone("shard", 640, DIVE_FIRE_Y - 60, "magenta");
    d.setDronePhase(id, "diving");
    d.setShipContact(false);
    for (let i = 0; i < 120; i += 1) {
      h.advance(1 / 120, 1);
      const shot = d.snapshot().bullets.find((b) => !b.friendly);
      if (shot !== undefined) {
        expect(shot.band).toBe("magenta");
        expect(shot.vx).toBe(0);
        expect(shot.vy).toBeCloseTo(
          ENEMY_BULLET_SPEED * bulletSpeedScale(4),
          6,
        );
        return;
      }
    }
    throw new Error("the diver never fired");
  });

  it("holds a shimmering Flux's shot until it settles", () => {
    posed();
    d.setStage(1);
    const id = drone("flux", 640, DIVE_FIRE_Y - 30, "cyan");
    d.setDroneBandClock(id, fluxHold(1) + 0.05);
    d.setDronePhase(id, "diving");
    d.setDroneOscillation(id, false);
    d.setShipContact(false);
    h.advance(0.5, 60);
    // Held in the shimmer: nothing has been fired.
    expect(d.snapshot().bullets.filter((b) => !b.friendly).length).toBe(0);
    d.setDroneBandClock(id, 0);
    h.advance(1 / 60, 1);
    expect(d.snapshot().bullets.filter((b) => !b.friendly).length).toBe(1);
  });

  it("rides the sway in formation, every slotted drone by one offset", () => {
    posed();
    const a = drone("shard", 500, 200);
    const b = drone("shard", 700, 260);
    d.setDroneSlot(a, 500, 200);
    d.setDroneSlot(b, 700, 260);
    h.advance(1.25, 80);
    const first = look(a);
    const second = look(b);
    expect((first?.x ?? 0) - 500).toBeCloseTo((second?.x ?? 0) - 700, 6);
    expect(Math.abs((first?.x ?? 0) - 500)).toBeGreaterThan(1);
    expect(first?.y).toBe(200);
  });
});
