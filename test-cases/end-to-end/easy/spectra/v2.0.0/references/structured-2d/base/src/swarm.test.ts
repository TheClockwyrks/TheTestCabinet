// How a drone behaves: its phases, its paths, its fire, and the wave's own
// dive launching.

import { describe, expect, it } from "vitest";
import {
  DIVE_FIRE_Y,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_TOP,
  INVERSION_TIME,
  PRISM_INVERT_Y,
  SWAY_AMP,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  swayOffset,
} from "./constants";
import { newFrameEvents } from "./events";
import {
  slotPoint,
  stepDiveLaunching,
  stepSwarm,
  waveBulletScale,
  waveSpeedScale,
} from "./swarm";
import { liveWave, poseDrone } from "./fixtures";

/** Advance the swarm over `seconds`, in sub-steps of a hundred-and-twentieth. */
function run(
  state: ReturnType<typeof liveWave>,
  seconds: number,
  h = 1 / 120,
): void {
  const steps = Math.round(seconds / h);
  const events = newFrameEvents();
  for (let i = 0; i < steps; i++) {
    state.swayClock += h;
    stepSwarm(state, h, events);
  }
}

describe("the stage's scales", () => {
  it("uses the stage's own scale for a standard wave", () => {
    expect(waveSpeedScale(4)).toBe(droneSpeedScale(4));
    expect(waveBulletScale(4)).toBe(bulletSpeedScale(4));
  });

  it("runs a challenge stage at the stage-1 figures", () => {
    expect(waveSpeedScale(3)).toBe(1);
    expect(waveBulletScale(3)).toBe(1);
  });
});

describe("the formation", () => {
  it("rides one sway offset, the same for every slotted drone", () => {
    const state = liveWave();
    const a = poseDrone(state, "shard", 400, 200);
    const b = poseDrone(state, "shard", 600, 200);
    a.slotX = 400;
    b.slotX = 600;
    state.swayClock = 1.1;

    const offset = swayOffset(1.1);
    expect(slotPoint(a, state.swayClock).x).toBeCloseTo(400 + offset, 10);
    expect(slotPoint(b, state.swayClock).x).toBeCloseTo(600 + offset, 10);
    expect(Math.abs(offset)).toBeLessThanOrEqual(SWAY_AMP);
  });

  it("carries a slotted drone with the block", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 400, 200);
    run(state, 0.5);
    expect(drone.x).toBeCloseTo(400 + swayOffset(state.swayClock), 6);
    expect(drone.y).toBe(200);
  });
});

describe("a Flux's rhythm", () => {
  it("runs the band clock forward and flips at the end of the window", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 400, 200, "cyan");
    flux.travel = false;

    run(state, fluxHold(1) + 0.1);
    expect(flux.band).toBe("cyan");
    expect(flux.bandClock).toBeGreaterThanOrEqual(fluxHold(1));

    run(state, fluxWindow(1));
    expect(flux.band).toBe("magenta");
  });

  it("returns to the same band after a full cycle, held exactly where it was put", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 400, 200, "cyan");
    flux.travel = false;
    flux.bandClock = 0;

    // A window's own step is dropped as the band flips, so a cycle takes a
    // little over two windows however finely it is divided.
    run(state, 2 * fluxWindow(1) + 0.1);
    expect(flux.band).toBe("cyan");
    expect(flux.x).toBe(400);
    expect(flux.y).toBe(200);
  });

  it("holds its band indefinitely with its oscillation off", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 400, 200, "cyan");
    flux.travel = false;
    flux.oscillation = false;
    run(state, 10);
    expect(flux.band).toBe("cyan");
    expect(flux.bandClock).toBe(0);
  });

  it("moves no band clock on a Shard or a Prism", () => {
    const state = liveWave();
    const shard = poseDrone(state, "shard", 400, 200);
    const prism = poseDrone(state, "prism", 600, 200);
    run(state, 5);
    expect(shard.bandClock).toBe(0);
    expect(prism.bandClock).toBe(0);
  });
});

describe("travel", () => {
  it("holds a drone's exact centre and keeps its phase with travel off", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 300, 250);
    drone.phase = "diving";
    drone.travel = false;
    run(state, 2);
    expect(drone.x).toBe(300);
    expect(drone.y).toBe(250);
    expect(drone.phase).toBe("diving");
  });

  it("leaves the band clock and the cannon running with travel off", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 640, DIVE_FIRE_Y + 20, "cyan");
    flux.phase = "diving";
    flux.travel = false;

    run(state, fluxHold(1) + 0.05);
    // The body has not moved, the phase stands, the clock has run, and the shot
    // it owed the line it was placed past has been taken.
    expect(flux.x).toBe(640);
    expect(flux.y).toBe(DIVE_FIRE_Y + 20);
    expect(flux.phase).toBe("diving");
    expect(flux.bandClock).toBeGreaterThan(0);
    expect(state.bullets).toHaveLength(1);
  });

  it("flies an entrance in at its own speed and settles into formation", () => {
    const state = liveWave();
    state.waveEntry = true;
    const drone = poseDrone(state, "shard", 500, FIELD_TOP - 40);
    drone.phase = "entering";
    drone.slotX = 500;
    drone.slotY = 200;

    run(state, 1);
    expect(drone.y).toBeGreaterThan(FIELD_TOP);
    run(state, 5);
    expect(drone.phase).toBe("formation");
  });

  it("travels an entrance's path at ENTER_SPEED", () => {
    const state = liveWave();
    state.waveEntry = true;
    const drone = poseDrone(state, "shard", 640, FIELD_TOP - 20);
    drone.phase = "entering";
    drone.slotX = 640;
    drone.slotY = 600;

    let travelled = 0;
    let x = drone.x;
    let y = drone.y;
    const h = 1 / 120;
    const events = newFrameEvents();
    for (let i = 0; i < 60; i++) {
      stepSwarm(state, h, events);
      travelled += Math.hypot(drone.x - x, drone.y - y);
      x = drone.x;
      y = drone.y;
    }
    expect(travelled).toBeCloseTo(ENTER_SPEED * 0.5, 1);
  });

  it("travels a dive's path at DIVE_SPEED", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, 150);
    drone.phase = "diving";
    drone.fire = false;

    let travelled = 0;
    let x = drone.x;
    let y = drone.y;
    const h = 1 / 120;
    const events = newFrameEvents();
    for (let i = 0; i < 60; i++) {
      stepSwarm(state, h, events);
      travelled += Math.hypot(drone.x - x, drone.y - y);
      x = drone.x;
      y = drone.y;
    }
    expect(travelled).toBeCloseTo(DIVE_SPEED * 0.5, 1);
  });

  it("ends a dive and brings the drone home to its slot", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, 150);
    drone.slotX = 500;
    drone.slotY = 180;
    drone.phase = "diving";
    drone.fire = false;

    run(state, 12);
    expect(drone.phase).toBe("formation");
    expect(drone.x).toBeCloseTo(500 + swayOffset(state.swayClock), 6);
    expect(drone.y).toBeCloseTo(180, 6);
  });

  it("holds an unreleased drone at its starting point", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 500, FIELD_TOP - 40);
    drone.phase = "entering";
    drone.entryGroup = 2;
    state.waveEntry = true;
    state.entryClock = 0;

    run(state, 0.2);
    expect(drone.y).toBe(FIELD_TOP - 40);

    state.entryClock = ENTER_GROUP_GAP * 2;
    run(state, 0.2);
    expect(drone.y).toBeGreaterThan(FIELD_TOP - 40);
  });
});

describe("a challenge stage's flyover", () => {
  it("sweeps a group across the field and off it, settling into no slot", () => {
    const state = liveWave();
    state.stage = 3;
    state.waveEntry = true;
    const drone = poseDrone(state, "shard", -48, 200);
    drone.phase = "entering";
    drone.slotX = -48;
    drone.slotY = 200;

    run(state, 1);
    expect(drone.phase).toBe("entering");
    expect(drone.x).toBeGreaterThan(-48);

    // It leaves the field within eight seconds of its release, and one that has
    // left is removed.
    run(state, 8);
    expect(state.drones).toHaveLength(0);
  });

  it("sweeps a group entering from the right leftwards", () => {
    const state = liveWave();
    state.stage = 3;
    state.waveEntry = true;
    const drone = poseDrone(state, "shard", 1328, 200);
    drone.phase = "entering";
    drone.slotX = 1328;
    drone.slotY = 200;

    run(state, 1);
    expect(drone.x).toBeLessThan(1328);
  });
});

describe("enemy fire", () => {
  it("takes one shot for a Shard, at the line it first crosses", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, DIVE_FIRE_Y - 30, "magenta");
    drone.phase = "diving";

    run(state, 0.05);
    expect(state.bullets).toHaveLength(0);
    run(state, 1.5);
    expect(state.bullets).toHaveLength(1);
    expect(state.bullets[0]?.band).toBe("magenta");
    expect(state.bullets[0]?.friendly).toBe(false);
    expect(state.bullets[0]?.vy).toBeCloseTo(
      ENEMY_BULLET_SPEED * bulletSpeedScale(1),
      6,
    );
    run(state, 3);
    expect(state.bullets).toHaveLength(1);
  });

  it("takes two shots for a Prism, one of each band, fired together", () => {
    const state = liveWave();
    const drone = poseDrone(state, "prism", 640, DIVE_FIRE_Y - 20, "cyan");
    drone.phase = "diving";

    run(state, 1.2);
    expect(state.bullets).toHaveLength(2);
    expect(new Set(state.bullets.map((b) => b.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
  });

  it("fires nothing while a Flux shimmers, and shoots once it settles", () => {
    const state = liveWave();
    const drone = poseDrone(state, "flux", 640, DIVE_FIRE_Y + 10, "cyan");
    drone.phase = "diving";
    drone.travel = false;
    drone.bandClock = fluxHold(1);

    run(state, 0.1);
    expect(state.bullets).toHaveLength(0);

    run(state, fluxWindow(1));
    expect(state.bullets).toHaveLength(1);
  });

  it("fires nothing at all with its fire gate off", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, DIVE_FIRE_Y + 10);
    drone.phase = "diving";
    drone.fire = false;
    run(state, 3);
    expect(state.bullets).toHaveLength(0);
  });

  it("fires nothing from a drone that is not diving", () => {
    const state = liveWave();
    for (const phase of ["entering", "formation", "returning"] as const) {
      state.drones = [];
      const drone = poseDrone(state, "shard", 640, DIVE_FIRE_Y + 10);
      drone.phase = phase;
      drone.slotX = 640;
      drone.slotY = DIVE_FIRE_Y + 10;
      run(state, 2);
      expect(state.bullets).toHaveLength(0);
    }
  });

  it("puts no enemy bullet on a challenge stage", () => {
    const state = liveWave();
    state.stage = 3;
    const drone = poseDrone(state, "shard", 640, DIVE_FIRE_Y + 10);
    drone.phase = "diving";
    run(state, 2);
    expect(state.bullets).toHaveLength(0);
  });
});

describe("a diving Prism", () => {
  it("inverts the field at its line and turns for home, unharmed", () => {
    const state = liveWave();
    const drone = poseDrone(state, "prism", 640, PRISM_INVERT_Y - 30, "cyan");
    drone.phase = "diving";
    drone.fire = false;
    drone.slotX = 640;
    drone.slotY = 180;

    const events = newFrameEvents();
    const h = 1 / 120;
    for (let i = 0; i < 120; i++) stepSwarm(state, h, events);

    expect(state.inversion).toBeCloseTo(INVERSION_TIME, 6);
    expect([...events.cues]).toContain("inversion");
    expect(drone.phase).toBe("returning");
    expect(state.drones).toHaveLength(1);
    expect(drone.shellAlive).toBe(true);
  });
});

describe("the wave's dive launching", () => {
  it("launches its first dive when the clock reaches DIVE_FIRST_DELAY", () => {
    const state = liveWave();
    poseDrone(state, "shard", 400, 200);
    state.diveLaunching = true;
    state.diveClock = 0;
    state.diveTarget = DIVE_FIRST_DELAY;

    stepDiveLaunching(state, DIVE_FIRST_DELAY - 0.01);
    expect(state.drones[0]?.phase).toBe("formation");

    stepDiveLaunching(state, 0.02);
    expect(state.drones[0]?.phase).toBe("diving");
    expect(state.diveClock).toBe(0);
  });

  it("draws each later gap between the two figures, scaled for the stage", () => {
    const state = liveWave();
    state.stage = 5;
    poseDrone(state, "shard", 400, 200);
    poseDrone(state, "shard", 500, 200);
    state.diveLaunching = true;
    stepDiveLaunching(state, DIVE_FIRST_DELAY);

    const scale = diveGapScale(5);
    expect(state.diveTarget).toBeGreaterThanOrEqual(DIVE_GAP_MIN * scale);
    expect(state.diveTarget).toBeLessThanOrEqual(DIVE_GAP_MAX * scale);
  });

  it("advances no clock and launches nothing with its gate off", () => {
    const state = liveWave();
    poseDrone(state, "shard", 400, 200);
    state.diveLaunching = false;
    stepDiveLaunching(state, 10);
    expect(state.diveClock).toBe(0);
    expect(state.drones[0]?.phase).toBe("formation");
  });

  it("takes only a drone resting in the formation", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 400, 200);
    drone.phase = "entering";
    state.diveLaunching = true;
    stepDiveLaunching(state, DIVE_FIRST_DELAY + 1);
    expect(drone.phase).toBe("entering");
  });
});
