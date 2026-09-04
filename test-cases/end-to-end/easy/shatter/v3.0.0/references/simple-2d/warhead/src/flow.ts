// Shatter — the screens, the run, and what each menu entry does
// (`specs/ui.md`, `specs/progression.md`).
//
// Three things live here because each of them is about the game as a whole
// rather than about any body on the field:
//
//   * `titleState` — every declared field at its title-screen value. It is what
//     the game opens on and what the debug surface's `reset` restores, so the two
//     can never drift apart. `muted` is the one field it is handed rather than
//     choosing, because muting is the runtime's and a reset leaves it alone.
//   * `startNewGame` — the opening `specs/progression.md` fixes: three ships, no
//     score, wave 1 on a field cleared of everything the previous game left, the
//     ship at the safe point, and the saucer cadence started over. This build
//     takes the first of the two openings the specification allows and puts
//     wave 1's rocks up at once.
//   * `handleScreens` — the press edges each screen answers to. Every edge is
//     read once per frame in `readInput`, so `Escape` arming both `pause` and
//     `back`, and `Space` arming both `a` and `confirm`, costs nothing: the
//     screen simply uses the one that applies to it.

import {
  FACE_UP,
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { spawnWave } from "./rocks";
import type { ShatterState } from "./game";
import type { FrameInput } from "./input";
import type { Sim } from "./sim";

/** Every declared field at its title-screen value, with `muted` as handed in. */
export function titleState(seed: number, muted: boolean): Sim {
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
    torpedoes: [],
    torpedoCharge: 1,

    waveSpawning: true,
    saucerSpawning: true,
    saucerClock: 0,
    saucerDue: SAUCER_FIRST_DELAY,

    tickClock: 0,
    nextId: 1,
    simTime: 0,
    muted,
    rngState: seed | 0,

    trails: [],
    extraLifeFlash: 0,
  };
}

/** The state the game opens on, before any frame has run. */
export function openingState(): ShatterState {
  return titleState(1, false);
}

/**
 * Open a new game: the field cleared, three ships, no score, and wave 1 up.
 *
 * The generator is deliberately NOT reseeded, so a second game in one session
 * draws a different layout, while a session reseeded through `reset({ seed })`
 * and played again reaches exactly the same one.
 */
export function startNewGame(sim: Sim): void {
  sim.screen = "playing";
  sim.menuIndex = 0;

  sim.score = 0;
  sim.lives = START_LIVES;
  sim.wave = 1;
  sim.waveBanner = 0;

  sim.bullets = [];
  sim.rocks = [];
  sim.saucer = null;
  sim.enemyBullets = [];
  sim.torpedoes = [];
  sim.torpedoCharge = 1;
  sim.trails = [];
  sim.extraLifeFlash = 0;

  sim.ship.x = SAFE_X;
  sim.ship.y = SAFE_Y;
  sim.ship.vx = 0;
  sim.ship.vy = 0;
  sim.ship.angle = FACE_UP;
  sim.ship.thrusting = false;
  sim.ship.invuln = 0;
  sim.ship.collision = true;
  sim.ship.fireCooldown = 0;

  sim.saucerClock = 0;
  sim.saucerDue = SAUCER_FIRST_DELAY;

  // The opening wave is the wave loop's own work, so the gate that holds an
  // emptied field empty holds a restarted game's field empty too.
  if (sim.waveSpawning) spawnWave(sim, sim.wave);
}

/** Move a vertical menu's highlight by one, wrapping at both ends. */
function moveMenu(sim: Sim, input: FrameInput, entries: number): void {
  if (input.menuUp) sim.menuIndex = (sim.menuIndex + entries - 1) % entries;
  if (input.menuDown) sim.menuIndex = (sim.menuIndex + 1) % entries;
}

/** Answer this tick's press edges on whichever screen is showing. */
export function handleScreens(sim: Sim, input: FrameInput): void {
  switch (sim.screen) {
    case "title":
      moveMenu(sim, input, TITLE_ITEMS.length);
      if (input.confirm) {
        if (sim.menuIndex === 0) startNewGame(sim);
        else {
          sim.screen = "howto";
          sim.menuIndex = 0;
        }
      }
      return;

    case "howto":
      if (input.back) {
        sim.screen = "title";
        sim.menuIndex = 0;
      }
      return;

    case "playing":
      if (input.pause || input.back) {
        sim.screen = "paused";
        sim.menuIndex = 0;
      }
      return;

    case "paused":
      moveMenu(sim, input, PAUSE_ITEMS.length);
      if (input.confirm) {
        if (sim.menuIndex === 0) {
          sim.screen = "playing";
          sim.menuIndex = 0;
        } else if (sim.menuIndex === 1) {
          startNewGame(sim);
        } else {
          sim.screen = "title";
          sim.menuIndex = 0;
        }
      } else if (input.back) {
        sim.screen = "playing";
        sim.menuIndex = 0;
      }
      return;

    case "gameover":
      moveMenu(sim, input, GAMEOVER_ITEMS.length);
      if (input.confirm) {
        if (sim.menuIndex === 0) startNewGame(sim);
        else {
          sim.screen = "title";
          sim.menuIndex = 0;
        }
      }
      return;
  }
}
