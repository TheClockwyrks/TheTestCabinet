import { describe, expect, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  INVERSION_TIME,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  PRISM_INVERT_Y,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  SHARD_HALF,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
  fluxHold,
} from "./constants";
import { droneEffectiveBand } from "./bands";
import { addEnemyBulletTo, addPlayerBulletTo } from "./bullets";
import { resolveContacts } from "./contacts";
import { noCues } from "./audio";
import { liveState, poseDrone, run, STEP } from "./fixtures";

function shoot(
  state: ReturnType<typeof liveState>,
  x: number,
  y: number,
  band: "cyan" | "magenta",
) {
  return addPlayerBulletTo(state, x, y, band);
}

describe("a shot against a drone", () => {
  it("destroys it and fills the meter when the bands match", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 400, 200);
    shoot(state, 400, 200, "cyan");
    const cues = noCues();
    resolveContacts(state, cues);
    expect(state.drones).toHaveLength(0);
    expect(state.bullets).toHaveLength(0);
    expect(state.resonance).toBe(RESONANCE_KILL);
    expect(state.bursts).toHaveLength(1);
    expect(cues.kill).toBe(true);
    expect(drone.id).toBe(1);
  });

  it("spares it and is consumed when they do not", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 400, 200);
    shoot(state, 400, 200, "magenta");
    resolveContacts(state, noCues());
    expect(state.drones).toContain(drone);
    expect(state.bullets).toHaveLength(0);
    expect(state.resonance).toBe(0);
  });

  it("takes the nearest drone first", () => {
    const state = liveState();
    const near = poseDrone(state, "shard", 400, 210);
    const far = poseDrone(state, "shard", 400, 190);
    shoot(state, 400, 214, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toEqual([far]);
    expect(near.id).toBe(1);
  });

  it("destroys nothing when it misses", () => {
    const state = liveState();
    poseDrone(state, "shard", 400, 200);
    shoot(state, 400 + SHARD_HALF + PLAYER_BULLET_HALF + 4, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toHaveLength(1);
    expect(state.bullets).toHaveLength(1);
  });

  it("leaves a shimmering Flux alone, of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const state = liveState();
      const flux = poseDrone(state, "flux", 400, 200, {
        bandClock: fluxHold(1) + 0.1,
      });
      shoot(state, 400, 200, band);
      resolveContacts(state, noCues());
      expect(state.drones).toContain(flux);
      expect(flux.charge).toBe(0);
      expect(state.bullets).toHaveLength(0);
    }
  });

  it("breaks a Prism's shell, then its core", () => {
    const state = liveState();
    const prism = poseDrone(state, "prism", 400, 200);
    shoot(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(prism.shellAlive).toBe(false);
    expect(state.drones).toContain(prism);
    expect(state.resonance).toBe(0);

    shoot(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toContain(prism);

    shoot(state, 400, 200, "magenta");
    resolveContacts(state, noCues());
    expect(state.drones).toHaveLength(0);
    expect(state.resonance).toBe(RESONANCE_KILL);
    expect(state.bursts).toHaveLength(2);
  });

  it("reads the drone through an inversion", () => {
    const state = liveState();
    state.inversion = INVERSION_TIME;
    const drone = poseDrone(state, "shard", 400, 200, { band: "magenta" });
    shoot(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toHaveLength(0);
    expect(drone.band).toBe("magenta");
  });
});

describe("the hull", () => {
  function bulletAtShip(band: "cyan" | "magenta") {
    const state = liveState();
    state.ship.contact = true;
    addEnemyBulletTo(state, state.ship.x, SHIP_Y, band);
    return state;
  }

  it("absorbs an enemy bullet of its own band and fills the meter", () => {
    const state = bulletAtShip("cyan");
    const cues = noCues();
    resolveContacts(state, cues);
    expect(state.lives).toBe(START_LIVES);
    expect(state.bullets).toHaveLength(0);
    expect(state.resonance).toBe(RESONANCE_ABSORB);
    expect(cues.absorb).toBe(true);
  });

  it("loses a life to one of the opposite band", () => {
    const state = bulletAtShip("magenta");
    const cues = noCues();
    resolveContacts(state, cues);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.phase).toBe("ready");
    expect(cues.hit).toBe(true);
  });

  it("loses exactly one life however many bullets arrive at once", () => {
    const state = liveState();
    state.ship.contact = true;
    for (let index = 0; index < 4; index += 1) {
      addEnemyBulletTo(state, state.ship.x, SHIP_Y, "magenta");
    }
    resolveContacts(state, noCues());
    expect(state.lives).toBe(START_LIVES - 1);
  });

  it("loses a life to any drone's body, of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const state = liveState();
      state.ship.contact = true;
      poseDrone(state, "shard", state.ship.x, SHIP_Y, { band });
      resolveContacts(state, noCues());
      expect(state.lives).toBe(START_LIVES - 1);
    }
  });

  it("costs nothing while its contact test is gated off", () => {
    const state = liveState();
    addEnemyBulletTo(state, state.ship.x, SHIP_Y, "magenta");
    poseDrone(state, "shard", state.ship.x, SHIP_Y);
    resolveContacts(state, noCues());
    expect(state.lives).toBe(START_LIVES);
    expect(state.phase).toBe("live");
    expect(state.bullets).toHaveLength(1);
  });

  it("costs nothing more through the ready hold", () => {
    const state = liveState();
    state.ship.contact = true;
    state.phase = "ready";
    addEnemyBulletTo(state, state.ship.x, SHIP_Y, "magenta");
    resolveContacts(state, noCues());
    expect(state.lives).toBe(START_LIVES);
  });

  it("misses a bullet that never reaches it", () => {
    const state = liveState();
    state.ship.contact = true;
    addEnemyBulletTo(
      state,
      state.ship.x + SHIP_HALF + ENEMY_BULLET_HALF + 6,
      SHIP_Y,
      "magenta",
    );
    resolveContacts(state, noCues());
    expect(state.lives).toBe(START_LIVES);
  });
});

describe("a bullet in flight", () => {
  it("climbs at its own speed and leaves at the top", () => {
    const state = liveState();
    const bullet = addPlayerBulletTo(state, 400, 600, "cyan");
    run(state, 0.5);
    expect(600 - bullet.y).toBeCloseTo(PLAYER_BULLET_SPEED * 0.5, 0);
    run(state, 1.5);
    expect(state.bullets).toHaveLength(0);
  });

  it("falls and leaves at the bottom", () => {
    const state = liveState();
    addEnemyBulletTo(state, 400, 200, "cyan");
    run(state, 3);
    expect(state.bullets).toHaveLength(0);
  });

  it("keeps its band when the ship flips", () => {
    const state = liveState();
    const bullet = addPlayerBulletTo(state, 400, 600, "cyan");
    state.ship.band = "magenta";
    run(state, STEP);
    expect(bullet.band).toBe("cyan");
  });
});

describe("an inversion at the moment of a shot", () => {
  it("changes which band destroys a drone", () => {
    const cyanShot = liveState();
    cyanShot.inversion = INVERSION_TIME;
    poseDrone(cyanShot, "shard", 400, 200, { band: "magenta" });
    shoot(cyanShot, 400, 200, "cyan");
    resolveContacts(cyanShot, noCues());
    expect(cyanShot.drones).toHaveLength(0);

    const magentaShot = liveState();
    magentaShot.inversion = INVERSION_TIME;
    poseDrone(magentaShot, "shard", 400, 200, { band: "magenta" });
    shoot(magentaShot, 400, 200, "magenta");
    resolveContacts(magentaShot, noCues());
    expect(magentaShot.drones).toHaveLength(1);
  });

  it("cancels against a broken shell, so two swaps read as none", () => {
    const state = liveState();
    state.inversion = INVERSION_TIME;
    const prism = poseDrone(state, "prism", 400, 200, {
      band: "cyan",
      shellAlive: false,
    });
    expect(droneEffectiveBand(prism, state)).toBe("cyan");
    shoot(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toHaveLength(0);
  });

  it("leaves a player bullet reading its own band", () => {
    const state = liveState();
    state.inversion = INVERSION_TIME;
    poseDrone(state, "shard", 400, 200, { band: "cyan" });
    shoot(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    // The drone inverted to magenta; the bullet did not, so nothing matched.
    expect(state.drones).toHaveLength(1);
  });

  it("ends after its own time and reads as it did before", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 400, 200, { band: "cyan" });
    state.inversion = INVERSION_TIME;
    run(state, INVERSION_TIME * 0.5);
    expect(droneEffectiveBand(drone, state)).toBe("magenta");
    run(state, INVERSION_TIME * 0.6);
    expect(state.inversion).toBe(0);
    expect(droneEffectiveBand(drone, state)).toBe("cyan");
  });

  it("refreshes rather than stacking when a Prism triggers one again", () => {
    const state = liveState();
    state.inversion = INVERSION_TIME * 0.4;
    const prism = poseDrone(state, "prism", 640, PRISM_INVERT_Y - 40, {
      slotX: 640,
      slotY: 200,
      phase: "diving",
      travel: true,
    });
    for (let frame = 0; frame < 60 && prism.phase === "diving"; frame += 1) {
      run(state, STEP);
    }
    expect(prism.phase).toBe("returning");
    expect(state.inversion).toBeGreaterThan(INVERSION_TIME * 0.95);
    expect(state.inversion).toBeLessThanOrEqual(INVERSION_TIME);
  });
});
