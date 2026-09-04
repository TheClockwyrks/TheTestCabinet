// The run and the screens: the opening state, a new game, a life lost, reset.

import { describe, expect, it } from "vitest";
import {
  FACE_UP,
  GAMEOVER_ITEMS,
  INVULN_TIME,
  PAUSE_ITEMS,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import {
  goTo,
  loseShip,
  menuItems,
  openingState,
  resetToTitle,
  startRun,
} from "./flow";
import { addRock } from "./rocks";
import { addSaucer } from "./saucer";
import { newTickEvents, toSim } from "./sim";

describe("the opening state", () => {
  it("is the title screen with nothing on the field", () => {
    const state = openingState();
    expect(state.screen).toBe("title");
    expect(state.wave).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.rocks).toHaveLength(0);
    expect(state.saucer).toBeNull();
    expect(state.waveSpawning).toBe(true);
    expect(state.saucerSpawning).toBe(true);
    expect(state.ship.collision).toBe(true);
  });
});

describe("a new game", () => {
  it("clears the field, restores three ships, and starts wave one", () => {
    const sim = toSim(openingState());
    sim.score = 900;
    sim.lives = 1;
    addSaucer(sim, 300, 300);
    addRock(sim, "small", 10, 10, 0, 0);
    sim.enemyBullets.push({ id: 99, x: 0, y: 0, vx: 0, vy: 0, life: 1 });

    startRun(sim);

    expect(sim.screen).toBe("playing");
    expect(sim.score).toBe(0);
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.wave).toBe(1);
    expect(sim.saucer).toBeNull();
    expect(sim.enemyBullets).toHaveLength(0);
    expect(sim.bullets).toHaveLength(0);
    expect(sim.rocks).toHaveLength(4);
    expect(sim.saucerDue).toBe(SAUCER_FIRST_DELAY);
    expect(sim.saucerClock).toBe(0);
    expect(sim.ship.x).toBe(SAFE_X);
    expect(sim.ship.y).toBe(SAFE_Y);
    expect(sim.ship.invuln).toBe(0);
  });

  it("puts no rocks up while the wave loop is held", () => {
    const sim = toSim(openingState());
    sim.waveSpawning = false;
    startRun(sim);
    expect(sim.rocks).toHaveLength(0);
  });
});

describe("losing a ship", () => {
  it("respawns it at rest at the safe point, inside a grace window", () => {
    const sim = toSim(openingState());
    startRun(sim);
    sim.ship.x = 100;
    sim.ship.vx = 500;
    sim.ship.angle = 2;

    const events = newTickEvents();
    loseShip(sim, events);

    expect(sim.lives).toBe(START_LIVES - 1);
    expect(sim.ship.x).toBe(SAFE_X);
    expect(sim.ship.y).toBe(SAFE_Y);
    expect(sim.ship.vx).toBe(0);
    expect(sim.ship.angle).toBe(FACE_UP);
    expect(sim.ship.invuln).toBeCloseTo(INVULN_TIME, 9);
    expect(sim.screen).toBe("playing");
    expect(events.cues.has("death")).toBe(true);
  });

  it("ends the game when the last one goes", () => {
    const sim = toSim(openingState());
    startRun(sim);
    sim.lives = 1;
    loseShip(sim, newTickEvents());
    expect(sim.lives).toBe(0);
    expect(sim.ship.invuln).toBe(0);
    expect(sim.screen).toBe("gameover");
    expect(sim.menuIndex).toBe(0);
  });
});

describe("reset", () => {
  it("restores every declared field and leaves muting alone", () => {
    const sim = toSim(openingState());
    startRun(sim);
    sim.score = 700;
    sim.simTime = 42;
    sim.muted = true;
    sim.waveSpawning = false;
    sim.saucerSpawning = false;
    sim.ship.collision = false;

    resetToTitle(sim, 9);

    expect(sim.screen).toBe("title");
    expect(sim.score).toBe(0);
    expect(sim.wave).toBe(0);
    expect(sim.rocks).toHaveLength(0);
    expect(sim.simTime).toBe(0);
    expect(sim.rngState).toBe(9);
    expect(sim.waveSpawning).toBe(true);
    expect(sim.saucerSpawning).toBe(true);
    expect(sim.ship.collision).toBe(true);
    expect(sim.muted).toBe(true);
  });
});

describe("the menus", () => {
  it("names the entries of each screen that shows one", () => {
    expect(menuItems("title")).toEqual(TITLE_ITEMS);
    expect(menuItems("paused")).toEqual(PAUSE_ITEMS);
    expect(menuItems("gameover")).toEqual(GAMEOVER_ITEMS);
    expect(menuItems("playing")).toBeNull();
    expect(menuItems("howto")).toBeNull();
  });

  it("arrives at a screen with its first entry highlighted", () => {
    const sim = toSim(openingState());
    sim.menuIndex = 2;
    goTo(sim, "title");
    expect(sim.menuIndex).toBe(0);
  });
});
