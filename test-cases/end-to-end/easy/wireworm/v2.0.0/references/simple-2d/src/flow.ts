// Wireworm — the run and the screens it moves between (`specs/progression.md`,
// `specs/ui.md`).
//
// Everything that changes which screen is showing lives here, so the menus, the
// life-loss path, the level-clear path and the debug surface's `reset` all take
// the same routes. Two rules in this file are worth naming:
//
//   * A level clears on the STEP in which the last of its worm segments is
//     removed. The clear is that removal, so a board that holds no segments and
//     has had none removed is being played rather than cleared. That is why
//     `clearIfSwept` reads what the frame did rather than what the board holds.
//   * The level's worm enters as the banner gives way to `active`, and the
//     respawn's worm as the respawn does, at that moment and no other.

import {
  BANNER_TIME,
  CUES,
  ENDING_ITEMS,
  PAUSE_ITEMS,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  START_LIVES,
  TITLE_ITEMS,
  TOTAL_LEVELS,
} from "./constants";
import { emptySprites, type Sprites } from "./assets";
import { clampCursor } from "./cursor";
import { scatterField } from "./field";
import { addScore } from "./scoring";
import { enterWorm } from "./worm";
import type { Screen, WirewormState } from "./game";
import type { FrameEvents, Sim } from "./sim";

/** The band's center, where a run and every respawn place the cursor. */
export const BAND_CENTER_X = 640;
export const BAND_CENTER_Y = 688;

/** The state a fresh build opens on: the title screen, with nothing on the board. */
export function openingState(sprites: Sprites): WirewormState {
  return {
    screen: "title",
    phase: "banner",
    phaseTimer: 0,
    menuIndex: 0,

    score: 0,
    lives: START_LIVES,
    level: 1,
    reachedLevel: 1,

    nodes: [],
    worms: [],
    foes: [],
    bolts: [],
    arcs: [],

    cursor: {
      x: BAND_CENTER_X,
      y: BAND_CENTER_Y,
      invulnerable: 0,
      contact: true,
    },
    fireCooldown: 0,

    foeSpawning: true,
    wormEntry: true,
    glitchTimer: 0,
    corruptorTimer: 0,
    dropperTimer: 0,
    nextWormEntry: null,
    nextGlitchEntry: null,
    nextDropperEntry: null,
    nextCorruptorEntry: null,

    nextId: 1,
    simTime: 0,
    muted: false,

    presses: [],

    sprites,
  };
}

/** The opening state with no art at all, which is what a headless host gets. */
export function blankState(): WirewormState {
  return openingState(emptySprites());
}

/**
 * Restore every declared field to its title-screen value (the debug surface's
 * `reset`). `muted` is a player preference the runtime owns and is left exactly
 * as it stands, and the loaded art is left with it.
 */
export function resetToTitle(sim: Sim): void {
  const fresh = openingState(sim.sprites);
  sim.screen = fresh.screen;
  sim.phase = fresh.phase;
  sim.phaseTimer = fresh.phaseTimer;
  sim.menuIndex = fresh.menuIndex;
  sim.score = fresh.score;
  sim.lives = fresh.lives;
  sim.level = fresh.level;
  sim.reachedLevel = fresh.reachedLevel;
  sim.nodes = [];
  sim.worms = [];
  sim.foes = [];
  sim.bolts = [];
  sim.arcs = [];
  sim.cursor = {
    x: BAND_CENTER_X,
    y: BAND_CENTER_Y,
    invulnerable: 0,
    contact: true,
  };
  sim.fireCooldown = 0;
  sim.foeSpawning = true;
  sim.wormEntry = true;
  sim.glitchTimer = 0;
  sim.corruptorTimer = 0;
  sim.dropperTimer = 0;
  sim.nextWormEntry = null;
  sim.nextGlitchEntry = null;
  sim.nextDropperEntry = null;
  sim.nextCorruptorEntry = null;
  sim.nextId = fresh.nextId;
  sim.simTime = 0;
  sim.presses = [];
}

/** Open a new run: level one, full lives, a fresh scatter, and the banner. */
export function startRun(sim: Sim): void {
  sim.screen = "playing";
  sim.phase = "banner";
  sim.phaseTimer = BANNER_TIME;
  sim.menuIndex = 0;
  sim.score = 0;
  sim.lives = START_LIVES;
  sim.level = 1;
  sim.reachedLevel = 1;
  sim.worms = [];
  sim.foes = [];
  sim.bolts = [];
  sim.arcs = [];
  sim.cursor = {
    x: BAND_CENTER_X,
    y: BAND_CENTER_Y,
    invulnerable: 0,
    contact: sim.cursor.contact,
  };
  sim.fireCooldown = 0;
  sim.glitchTimer = 0;
  sim.corruptorTimer = 0;
  sim.dropperTimer = 0;
  scatterField(sim);
}

/** The menu the current screen shows, or `null` where it shows none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "victory":
    case "gameover":
      return ENDING_ITEMS;
    default:
      return null;
  }
}

/**
 * Move to `screen`, with its menu's highlight on the entry the caller names.
 *
 * `index` defaults to the first item, which is where an arriving screen opens
 * and where a run left for the menu lands: `DESCEND` is the entry that started
 * it (specs/ui.md). Leaving the how-to screen names that screen's own entry
 * instead.
 */
export function goTo(sim: Sim, screen: Screen, index = 0): void {
  sim.screen = screen;
  sim.menuIndex = index;
}

/** A life lost: the board is swept, the cursor recentered, and play pauses. */
export function loseLife(sim: Sim, ev: FrameEvents): void {
  sim.lives -= 1;
  ev.cues.add(CUES.life);

  if (sim.lives <= 0) {
    sim.lives = 0;
    goTo(sim, "gameover");
    ev.cues.add(CUES.gameOver);
    return;
  }

  sim.worms = [];
  sim.foes = [];
  sim.bolts = [];
  sim.cursor.x = BAND_CENTER_X;
  sim.cursor.y = BAND_CENTER_Y;
  sim.phase = "respawn";
  sim.phaseTimer = RESPAWN_TIME;
}

/** The level cleared: the bonus is paid and the run moves on, or is won. */
export function clearLevel(sim: Sim, ev: FrameEvents): void {
  addScore(sim, SCORE_LEVEL_CLEAR * sim.level);
  ev.cues.add(CUES.levelClear);

  if (sim.level >= TOTAL_LEVELS) {
    addScore(sim, SCORE_VICTORY * sim.lives);
    goTo(sim, "victory");
    ev.cues.add(CUES.victory);
    return;
  }

  sim.level += 1;
  sim.reachedLevel = Math.max(sim.reachedLevel, sim.level);
  sim.foes = [];
  sim.bolts = [];
  sim.phase = "banner";
  sim.phaseTimer = BANNER_TIME;
  sim.glitchTimer = 0;
  sim.corruptorTimer = 0;
  sim.dropperTimer = 0;
}

/**
 * The banner or the respawn giving way to live play, which is when a worm
 * enters. The spawner clocks stand exactly where they were: only opening a run
 * and clearing a level set them (specs/foes.md, The spawner clocks).
 */
export function beginActive(sim: Sim): void {
  const wasRespawn = sim.phase === "respawn";
  sim.phase = "active";
  sim.phaseTimer = 0;
  // Only a respawn grants the spawn-in invulnerability; a level's banner does
  // not, because nothing was standing in the cursor when the level opened.
  if (wasRespawn) sim.cursor.invulnerable = RESPAWN_INVULN;
  if (sim.wormEntry) enterWorm(sim);
}

/** Place the cursor, held inside the band, exactly as a pose does. */
export function placeCursor(sim: Sim, x: number, y: number): void {
  const held = clampCursor(x, y);
  sim.cursor.x = held.x;
  sim.cursor.y = held.y;
}
