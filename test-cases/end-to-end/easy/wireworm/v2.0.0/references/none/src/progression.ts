// Wireworm — the run: lives, the respawn, the twelve levels, and the two ways it
// ends (specs/progression.md).
//
// The level-clear rule is a TRANSITION, not a predicate. A level clears on the
// step in which the last of its worm segments is REMOVED, so
// {@link checkLevelCleared} is called from the two paths that remove one — a
// bolt and a discharge — and from nowhere else. A board that holds no worm and
// has had none removed is being played, which is what makes a posed empty board
// a legitimate scenario rather than an instant win, and it is also why clearing
// the rosters on a lost life does not advance the run.

import {
  BANNER_TIME,
  BONUS_LIFE_EVERY,
  COLS,
  CUES,
  ENTRY_ROW,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  START_LIVES,
  STAGE_W,
  TOTAL_LEVELS,
  wormLength,
} from "./constants";
import { emptyField, scatterField } from "./field";
import { nextChance } from "./rng";
import { addScore } from "./scoring";
import type { CueSink, Tile, WirewormState } from "./types";

/** The band's center, where the cursor opens a run and returns after a respawn. */
export const BAND_CENTER_X = STAGE_W / 2;
export const BAND_CENTER_Y = 688;

/**
 * Move to the title screen, with its highlight on the entry the caller left
 * from (specs/ui.md).
 *
 * `index` defaults to `DESCEND`, which is what `QUIT TO MENU` and `MENU` return
 * to: both leave a run, and `DESCEND` is the entry that started it. Leaving the
 * how-to screen passes that screen's own entry instead.
 */
export function toTitle(state: WirewormState, index = 0): void {
  state.screen = "title";
  state.menuIndex = index;
}

/**
 * Open a new run: a fresh scatter, three lives, level 1, no score, and the
 * level-1 banner.
 *
 * The world gates and the cursor's contact test are deliberately left as they
 * stand. They are not part of the run — `reset` is what restores them — so a
 * scenario that turned one off and then opened a run through the menu keeps the
 * world it arranged.
 */
export function startRun(state: WirewormState): void {
  state.field = emptyField();
  scatterField(state.field, state);
  state.worms = [];
  state.foes = [];
  state.bolts = [];
  state.arcs = [];
  state.score = 0;
  state.lives = START_LIVES;
  state.level = 1;
  state.reachedLevel = 1;
  state.nextBonus = BONUS_LIFE_EVERY;
  state.cursor.x = BAND_CENTER_X;
  state.cursor.y = BAND_CENTER_Y;
  state.cursor.invulnerable = 0;
  state.fireCooldown = 0;
  state.glitchTimer = 0;
  state.corruptorTimer = 0;
  state.dropperTimer = 0;
  state.screen = "playing";
  state.menuIndex = 0;
  state.phase = "banner";
  state.phaseTimer = BANNER_TIME;
}

/**
 * Bring in the level's worm along the entry row (specs/worm.md).
 *
 * Every segment is laid on row 0, the head furthest from the edge it entered at
 * and the tail nearest it, so the whole chain stands on the board from the
 * moment it arrives. The side is drawn from the run's seeded generator.
 *
 * Gated by `wormEntry`, which is the level's and the respawn's entry and nothing
 * else: a worm already on the board steps as usual whatever the gate says.
 */
export function enterLevelWorm(state: WirewormState): void {
  if (!state.wormEntry) return;
  const length = wormLength(state.level);
  const fromLeft = nextChance(state, 0.5);
  const segments: Tile[] = [];
  for (let i = 0; i < length; i += 1) {
    const c = fromLeft ? length - 1 - i : COLS - length + i;
    segments.push({ c, r: ENTRY_ROW });
  }
  state.worms.push({
    id: state.nextId,
    segments,
    dh: fromLeft ? 1 : -1,
    dv: 1,
    diving: false,
    stepping: true,
    body: true,
    stepClock: 0,
  });
  state.nextId += 1;
}

/**
 * A worm segment or a foe reached the cursor.
 *
 * With lives to spare this clears the board of everything but the node field and
 * opens the respawn pause; the contact that takes lives to zero ends the run
 * instead, and the guard at the top is what stops a second contact in the same
 * frame being counted against a run that has already ended.
 */
export function loseLife(state: WirewormState, cues: CueSink): void {
  if (state.screen !== "playing") return;
  state.lives = Math.max(0, state.lives - 1);
  cues.play(CUES.life);

  if (state.lives === 0) {
    state.reachedLevel = Math.max(state.reachedLevel, state.level);
    state.screen = "gameover";
    state.menuIndex = 0;
    cues.play(CUES.gameOver);
    return;
  }

  // The node field stands exactly as it was; the worms, foes and bolts do not.
  state.worms = [];
  state.foes = [];
  state.bolts = [];
  state.cursor.x = BAND_CENTER_X;
  state.cursor.y = BAND_CENTER_Y;
  state.phase = "respawn";
  state.phaseTimer = RESPAWN_TIME;
}

/**
 * The last segment of the level's worm has just been removed.
 *
 * Below level 12 this pays the clear bonus and opens the next level's banner;
 * at level 12 it pays the victory bonus on top and ends the run.
 */
export function levelClear(state: WirewormState, cues: CueSink): void {
  addScore(state, SCORE_LEVEL_CLEAR * state.level);
  cues.play(CUES.levelClear);

  if (state.level >= TOTAL_LEVELS) {
    addScore(state, SCORE_VICTORY * state.lives);
    state.reachedLevel = TOTAL_LEVELS;
    state.screen = "victory";
    state.menuIndex = 0;
    cues.play(CUES.victory);
    return;
  }

  state.level += 1;
  state.reachedLevel = Math.max(state.reachedLevel, state.level);
  // The node field stands at the charges it held; the foes and the bolts do not.
  state.foes = [];
  state.bolts = [];
  state.glitchTimer = 0;
  state.corruptorTimer = 0;
  state.dropperTimer = 0;
  state.phase = "banner";
  state.phaseTimer = BANNER_TIME;
}

/**
 * Called from the two paths that remove a segment. The level clears only when
 * that removal emptied the board of worms during live play.
 */
export function checkLevelCleared(state: WirewormState, cues: CueSink): void {
  if (state.screen !== "playing" || state.phase !== "active") return;
  if (state.worms.length > 0) return;
  levelClear(state, cues);
}

/**
 * Count the phase timer down and take the phase transitions it reaches.
 *
 * Returns `true` while the phase is `active`, which is the caller's signal to
 * run live play this frame.
 */
export function advancePhase(state: WirewormState, dt: number): boolean {
  if (state.phase === "banner") {
    state.phaseTimer -= dt;
    if (state.phaseTimer > 0) return false;
    state.phaseTimer = 0;
    state.phase = "active";
    // The level's worm enters as the banner gives way, and at no other moment.
    enterLevelWorm(state);
    return false;
  }

  if (state.phase === "respawn") {
    state.phaseTimer -= dt;
    if (state.phaseTimer > 0) return false;
    state.phaseTimer = 0;
    state.phase = "active";
    state.cursor.invulnerable = RESPAWN_INVULN;
    enterLevelWorm(state);
    return false;
  }

  // Nothing counts down during live play; the timer rests where the transition
  // into `active` left it, which is zero.
  return true;
}
