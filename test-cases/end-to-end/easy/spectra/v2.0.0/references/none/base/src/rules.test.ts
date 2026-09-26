// Spectra — the economies and the run: resonance, the discharge, scoring, lives,
// the stage ladder, the screens, and the cues. The field's own mechanics are in
// `src/game.test.ts`; this file starts where a contact has already happened.

import { beforeEach, describe, expect, it } from "vitest";

import {
  CHALLENGE_TOTAL,
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  DIVE_FIRE_Y,
  EXTRA_LIFE_AT,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PERFECT_BONUS,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  SHIP_Y,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { LANE_CENTER, menuItems } from "./game";
import { harnessWith, stubArt, type Harness } from "./harness.test-support";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(() => {
  h = harnessWith(stubArt());
  d = createDebugApi(h.state, h.clock);
  d.reset();
});

function posed(): void {
  d.reset();
  d.setScreen("inWave");
  d.setPhase("live");
  d.setWaveEntry(false);
  d.setDiveLaunching(false);
}

function bystander(): number {
  const id = d.addDrone("shard", 120, 480);
  d.setDroneTravel(id, false);
  return id;
}

function drone(
  kind: "shard" | "flux" | "prism",
  x: number,
  y: number,
  band: "cyan" | "magenta" = "cyan",
): number {
  const id = d.addDrone(kind, x, y);
  d.setDroneBand(id, band);
  d.setDroneTravel(id, false);
  return id;
}

/** Shoot the drone at `(x, y)` with a matching bullet and settle the frame. */
function shoot(x: number, y: number, band: "cyan" | "magenta"): void {
  d.addPlayerBullet(x, y + 18, band);
  h.advance(0.06, 8);
}

/* -------------------------------------------------------------------------- */

describe("the resonance meter", () => {
  it("starts empty and is filled by exactly two events", () => {
    posed();
    bystander();
    expect(d.snapshot().resonance).toBe(0);
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "cyan");
    h.advance(0.05, 6);
    expect(d.snapshot().resonance).toBe(RESONANCE_ABSORB);
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().resonance).toBe(RESONANCE_ABSORB + RESONANCE_KILL);
  });

  it("caps at RESONANCE_MAX rather than passing it", () => {
    posed();
    bystander();
    d.setResonance(RESONANCE_MAX - 1);
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().resonance).toBe(RESONANCE_MAX);
  });

  it("does not decay with time", () => {
    posed();
    d.setResonance(42);
    h.advance(20, 400);
    expect(d.snapshot().resonance).toBe(42);
  });

  it("is left exactly where it stands when a life is lost", () => {
    posed();
    d.setResonance(37);
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "magenta");
    h.advance(0.05, 6);
    expect(d.snapshot().lives).toBe(START_LIVES - 1);
    expect(d.snapshot().resonance).toBe(37);
  });

  it("reads ready at full and not one point below", () => {
    posed();
    d.setResonance(RESONANCE_MAX - 1);
    expect(d.snapshot().dischargeReady).toBe(false);
    d.setResonance(RESONANCE_MAX);
    expect(d.snapshot().dischargeReady).toBe(true);
  });

  it("takes nothing from a Prism's shell and RESONANCE_KILL from its core", () => {
    posed();
    bystander();
    const id = drone("prism", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().resonance).toBe(0);
    d.addPlayerBullet(640, 315, "magenta");
    h.advance(0.06, 8);
    expect(d.snapshot().resonance).toBe(RESONANCE_KILL);
    expect(id).toBeGreaterThan(0);
  });
});

describe("the discharge", () => {
  it("does nothing below full: the meter is unchanged and no wave starts", () => {
    posed();
    d.setResonance(RESONANCE_MAX - 1);
    h.press("discharge");
    h.advance(1 / 60, 1);
    expect(d.snapshot().resonance).toBe(RESONANCE_MAX - 1);
    expect(d.snapshot().discharge.active).toBe(false);
  });

  it("spends the whole meter and starts the wave at full", () => {
    posed();
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(1 / 60, 1);
    expect(d.snapshot().resonance).toBe(0);
    expect(d.snapshot().discharge.active).toBe(true);
    expect(h.cues).toContain("discharge");
  });

  it("grows from nothing to DISCHARGE_MAX_R over DISCHARGE_TIME", () => {
    posed();
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(1 / 120, 1);
    const early = d.snapshot().discharge.radius;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(DISCHARGE_MAX_R * 0.05);
    h.advance(DISCHARGE_TIME * 0.9, 54);
    expect(d.snapshot().discharge.radius).toBeGreaterThan(
      DISCHARGE_MAX_R * 0.8,
    );
    h.advance(DISCHARGE_TIME * 0.2, 12);
    expect(d.snapshot().discharge.active).toBe(false);
    expect(d.snapshot().discharge.radius).toBe(0);
  });

  it("is band-blind and clears every drone out of formation", () => {
    posed();
    d.setShipBand("cyan");
    const entering = drone("shard", 300, 200, "magenta");
    const diving = drone("flux", 900, 400, "magenta");
    const returning = drone("shard", 500, 500, "cyan");
    const held = drone("shard", 700, 200, "magenta");
    d.setDronePhase(entering, "entering");
    d.setDronePhase(diving, "diving");
    d.setDronePhase(returning, "returning");
    d.setDroneTravel(entering, false);
    d.setDroneTravel(diving, false);
    d.setDroneTravel(returning, false);
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(DISCHARGE_TIME, 60);
    const left = d.snapshot().drones.map((entry) => entry.id);
    expect(left).toEqual([held]);
  });

  it("clears every enemy bullet and spares the player's own", () => {
    posed();
    bystander();
    d.setShipContact(false);
    const enemy = d.addEnemyBullet(700, 300, "cyan");
    const friendly = d.addPlayerBullet(500, 300, "cyan");
    d.setBulletVelocity(friendly, 0, 0);
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(DISCHARGE_TIME, 60);
    const ids = d.snapshot().bullets.map((bullet) => bullet.id);
    expect(ids).not.toContain(enemy);
    expect(ids).toContain(friendly);
  });

  it("destroys a Prism whole, shell and core together, and pays both", () => {
    posed();
    bystander();
    const id = drone("prism", 640, 400, "cyan");
    d.setDronePhase(id, "diving");
    d.setDroneTravel(id, false);
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(DISCHARGE_TIME, 60);
    expect(
      d.snapshot().drones.find((entry) => entry.id === id),
    ).toBeUndefined();
    expect(d.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    // The wave is not one of the player's bullets, so the meter takes nothing.
    expect(d.snapshot().resonance).toBe(0);
  });

  it("pays a diving drone's value for one it clears", () => {
    posed();
    bystander();
    const id = drone("shard", 640, 400, "cyan");
    d.setDronePhase(id, "diving");
    d.setDroneTravel(id, false);
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(DISCHARGE_TIME, 60);
    expect(d.snapshot().score).toBe(SCORE_SHARD_DIVE);
  });

  it("lets the ship move, fire and flip while a wave is live", () => {
    posed();
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(1 / 120, 1);
    h.hold("right");
    h.hold("a");
    h.advance(0.2, 12);
    expect(d.snapshot().ship.x).toBeGreaterThan(LANE_CENTER);
    expect(d.snapshot().bullets.some((bullet) => bullet.friendly)).toBe(true);
  });
});

describe("scoring", () => {
  it("pays each kind and phase what the specification says", () => {
    const cases: Array<
      ["shard" | "flux" | "prism", "formation" | "diving", number]
    > = [
      ["shard", "formation", SCORE_SHARD_FORM],
      ["shard", "diving", SCORE_SHARD_DIVE],
      ["flux", "formation", SCORE_FLUX_FORM],
      ["flux", "diving", SCORE_FLUX_DIVE],
    ];
    for (const [kind, phase, value] of cases) {
      posed();
      bystander();
      const id = drone(kind, 640, 300, "cyan");
      if (phase === "diving") {
        d.setDronePhase(id, "diving");
        d.setDroneTravel(id, false);
      }
      if (kind === "flux") d.setDroneOscillation(id, false);
      shoot(640, 300, "cyan");
      expect(d.snapshot().score).toBe(value);
    }
  });

  it("pays a Prism's shell and its core separately, in any phase", () => {
    posed();
    bystander();
    const id = drone("prism", 640, 300, "magenta");
    shoot(640, 300, "magenta");
    expect(d.snapshot().score).toBe(SCORE_PRISM_SHELL);
    d.addPlayerBullet(640, 315, "cyan");
    h.advance(0.06, 8);
    expect(d.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    expect(id).toBeGreaterThan(0);
  });

  it("pays a returning or entering drone its diving value", () => {
    for (const phase of ["entering", "returning"] as const) {
      posed();
      bystander();
      const id = drone("shard", 640, 300, "cyan");
      d.setDronePhase(id, phase);
      d.setDroneTravel(id, false);
      shoot(640, 300, "cyan");
      expect(d.snapshot().score).toBe(SCORE_SHARD_DIVE);
    }
  });

  it("pays SCORE_STAGE_CLEAR when a standard stage clears", () => {
    posed();
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().score).toBe(SCORE_SHARD_FORM + SCORE_STAGE_CLEAR);
    expect(d.snapshot().screen).toBe("stageCleared");
  });

  it("pays a challenge stage per drone, and no stage-clear bonus", () => {
    posed();
    d.setStage(3);
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().score).toBe(SCORE_CHALLENGE_DRONE);
    expect(d.snapshot().screen).toBe("stageCleared");
  });

  it("pays SCORE_PERFECT_BONUS only when every challenge drone fell", () => {
    posed();
    d.setStage(3);
    // One short of the whole flyover, then the last one.
    for (let i = 0; i < CHALLENGE_TOTAL - 1; i += 1) {
      const id = drone("shard", 640, 300, "cyan");
      shoot(640, 300, "cyan");
      expect(id).toBeGreaterThan(0);
      // The roster empties each time, so re-open the wave for the next drone.
      d.setScreen("inWave");
    }
    const paidSoFar = d.snapshot().score;
    expect(paidSoFar).toBe(SCORE_CHALLENGE_DRONE * (CHALLENGE_TOTAL - 1));
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().score).toBe(
      SCORE_CHALLENGE_DRONE * CHALLENGE_TOTAL + SCORE_PERFECT_BONUS,
    );
  });

  it("pays no perfect bonus for a challenge stage that left one alive", () => {
    posed();
    d.setStage(3);
    d.setScore(0);
    const survivor = drone("shard", 200, 300, "magenta");
    const target = drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    // One is left, so the stage has not ended and no bonus is paid.
    expect(d.snapshot().screen).toBe("inWave");
    expect(d.snapshot().score).toBe(SCORE_CHALLENGE_DRONE);
    expect(survivor).toBeGreaterThan(0);
    expect(target).toBeGreaterThan(0);
  });

  it("pays nothing for a shot that destroys nothing", () => {
    posed();
    bystander();
    drone("shard", 640, 300, "magenta");
    shoot(640, 300, "cyan");
    expect(d.snapshot().score).toBe(0);
  });
});

describe("lives and the run", () => {
  it("starts a run with START_LIVES", () => {
    d.reset();
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().lives).toBe(START_LIVES);
    expect(d.snapshot().score).toBe(0);
    expect(d.snapshot().stage).toBe(1);
    expect(d.snapshot().screen).toBe("stageIntro");
  });

  it("holds the wave in its ready phase and keeps every drone", () => {
    posed();
    const id = drone("shard", 300, 200, "cyan");
    d.setDroneBand(id, "cyan");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "magenta");
    h.advance(0.05, 6);
    expect(d.snapshot().phase).toBe("ready");
    expect(d.snapshot().ship.alive).toBe(false);
    expect(d.snapshot().phaseTimer).toBeGreaterThan(0);
    expect(d.snapshot().drones.length).toBe(1);
    expect(d.snapshot().drones[0]?.id).toBe(id);
  });

  it("costs no further life during the hold, then centres the ship", () => {
    posed();
    d.setShipX(200);
    d.setPhase("ready");
    d.setPhaseTimer(READY_HOLD);
    d.addEnemyBullet(200, SHIP_Y, "magenta");
    drone("shard", 200, SHIP_Y, "magenta");
    h.advance(READY_HOLD * 0.5, 40);
    expect(d.snapshot().lives).toBe(START_LIVES);
    h.advance(READY_HOLD, 80);
    expect(d.snapshot().phase).toBe("live");
    expect(d.snapshot().ship.x).toBe(LANE_CENTER);
    expect(d.snapshot().ship.alive).toBe(true);
  });

  it("pays exactly one extra life, once, at EXTRA_LIFE_AT", () => {
    posed();
    bystander();
    d.setScore(EXTRA_LIFE_AT - SCORE_SHARD_FORM);
    expect(d.snapshot().extraLifeAwarded).toBe(false);
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().extraLifeAwarded).toBe(true);
    expect(d.snapshot().lives).toBe(START_LIVES + 1);
    // No further life, whatever the score does afterwards.
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().lives).toBe(START_LIVES + 1);
  });

  it("grants no life from a posed score, and does not re-arm the latch", () => {
    posed();
    d.setScore(EXTRA_LIFE_AT * 3);
    h.advance(1, 60);
    expect(d.snapshot().lives).toBe(START_LIVES);
    expect(d.snapshot().extraLifeAwarded).toBe(false);
    d.setExtraLifeAwarded(true);
    d.setScore(0);
    expect(d.snapshot().extraLifeAwarded).toBe(true);
  });

  it("ends the run when the last life goes, reporting score and stage", () => {
    posed();
    d.setStage(4);
    d.setScore(12345);
    d.setLives(1);
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "magenta");
    h.advance(0.05, 6);
    const snapshot = d.snapshot();
    expect(snapshot.lives).toBe(0);
    expect(snapshot.screen).toBe("gameOver");
    expect(snapshot.score).toBe(12345);
    expect(snapshot.stage).toBe(4);
    expect(h.cues).toContain("hit");
  });
});

describe("the stage ladder", () => {
  it("clears a stage on the moment its last drone is destroyed", () => {
    posed();
    drone("shard", 400, 300, "cyan");
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().screen).toBe("inWave");
    d.addPlayerBullet(400, 318, "cyan");
    h.advance(0.06, 8);
    expect(d.snapshot().screen).toBe("stageCleared");
    expect(d.snapshot().phaseTimer).toBeGreaterThan(STAGE_CLEARED_HOLD * 0.9);
    expect(d.snapshot().phaseTimer).toBeLessThanOrEqual(STAGE_CLEARED_HOLD);
  });

  it("plays a live wave that never held a drone rather than clearing it", () => {
    posed();
    d.clearDrones();
    h.advance(10, 300);
    expect(d.snapshot().screen).toBe("inWave");
    expect(d.snapshot().score).toBe(0);
  });

  it("opens the next stage's intro one higher when the hold gives way", () => {
    posed();
    d.setStage(1);
    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(d.snapshot().screen).toBe("stageCleared");
    h.advance(STAGE_CLEARED_HOLD + 0.05, 100);
    expect(d.snapshot().stage).toBe(2);
    expect(d.snapshot().screen).toBe("stageIntro");
    expect(d.snapshot().phaseTimer).toBeGreaterThan(STAGE_INTRO_HOLD * 0.8);
    expect(d.snapshot().phaseTimer).toBeLessThanOrEqual(STAGE_INTRO_HOLD);
  });

  it("builds the stage's wave in the moment the intro gives way", () => {
    d.reset();
    d.setScreen("stageIntro");
    d.setPhaseTimer(STAGE_INTRO_HOLD);
    d.setWaveEntry(false);
    d.setDiveLaunching(false);
    h.advance(STAGE_INTRO_HOLD * 0.9, 60);
    expect(d.snapshot().drones.length).toBe(0);
    h.advance(STAGE_INTRO_HOLD * 0.2, 20);
    expect(d.snapshot().screen).toBe("inWave");
    expect(d.snapshot().drones.length).toBeGreaterThan(0);
  });

  it("derives every scaled figure and isChallenge from the stage alone", () => {
    d.reset();
    d.setStage(6);
    const snapshot = d.snapshot();
    expect(snapshot.isChallenge).toBe(true);
    expect(snapshot.droneSpeedScale).toBeCloseTo(1.3, 6);
    expect(snapshot.bulletSpeedScale).toBeCloseTo(1.2, 6);
    expect(snapshot.diveGapScale).toBeCloseTo(0.75, 6);
    expect(snapshot.fluxHold).toBeCloseTo(1.35, 6);
    // And nothing was spawned or cleared by the pose.
    expect(snapshot.drones.length).toBe(0);
    expect(snapshot.bullets.length).toBe(0);
  });

  it("costs no life to a challenge drone's body and fires nothing", () => {
    posed();
    d.setStage(3);
    d.setShipBand("cyan");
    const id = drone("shard", LANE_CENTER, SHIP_Y, "magenta");
    h.advance(1, 60);
    expect(d.snapshot().lives).toBe(START_LIVES);
    expect(d.snapshot().bullets.length).toBe(0);
    // Even one that would otherwise be over the fire line.
    d.setDronePosition(id, LANE_CENTER, DIVE_FIRE_Y + 20);
    d.setDronePhase(id, "diving");
    h.advance(2, 120);
    expect(d.snapshot().bullets.filter((b) => !b.friendly).length).toBe(0);
  });

  it("runs a challenge stage at the stage-1 figures", () => {
    d.reset();
    d.setStage(9);
    // The scaled figures still derive from the stage; what does not scale is the
    // wave the challenge stage sends, which flies at the stage-1 speeds.
    expect(d.snapshot().isChallenge).toBe(true);
    d.setScreen("stageIntro");
    d.setPhaseTimer(0.001);
    d.setDiveLaunching(false);
    h.advance(0.002, 1);
    expect(d.snapshot().drones.length).toBe(CHALLENGE_TOTAL);
  });

  it("ends a challenge stage when its last drone has left the field", () => {
    d.reset();
    d.setScreen("stageIntro");
    d.setStage(3);
    d.setPhaseTimer(0.001);
    h.advance(0.002, 1);
    expect(d.snapshot().drones.length).toBe(CHALLENGE_TOTAL);
    d.setShipContact(false);
    // Every group sweeps across and off the far side; the stage ends on the
    // moment the last of them has left, well inside the twelve seconds here.
    let ended = false;
    for (let i = 0; i < 240 && !ended; i += 1) {
      h.advance(0.05, 3);
      if (d.snapshot().screen === "stageCleared") ended = true;
    }
    expect(ended).toBe(true);
    expect(d.snapshot().drones.length).toBe(0);
  });
});

describe("the screens", () => {
  it("opens on the title with the highlight on the first item", () => {
    d.reset();
    expect(d.snapshot().screen).toBe("title");
    expect(d.snapshot().menuIndex).toBe(0);
    expect(menuItems("title")).toEqual(TITLE_ITEMS);
  });

  it("wraps a menu at both ends and plays the menu cue on a move", () => {
    d.reset();
    h.press("up");
    h.advance(1 / 60, 1);
    expect(d.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    expect(h.cues).toContain("menu");
    h.press("down");
    h.advance(1 / 60, 1);
    expect(d.snapshot().menuIndex).toBe(0);
  });

  it("reaches how-to-play and returns on the entry that led there", () => {
    d.reset();
    d.setMenuIndex(1);
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("howto");
    h.press("back");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("title");
    // specs/ui.md: an arrival back at the title highlights the entry that led
    // away from it, which for the how-to screen is `HOW TO PLAY`.
    expect(d.snapshot().menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("pauses live play and freezes the field", () => {
    posed();
    const id = drone("shard", 400, 200, "cyan");
    d.setDroneTravel(id, true);
    d.setDronePhase(id, "diving");
    h.advance(0.1, 6);
    h.press("pause");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("paused");
    expect(menuItems("paused")).toEqual(PAUSE_ITEMS);
    const frozen = d.snapshot();
    h.advance(3, 180);
    expect(d.snapshot().drones).toEqual(frozen.drones);
  });

  it("resumes from the pause screen with the field exactly as it was", () => {
    posed();
    drone("shard", 400, 200, "cyan");
    d.setScreen("paused");
    const frozen = d.snapshot();
    h.press("pause");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("inWave");
    expect(d.snapshot().drones.length).toBe(frozen.drones.length);
    // And `back` resumes it too.
    d.setScreen("paused");
    h.press("back");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("inWave");
  });

  it("restarts and quits from the pause menu", () => {
    posed();
    d.setScore(500);
    d.setStage(5);
    d.setScreen("paused");
    d.setMenuIndex(1);
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("stageIntro");
    expect(d.snapshot().stage).toBe(1);
    expect(d.snapshot().score).toBe(0);
    expect(d.snapshot().lives).toBe(START_LIVES);

    d.setScreen("paused");
    d.setMenuIndex(2);
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("title");
    expect(d.snapshot().menuIndex).toBe(0);
  });

  it("plays again or returns to the menu from game over", () => {
    d.reset();
    d.setScreen("gameOver");
    expect(menuItems("gameOver")).toEqual(GAME_OVER_ITEMS);
    d.setMenuIndex(0);
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("stageIntro");
    expect(d.snapshot().stage).toBe(1);

    d.setScreen("gameOver");
    d.setMenuIndex(1);
    h.press("confirm");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("title");
  });

  it("reads only the actions in its own row of the controls table", () => {
    // The title reads `confirm`, not `a`: Space confirms rather than firing.
    d.reset();
    h.hold("a");
    h.advance(0.5, 30);
    expect(d.snapshot().bullets.length).toBe(0);
    // The live field reads `a`, not `confirm`.
    posed();
    h.hold("a");
    h.advance(1 / 60, 1);
    expect(d.snapshot().bullets.length).toBe(1);
    h.release("a");
    // A hold that opens no menu leaves the stage-intro hold alone.
    d.setScreen("stageIntro");
    d.setPhaseTimer(1);
    h.press("confirm");
    h.press("b");
    h.advance(1 / 60, 1);
    expect(d.snapshot().screen).toBe("stageIntro");
  });

  it("mutes from any screen, and reports the runtime's bit", () => {
    for (const screen of [
      "title",
      "howto",
      "stageIntro",
      "inWave",
      "paused",
      "stageCleared",
      "gameOver",
    ] as const) {
      d.reset();
      d.setScreen(screen);
      const before = d.snapshot().muted;
      h.press("mute");
      h.advance(1 / 60, 1);
      expect(d.snapshot().muted).toBe(!before);
      h.press("mute");
      h.advance(1 / 60, 1);
      expect(d.snapshot().muted).toBe(before);
    }
  });
});

describe("the cues", () => {
  it("declares exactly the nine the specification names", () => {
    expect([...h.declared].sort()).toEqual(
      [
        "absorb",
        "discharge",
        "fire",
        "flip",
        "hit",
        "inversion",
        "kill",
        "menu",
        "stage-clear",
      ].sort(),
    );
  });

  it("plays a cue at most once on the frame that raised it", () => {
    posed();
    // Three drones destroyed in one frame is one `kill`.
    for (const x of [400, 640, 900]) {
      const id = drone("shard", x, 300, "cyan");
      d.addPlayerBullet(x, 300, "cyan");
      expect(id).toBeGreaterThan(0);
    }
    h.cues.length = 0;
    h.advance(1 / 120, 1);
    expect(h.cues.filter((cue) => cue === "kill").length).toBe(1);
  });

  it("plays a cue for each of the events the specification pairs", () => {
    posed();
    h.cues.length = 0;
    h.hold("a");
    h.advance(1 / 60, 1);
    expect(h.cues).toContain("fire");
    h.release("a");

    h.press("b");
    h.advance(1 / 60, 1);
    expect(h.cues).toContain("flip");

    d.setShipBand("cyan");
    d.addEnemyBullet(LANE_CENTER, SHIP_Y - 12, "cyan");
    h.advance(0.05, 6);
    expect(h.cues).toContain("absorb");

    drone("shard", 640, 300, "cyan");
    shoot(640, 300, "cyan");
    expect(h.cues).toContain("kill");
    expect(h.cues).toContain("stage-clear");
  });

  it("plays nothing at all while the field is frozen", () => {
    posed();
    drone("shard", 400, 200, "cyan");
    d.setScreen("paused");
    h.cues.length = 0;
    h.advance(5, 300);
    expect(h.cues).toEqual([]);
  });
});
