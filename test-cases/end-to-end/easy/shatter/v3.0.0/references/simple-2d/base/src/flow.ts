// Shatter — the run and the screens it moves between (`specs/progression.md`,
// `specs/ui.md`).
//
// Everything that changes which screen is showing lives here, so the menus, the
// life-loss path and the debug surface's `reset` all take the same routes. Two
// rules in this file are worth naming:
//
//   * A NEW GAME is a clean field, wherever it was started from — the title,
//     RESTART on the pause menu, or PLAY AGAIN after a loss. It clears the
//     rocks, the rounds of both guns and the saucer, puts three ships back, and
//     starts the saucer cadence over at the beginning of a game. A restart that
//     rebuilt the world but left the saucer flying would hand a fresh wave 1 an
//     enemy already firing.
//   * A ship is lost by the three lethal contacts and by nothing else. The
//     core costs nothing.

import {
  FACE_UP,
  CUES,
  DEFAULT_SEED,
  GAMEOVER_ITEMS,
  INVULN_TIME,
  PAUSE_ITEMS,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { placeShipAtSafePoint } from "./ship";
import { spawnWave } from "./waves";
import type { Screen, ShatterState } from "./game";
import type { Sim, TickEvents } from "./sim";

/** The state a fresh build opens on: the title screen, with nothing on the field. */
export function openingState(): ShatterState {
  return {
    screen: "title",
    menuIndex: 0,

    score: 0,
    lives: START_LIVES,
    wave: 0,
    waveBanner: 0,

    ship: {
      x: SAFE_X,
      y: SAFE_Y,
      vx: 0,
      vy: 0,
      angle: FACE_UP,
      thrusting: false,
      invuln: 0,
      collision: true,
      fireCooldown: 0,
    },
    bullets: [],
    rocks: [],
    saucer: null,
    enemyBullets: [],

    waveSpawning: true,
    saucerSpawning: true,
    saucerClock: 0,
    saucerDue: SAUCER_FIRST_DELAY,

    tickClock: 0,
    nextId: 1,
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,

    extraLifeNotice: 0,
    pointerPresses: [],
  };
}

/**
 * Every declared field back to its title-screen value, seeded afresh.
 *
 * `muted` is deliberately untouched: muting is the runtime's, and a player who
 * silenced the game does not expect a reset to turn the sound back on.
 */
export function resetToTitle(sim: Sim, seed: number): void {
  const opening = openingState();

  sim.screen = opening.screen;
  sim.menuIndex = opening.menuIndex;
  sim.score = opening.score;
  sim.lives = opening.lives;
  sim.wave = opening.wave;
  sim.waveBanner = opening.waveBanner;

  sim.ship = { ...opening.ship };
  sim.bullets = [];
  sim.rocks = [];
  sim.saucer = null;
  sim.enemyBullets = [];

  sim.waveSpawning = true;
  sim.saucerSpawning = true;
  sim.saucerClock = 0;
  sim.saucerDue = SAUCER_FIRST_DELAY;

  sim.tickClock = 0;
  sim.nextId = 1;
  sim.simTime = 0;
  sim.rngState = seed;
  sim.extraLifeNotice = 0;
  sim.pointerPresses = [];
}

/** Open a new game: a clean field, three ships, and wave 1. */
export function startRun(sim: Sim): void {
  sim.score = 0;
  sim.lives = START_LIVES;
  sim.wave = 1;
  sim.waveBanner = 0;

  sim.bullets = [];
  sim.rocks = [];
  sim.enemyBullets = [];
  sim.saucer = null;
  sim.extraLifeNotice = 0;

  sim.saucerClock = 0;
  sim.saucerDue = SAUCER_FIRST_DELAY;

  placeShipAtSafePoint(sim.ship);
  sim.ship.invuln = 0;

  sim.screen = "playing";
  sim.menuIndex = 0;

  if (sim.waveSpawning) spawnWave(sim, sim.wave);
}

/** Move to a screen, with its menu highlighted at the first entry. */
export function goTo(sim: Sim, screen: Screen): void {
  sim.screen = screen;
  sim.menuIndex = 0;
}

/**
 * A ship is lost.
 *
 * The next ship appears at rest at the safe point facing up, inside a window of
 * respawn grace it is fully controllable through; when the last one is lost the
 * count reaches zero, no ship appears, and the game is over.
 */
export function loseShip(sim: Sim, ev: TickEvents): void {
  sim.lives -= 1;
  ev.cues.add(CUES.death);

  if (sim.lives > 0) {
    placeShipAtSafePoint(sim.ship);
    sim.ship.invuln = INVULN_TIME;
    return;
  }

  sim.lives = 0;
  sim.ship.invuln = 0;
  goTo(sim, "gameover");
}

/** The entries of whatever vertical menu a screen shows, or `null` for none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return null;
  }
}
