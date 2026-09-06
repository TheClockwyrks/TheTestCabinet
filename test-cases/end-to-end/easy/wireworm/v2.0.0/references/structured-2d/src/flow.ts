// Wireworm — the run: starting one, losing a life, clearing a level, and the
// transitions the screens make between them (`specs/progression.md`).
//
// Each function here is one transition, written once, so the same thing happens
// whether a player reached it (the controller's menus, a contact during play) or
// a caller posed it. The one rule worth naming twice: a LEVEL CLEARS ON THE STEP
// IN WHICH THE LAST OF ITS SEGMENTS IS REMOVED. The clear is that removal, so a
// board holding no segments and having had none removed is being played rather
// than cleared — which is what lets a scenario pose an empty board and run a
// rule on it without the level clearing underneath it.

import {
  BANNER_TIME,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  COLS,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  START_LIVES,
  TOTAL_LEVELS,
} from "./constants";
import type { FrameCues } from "./audio";
import { resetSpawnClocks } from "./foes";
import type { WirewormState } from "./game";
import { putNode } from "./grid";
import { randomInt, randomRange } from "./rng";
import { addScore } from "./scoring";
import { enterLevelWorm } from "./worm";

/** The center of the player band, which is where a run and a respawn place the cursor. */
export const BAND_CX = (CURSOR_X_MIN + CURSOR_X_MAX) / 2;
export const BAND_CY = (CURSOR_Y_MIN + CURSOR_Y_MAX) / 2;

/** Empty every roster on the board, leaving the run's figures as they are. */
export function clearBoard(state: WirewormState): void {
  state.nodes = [];
  state.worms = [];
  state.foes = [];
  state.bolts = [];
  state.arcs = [];
}

/**
 * Lay a new run's starting field: a scattering of inert nodes across the scatter
 * rows, between `SCATTER_MIN_FRACTION` and `SCATTER_MAX_FRACTION` of the tiles
 * those rows hold, each tile drawn at random so two runs lay different fields
 * (`specs/nodes.md`).
 */
export function scatterField(state: WirewormState): void {
  const rows = SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1;
  const tiles = rows * COLS;
  const wanted = Math.round(
    randomRange(SCATTER_MIN_FRACTION, SCATTER_MAX_FRACTION) * tiles,
  );
  let laid = 0;
  // Rejection sampling: the field is at most 15% of the rows, so a draw lands on
  // an empty tile almost every time, and the bound keeps the loop from spinning.
  for (let draw = 0; laid < wanted && draw < tiles * 20; draw += 1) {
    const c = randomInt(0, COLS - 1);
    const r = randomInt(SCATTER_TOP_ROW, SCATTER_BOTTOM_ROW);
    const existing = state.nodes.some((node) => node.c === c && node.r === r);
    if (existing) continue;
    putNode(state, c, r, 0);
    laid += 1;
  }
}

/** Place the cursor at the band's center, with no invulnerability running. */
function centreCursor(state: WirewormState): void {
  state.cursor.x = BAND_CX;
  state.cursor.y = BAND_CY;
}

/**
 * Open a new run: three lives, level one, a score of zero, a fresh scatter, and
 * the first level's banner (`specs/progression.md`, Starting a run). The world
 * gates are left exactly as they stand — they belong to the debug surface, and
 * only `reset` restores them.
 */
export function startRun(state: WirewormState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.level = 1;
  state.reachedLevel = 1;
  clearBoard(state);
  scatterField(state);
  centreCursor(state);
  state.cursor.invulnerable = 0;
  state.fireCooldown = 0;
  state.glitchTimer = 0;
  state.corruptorTimer = 0;
  state.dropperTimer = 0;
  state.menuIndex = 0;
  state.screen = "playing";
  state.phase = "banner";
  state.phaseTimer = BANNER_TIME;
}

/**
 * The level's play becomes active: the spawner clocks start from this moment and
 * the level's worm enters, which is the one moment a worm enters.
 */
export function enterActive(state: WirewormState, respawning: boolean): void {
  state.phase = "active";
  state.phaseTimer = 0;
  if (respawning) state.cursor.invulnerable = RESPAWN_INVULN;
  else resetSpawnClocks(state);
  if (state.wormEntry) enterLevelWorm(state);
}

/**
 * A worm segment or a foe reached the cursor: one life, the board swept of
 * everything but the field, and the respawn pause — or the end of the run where
 * that was the last life (`specs/progression.md`, Losing a life).
 */
export function loseLife(state: WirewormState, cues: FrameCues): void {
  state.lives -= 1;
  cues.life = true;
  if (state.lives <= 0) {
    state.lives = 0;
    state.screen = "gameover";
    state.menuIndex = 0;
    cues.gameOver = true;
    return;
  }
  state.worms = [];
  state.foes = [];
  state.bolts = [];
  centreCursor(state);
  state.phase = "respawn";
  state.phaseTimer = RESPAWN_TIME;
}

/**
 * The last of the level's worm segments was removed: the clear bonus, the next
 * level's banner, and — on level `TOTAL_LEVELS` — the victory bonus and the
 * victory screen (`specs/progression.md`, Clearing a level).
 *
 * The node field is untouched by both: it stands at the charges it held.
 */
export function clearLevel(state: WirewormState, cues: FrameCues): void {
  cues.levelClear = true;
  addScore(state, SCORE_LEVEL_CLEAR * state.level);
  state.foes = [];
  state.bolts = [];

  if (state.level >= TOTAL_LEVELS) {
    addScore(state, SCORE_VICTORY * state.lives);
    state.screen = "victory";
    state.menuIndex = 0;
    cues.victory = true;
    return;
  }

  state.level += 1;
  state.reachedLevel = Math.max(state.reachedLevel, state.level);
  state.phase = "banner";
  state.phaseTimer = BANNER_TIME;
}

/**
 * Back to the title, with its highlight on the entry the caller left from
 * (`specs/ui.md`).
 *
 * `index` defaults to `DESCEND`, which is what `QUIT TO MENU` and `MENU` return
 * to: both leave a run, and `DESCEND` is the entry that started it. Leaving the
 * how-to screen names that screen's own entry instead.
 */
export function toTitle(state: WirewormState, index = 0): void {
  state.screen = "title";
  state.menuIndex = index;
}

/**
 * Every declared field back at its title-screen value
 * (`specs/instrumentation.md`, The core). `muted` is deliberately untouched:
 * muting is a player preference the runtime owns, and a reset is not a reason to
 * start making noise again.
 */
export function resetState(state: WirewormState): void {
  state.screen = "title";
  state.phase = "banner";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  state.score = 0;
  state.lives = START_LIVES;
  state.level = 1;
  state.reachedLevel = 1;
  clearBoard(state);
  centreCursor(state);
  state.cursor.invulnerable = 0;
  state.cursor.contact = true;
  state.fireCooldown = 0;
  state.foeSpawning = true;
  state.wormEntry = true;
  state.glitchTimer = 0;
  state.corruptorTimer = 0;
  state.dropperTimer = 0;
  state.nextWormEntry = null;
  state.nextGlitchEntry = null;
  state.nextDropperEntry = null;
  state.nextCorruptorEntry = null;
  state.nextId = 1;
  state.simTime = 0;
  state.presses = [];
}
