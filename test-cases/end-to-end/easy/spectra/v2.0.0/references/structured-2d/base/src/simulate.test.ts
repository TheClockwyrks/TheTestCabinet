// How a frame advances the game: the sub-steps, the order a sub-step resolves
// in, and every contact the field decides.

import { describe, expect, it } from "vitest";
import {
  BURST_DURATION,
  DISCHARGE_TIME,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  PLAYER_BULLET_SPEED,
  PRISM_HALF,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  SHIP_Y,
  START_LIVES,
  STAGE_CLEARED_HOLD,
  SUBSTEP_MAX,
  fluxHold,
} from "./constants";
import { newFrameEvents } from "./events";
import { droneHalf, droneSize, stepFrame } from "./simulate";
import { IDLE_INPUT, type FrameInput } from "./input";
import {
  liveWave,
  poseDrone,
  poseEnemyBullet,
  posePlayerBullet,
} from "./fixtures";
import type { SpectraState } from "./game";

/** Advance `seconds` of game time as `frames` whole frames. */
function advance(
  state: SpectraState,
  seconds: number,
  frames = Math.max(1, Math.round(seconds * 60)),
  input: FrameInput = IDLE_INPUT,
): ReturnType<typeof newFrameEvents> {
  const events = newFrameEvents();
  for (let i = 0; i < frames; i++)
    stepFrame(state, input, seconds / frames, events);
  return events;
}

describe("the sub-steps", () => {
  it("covers the same ground however a second was divided into frames", () => {
    const runs = [1, 60, 120].map((frames) => {
      const state = liveWave();
      state.ship.x = 300;
      posePlayerBullet(state, 200, 600, "cyan");
      poseEnemyBullet(state, 900, 100, "magenta");
      const drone = poseDrone(state, "shard", 700, 150);
      drone.phase = "diving";
      drone.fire = false;
      advance(state, 1, frames);
      return JSON.stringify({
        simTime: state.simTime,
        drones: state.drones,
        bullets: state.bullets,
        swayClock: state.swayClock,
      });
    });
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
  });

  it("adds exactly the time it covered to simTime, on any screen", () => {
    for (const screen of ["title", "inWave", "paused", "gameOver"] as const) {
      const state = liveWave();
      state.screen = screen;
      advance(state, 2, 37);
      expect(state.simTime).toBeCloseTo(2, 9);
    }
  });

  it("divides a frame into whole sub-steps of at most SUBSTEP_MAX", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, 100);
    drone.phase = "diving";
    drone.fire = false;
    // One frame worth eight sub-steps at the cap, and the same interval as
    // eight frames of one sub-step each, reach the same place.
    advance(state, 8 * SUBSTEP_MAX, 1);
    const once = { x: drone.x, y: drone.y };

    const other = liveWave();
    const twin = poseDrone(other, "shard", 640, 100);
    twin.phase = "diving";
    twin.fire = false;
    advance(other, 8 * SUBSTEP_MAX, 8);
    expect(twin.x).toBeCloseTo(once.x, 9);
    expect(twin.y).toBeCloseTo(once.y, 9);
  });

  it("acts an edge exactly once however finely the frame was divided", () => {
    const state = liveWave();
    const flipped: FrameInput = { ...IDLE_INPUT, flip: true };
    stepFrame(state, flipped, 1, newFrameEvents());
    expect(state.ship.band).toBe("magenta");
  });
});

describe("the contact model", () => {
  it("takes each kind's own half-extent, and a Prism's by its layer", () => {
    expect(droneHalf({ kind: "shard", shellAlive: true })).toBeGreaterThan(0);
    expect(droneHalf({ kind: "prism", shellAlive: true })).toBe(PRISM_HALF);
    expect(droneHalf({ kind: "prism", shellAlive: false })).toBeLessThan(
      PRISM_HALF,
    );
    expect(droneSize({ kind: "prism", shellAlive: false })).toBeLessThan(
      droneSize({ kind: "prism", shellAlive: true }),
    );
  });
});

describe("a player's bullet against a drone", () => {
  it("destroys a matching drone, consumes the bullet, and pays both", () => {
    const state = liveWave();
    // A bystander, so the wave is not emptied and the stage does not clear.
    poseDrone(state, "shard", 200, 200, "magenta").travel = false;
    poseDrone(state, "shard", 640, 300, "cyan");
    posePlayerBullet(state, 640, 305, "cyan");

    const events = advance(state, 1 / 60);
    expect(state.drones).toHaveLength(1);
    expect(state.bullets).toHaveLength(0);
    expect(state.score).toBe(SCORE_SHARD_FORM);
    expect(state.resonance).toBe(RESONANCE_KILL);
    expect(state.bursts).toHaveLength(1);
    expect([...events.cues]).toContain("kill");
  });

  it("destroys nothing on a mismatch, and is consumed all the same", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 640, 300, "magenta");
    posePlayerBullet(state, 640, 305, "cyan");

    advance(state, 1 / 60);
    expect(state.drones).toHaveLength(1);
    expect(state.bullets).toHaveLength(0);
    expect(state.score).toBe(0);
    expect(state.resonance).toBe(0);
    expect(state.bursts).toHaveLength(0);
    // The drone is left exactly as it was.
    expect(drone.band).toBe("magenta");
    expect(drone.phase).toBe("formation");
    expect(drone.shellAlive).toBe(true);
  });

  it("destroys no shimmering Flux, of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const state = liveWave();
      const flux = poseDrone(state, "flux", 640, 300, "cyan");
      flux.oscillation = false;
      flux.bandClock = fluxHold(1);
      posePlayerBullet(state, 640, 305, band);
      advance(state, 1 / 60);
      expect(state.drones).toHaveLength(1);
      expect(state.bullets).toHaveLength(0);
    }
  });

  it("breaks a Prism's shell, then destroys its core, paying each", () => {
    const state = liveWave();
    // A bystander, so the wave is not emptied and the stage does not clear.
    poseDrone(state, "shard", 200, 200, "magenta").travel = false;
    const prism = poseDrone(state, "prism", 640, 300, "cyan");
    prism.travel = false;
    posePlayerBullet(state, 640, 305, "cyan");
    advance(state, 1 / 60);

    expect(state.drones).toHaveLength(2);
    expect(prism.shellAlive).toBe(false);
    expect(state.score).toBe(SCORE_PRISM_SHELL);
    // A shell adds nothing to the meter.
    expect(state.resonance).toBe(0);
    const id = prism.id;

    posePlayerBullet(state, 640, 302, "magenta");
    advance(state, 1 / 60);
    expect(state.drones).toHaveLength(1);
    expect(state.score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    expect(state.resonance).toBe(RESONANCE_KILL);
    // The Prism kept its id for its whole life.
    expect(id).toBe(prism.id);
  });

  it("is removed when it climbs off the top of the field", () => {
    const state = liveWave();
    posePlayerBullet(state, 640, FIELD_TOP + 10, "cyan");
    advance(state, 0.2);
    expect(state.bullets).toHaveLength(0);
  });

  it("travels straight up at its own speed", () => {
    const state = liveWave();
    const bullet = posePlayerBullet(state, 640, 600, "cyan");
    advance(state, 0.25);
    expect(bullet.y).toBeCloseTo(600 - PLAYER_BULLET_SPEED * 0.25, 6);
    expect(bullet.x).toBe(640);
  });
});

describe("an enemy bullet against the ship", () => {
  it("is absorbed on the ship's own band and fills the meter", () => {
    const state = liveWave();
    state.ship.contact = true;
    state.ship.x = 640;
    state.ship.band = "cyan";
    poseEnemyBullet(state, 640, SHIP_Y - 5, "cyan");

    const events = advance(state, 1 / 60);
    expect(state.bullets).toHaveLength(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.resonance).toBe(RESONANCE_ABSORB);
    expect([...events.cues]).toContain("absorb");
  });

  it("costs a life on the opposite band", () => {
    const state = liveWave();
    state.ship.contact = true;
    poseEnemyBullet(state, 640, SHIP_Y - 5, "magenta");
    advance(state, 1 / 60);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.phase).toBe("ready");
    // The hold opened this frame, so what is left of it is the whole hold less
    // whatever the rest of this frame spent.
    expect(state.phaseTimer).toBeGreaterThan(READY_HOLD - 1 / 60 - 1e-9);
    expect(state.phaseTimer).toBeLessThanOrEqual(READY_HOLD);
  });

  it("costs nothing at all with the ship's contact gate off", () => {
    const state = liveWave();
    poseEnemyBullet(state, 640, SHIP_Y - 5, "magenta");
    advance(state, 0.2);
    expect(state.lives).toBe(START_LIVES);
    expect(state.phase).toBe("live");
  });

  it("is removed when it falls off the bottom of the field", () => {
    const state = liveWave();
    poseEnemyBullet(
      state,
      640,
      FIELD_BOTTOM - 5,
      "magenta",
      ENEMY_BULLET_SPEED,
    );
    advance(state, 0.2);
    expect(state.bullets).toHaveLength(0);
  });
});

describe("a drone's body against the ship", () => {
  it("costs a life whatever band it carries, and whatever the ship holds", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const state = liveWave();
      state.ship.contact = true;
      const drone = poseDrone(state, "shard", 640, SHIP_Y, band);
      drone.travel = false;
      advance(state, 1 / 60);
      expect(state.lives).toBe(START_LIVES - 1);
    }
  });

  it("costs nothing in a challenge stage", () => {
    const state = liveWave();
    state.stage = 3;
    state.ship.contact = true;
    const drone = poseDrone(state, "shard", 640, SHIP_Y);
    drone.travel = false;
    advance(state, 0.2);
    expect(state.lives).toBe(START_LIVES);
  });

  it("costs exactly one life whatever else is on the field", () => {
    const state = liveWave();
    state.ship.contact = true;
    for (let i = 0; i < 4; i++) {
      const drone = poseDrone(state, "shard", 640, SHIP_Y);
      drone.travel = false;
    }
    poseEnemyBullet(state, 640, SHIP_Y, "magenta");
    advance(state, 1 / 60);
    expect(state.lives).toBe(START_LIVES - 1);
  });
});

describe("the discharge wave", () => {
  it("takes every drone out of the formation and every enemy bullet, band-blind", () => {
    const state = liveWave();
    state.resonance = RESONANCE_MAX;
    state.ship.x = 640;

    const resting = poseDrone(state, "shard", 400, 200, "magenta");
    resting.travel = false;
    const diving = poseDrone(state, "shard", 700, 400, "magenta");
    diving.phase = "diving";
    diving.travel = false;
    diving.fire = false;
    const prism = poseDrone(state, "prism", 800, 400, "cyan");
    prism.phase = "entering";
    prism.travel = false;
    poseEnemyBullet(state, 500, 500, "cyan");
    const mine = posePlayerBullet(state, 600, 500, "cyan");
    mine.vy = 0;

    const events = advance(state, DISCHARGE_TIME, 30, {
      ...IDLE_INPUT,
      discharge: true,
    });

    expect(state.resonance).toBe(0);
    expect([...events.cues]).toContain("discharge");
    const left = state.drones.map((drone) => drone.id);
    expect(left).toEqual([resting.id]);
    expect(state.bullets.map((bullet) => bullet.id)).toEqual([mine.id]);
    // A Prism the wave reaches pays its shell and its core together.
    expect(state.score).toBeGreaterThanOrEqual(
      SCORE_PRISM_SHELL + SCORE_PRISM_CORE,
    );
  });

  it("does nothing below full", () => {
    const state = liveWave();
    state.resonance = RESONANCE_MAX - 1;
    const drone = poseDrone(state, "shard", 640, 400);
    drone.phase = "diving";
    drone.travel = false;
    drone.fire = false;
    advance(state, 0.2, 12, { ...IDLE_INPUT, discharge: true });
    expect(state.drones).toHaveLength(1);
    expect(state.discharge.active).toBe(false);
    expect(state.resonance).toBe(RESONANCE_MAX - 1);
  });
});

describe("a stage clearing", () => {
  it("clears in the moment the last drone of its wave is destroyed", () => {
    const state = liveWave();
    poseDrone(state, "shard", 640, 300, "cyan");
    posePlayerBullet(state, 640, 305, "cyan");
    advance(state, 1 / 60);
    expect(state.screen).toBe("stageCleared");
    expect(state.score).toBe(SCORE_SHARD_FORM + SCORE_STAGE_CLEAR);
    expect(state.phaseTimer).toBeGreaterThan(
      STAGE_CLEARED_HOLD - 1 / 60 - 1e-9,
    );
    expect(state.phaseTimer).toBeLessThanOrEqual(STAGE_CLEARED_HOLD);
  });

  it("is being played rather than cleared while its wave never held a drone", () => {
    const state = liveWave();
    advance(state, 3);
    expect(state.screen).toBe("inWave");
    expect(state.score).toBe(0);
  });
});

describe("the screens a sub-step advances", () => {
  it("opens the live wave as the stage intro's hold gives way", () => {
    const state = liveWave();
    state.screen = "stageIntro";
    state.phaseTimer = 0.2;
    advance(state, 0.3);
    expect(state.screen).toBe("inWave");
    expect(state.drones.length).toBeGreaterThan(0);
  });

  it("opens the next stage as the interstitial gives way", () => {
    const state = liveWave();
    state.screen = "stageCleared";
    state.phaseTimer = 0.2;
    advance(state, 0.3);
    expect(state.screen).toBe("stageIntro");
    expect(state.stage).toBe(2);
  });

  it("returns to the live phase as the ready hold gives way", () => {
    const state = liveWave();
    state.phase = "ready";
    state.phaseTimer = 0.2;
    state.ship.x = 100;
    advance(state, 0.3);
    expect(state.phase).toBe("live");
    expect(state.ship.x).toBe(640);
  });

  it("freezes the field entirely while the game is paused", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 400, 200);
    drone.phase = "diving";
    const bullet = posePlayerBullet(state, 500, 400, "cyan");
    state.screen = "paused";
    state.phaseTimer = 1;
    state.swayClock = 0;
    state.diveClock = 0;

    const events = advance(state, 1);
    expect(drone.x).toBe(400);
    expect(drone.y).toBe(200);
    expect(bullet.y).toBe(400);
    expect(state.phaseTimer).toBe(1);
    expect(state.swayClock).toBe(0);
    expect(state.diveClock).toBe(0);
    expect(events.cues.size).toBe(0);
  });

  it("takes the pause and returns from it with the field as it was", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 400, 200);
    drone.travel = false;
    stepFrame(state, { ...IDLE_INPUT, pause: true }, 1 / 60, newFrameEvents());
    expect(state.screen).toBe("paused");

    stepFrame(state, { ...IDLE_INPUT, pause: true }, 1 / 60, newFrameEvents());
    expect(state.screen).toBe("inWave");
    expect(state.drones).toHaveLength(1);
    expect(drone.x).toBe(400);
  });

  it("leaves the title on the mode entry and the how-to on back", () => {
    const state = liveWave();
    state.screen = "title";
    state.menuIndex = 0;
    stepFrame(
      state,
      { ...IDLE_INPUT, confirm: true },
      1 / 60,
      newFrameEvents(),
    );
    expect(state.screen).toBe("stageIntro");

    state.screen = "title";
    state.menuIndex = 1;
    stepFrame(
      state,
      { ...IDLE_INPUT, confirm: true },
      1 / 60,
      newFrameEvents(),
    );
    expect(state.screen).toBe("howto");

    stepFrame(state, { ...IDLE_INPUT, back: true }, 1 / 60, newFrameEvents());
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });

  it("wraps a menu's highlight at both ends and plays the cue", () => {
    const state = liveWave();
    state.screen = "title";
    state.menuIndex = 0;
    const up = advance(state, 1 / 60, 1, { ...IDLE_INPUT, menuUp: true });
    expect(state.menuIndex).toBe(1);
    expect([...up.cues]).toContain("menu");
    advance(state, 1 / 60, 1, { ...IDLE_INPUT, menuDown: true });
    expect(state.menuIndex).toBe(0);
  });

  it("plays again and quits to the menu from game over", () => {
    const state = liveWave();
    state.screen = "gameOver";
    state.menuIndex = 0;
    advance(state, 1 / 60, 1, { ...IDLE_INPUT, confirm: true });
    expect(state.screen).toBe("stageIntro");

    state.screen = "gameOver";
    state.menuIndex = 1;
    advance(state, 1 / 60, 1, { ...IDLE_INPUT, confirm: true });
    expect(state.screen).toBe("title");
  });

  it("restarts and quits from the pause menu", () => {
    const state = liveWave();
    state.screen = "paused";
    state.menuIndex = 1;
    advance(state, 1 / 60, 1, { ...IDLE_INPUT, confirm: true });
    expect(state.screen).toBe("stageIntro");

    state.screen = "paused";
    state.menuIndex = 2;
    advance(state, 1 / 60, 1, { ...IDLE_INPUT, confirm: true });
    expect(state.screen).toBe("title");
  });
});

describe("the ship under input", () => {
  it("travels while a direction is held and stops when it is released", () => {
    const state = liveWave();
    state.ship.x = 640;
    advance(state, 0.5, 30, { ...IDLE_INPUT, mx: 1 });
    expect(state.ship.x).toBeCloseTo(640 + 360 * 0.5, 4);
    const held = state.ship.x;
    advance(state, 0.5, 30);
    expect(state.ship.x).toBe(held);
  });

  it("fires at the cadence while fire is held", () => {
    const state = liveWave();
    advance(state, 0.5, 30, { ...IDLE_INPUT, fire: true });
    // Three in flight is the cap, so the roster never holds more.
    expect(state.bullets.length).toBeLessThanOrEqual(3);
    expect(state.bullets.length).toBeGreaterThan(0);
  });
});

describe("the bursts a frame starts", () => {
  it("plays one burst per destroyed drone and lets it finish", () => {
    const state = liveWave();
    poseDrone(state, "shard", 640, 300, "cyan");
    posePlayerBullet(state, 640, 305, "cyan");
    advance(state, 1 / 60);
    expect(state.bursts).toHaveLength(1);
    const size = state.bursts[0]?.size;
    expect(size).toBe(droneSize({ kind: "shard", shellAlive: true }));

    advance(state, BURST_DURATION + 0.05);
    expect(state.bursts).toHaveLength(0);
  });
});
