// Shatter — the run: opening a game, the title values, the score, and the lives.
//
// The transitions that rebuild the world live here, apart from the per-tick
// systems that read them, because three different callers reach them: the menus
// (`src/game.ts`), the collision resolution that costs a life
// (`src/collision.ts`), and the debug surface's `reset` (`src/debug.ts`).
//
// `specs/progression.md` fixes what a new game is and what a life costs;
// `specs/scoring.md` fixes what is paid and the extra ship it earns.

import {
  CUES,
  EXTRA_LIFE_SHOW,
  EXTRA_LIFE_STEP,
  INVULN_TIME,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  STAR_X,
  STAR_Y,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
  FIELD_H,
  FIELD_W,
  type CueName,
} from "./constants";
import { driftRock, makeShip, placeAtSafePoint } from "./entities";
import { wrappedDistance } from "./geometry";
import { range, seed } from "./rng";
import type { ShatterState } from "./types";

/**
 * Raise a cue for the tick being resolved.
 *
 * The simulation never touches the audio bus: it names what happened and
 * `src/game.ts` plays the tick's cues once it has finished. That keeps the whole
 * simulation free of the audio layer, which is what makes `specs/audio.md`'s
 * "audio is never a dependency of play" true by construction rather than by care.
 */
export function raise(state: ShatterState, cue: CueName): void {
  state.cues.push(cue);
}

/** A whole game at its title values, with the generator on `seedValue`. */
export function createState(seedValue: number): ShatterState {
  const state: ShatterState = {
    screen: "title",
    menuIndex: 0,
    score: 0,
    lives: START_LIVES,
    wave: 0,
    waveBanner: 0,
    ship: makeShip(),
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
    carry: 0,
    simTime: 0,
    muted: false,
    rng: 1,
    nextId: 0,
    rockDestroyed: false,
    extraLifeShow: 0,
    cues: [],
    pointerPresses: [],
  };
  seed(state, seedValue);
  return state;
}

/**
 * Restore every declared field to its title-screen value.
 *
 * This is what the surface's `reset` does, and what the title menu's QUIT TO MENU
 * and the game-over menu's MENU reach. `muted` is deliberately untouched: muting
 * is a player preference the runtime owns, and returning to the title is not a
 * reason to start making noise again.
 */
export function toTitle(state: ShatterState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.score = 0;
  state.lives = START_LIVES;
  state.wave = 0;
  state.waveBanner = 0;
  state.extraLifeShow = 0;
  state.bullets = [];
  state.rocks = [];
  state.enemyBullets = [];
  state.torpedoes = [];
  state.saucer = null;
  state.torpedoCharge = 1;
  placeAtSafePoint(state.ship);
  state.ship.invuln = 0;
  state.ship.fireCooldown = 0;
  state.ship.collision = true;
  state.waveSpawning = true;
  state.saucerSpawning = true;
  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;
  state.carry = 0;
  state.simTime = 0;
  state.rockDestroyed = false;
  state.cues = [];
  state.pointerPresses = [];
}

/**
 * Open a new game: three ships, a score of nothing, wave 1, and a field cleared
 * of everything the previous game left (`specs/progression.md`).
 *
 * Wave 1 is put up at once rather than behind a banner, which is one of the two
 * openings `specs/progression.md` allows. The saucer cadence starts over from the
 * beginning of a game, and both of the game's own spawners are on, as
 * `specs/state.md` requires of a game that is beginning.
 *
 * The ship's contact gate is deliberately left as it stands: it belongs to the
 * debug surface rather than to the run, and `reset` is what restores it.
 */
export function startNewGame(state: ShatterState): void {
  state.screen = "playing";
  state.menuIndex = 0;
  state.score = 0;
  state.lives = START_LIVES;
  state.wave = 1;
  state.waveBanner = 0;
  state.extraLifeShow = 0;
  state.bullets = [];
  state.rocks = [];
  state.enemyBullets = [];
  state.torpedoes = [];
  state.saucer = null;
  state.torpedoCharge = 1;
  placeAtSafePoint(state.ship);
  state.ship.fireCooldown = 0;
  // A grace at the opening, exactly as a respawn carries, so a wave cannot end
  // the game before the player has taken hold of the ship.
  state.ship.invuln = INVULN_TIME;
  state.waveSpawning = true;
  state.saucerSpawning = true;
  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;
  spawnWave(state, state.wave);
}

/** The multiplier wave `N`'s rocks drift at, capped as the specification fixes. */
export function waveSpeedScale(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

/**
 * Put wave `n` on the field: `WAVE_BASE_ROCKS + n` Large rocks, each clear of the
 * ship and of the star, each drifting on a random heading at its size's base
 * speed scaled by the wave.
 */
export function spawnWave(state: ShatterState, n: number): void {
  const count = WAVE_BASE_ROCKS + n;
  const scale = waveSpeedScale(n);
  for (let i = 0; i < count; i += 1) {
    const spot = findSpawnPoint(state);
    state.rocks.push(driftRock(state, "large", spot.x, spot.y, scale));
  }
}

/** Whether a point clears both of the spawn margins the specification fixes. */
function spawnPointIsClear(state: ShatterState, x: number, y: number): boolean {
  return (
    wrappedDistance(x, y, state.ship.x, state.ship.y) >= WAVE_MIN_SHIP_DIST &&
    wrappedDistance(x, y, STAR_X, STAR_Y) >= WAVE_MIN_STAR_DIST
  );
}

/**
 * A field position at least `WAVE_MIN_SHIP_DIST` from the ship and
 * `WAVE_MIN_STAR_DIST` from the star, both by shortest wrapped separation.
 *
 * Drawn at random, which is what the specification asks for, but never left to
 * chance: if a bounded run of draws has not found one, a coarse sweep of the
 * field does, so the margins hold even in the arrangement that makes the two
 * exclusions largest. Between them the two margins never cover the whole field,
 * so the sweep always has somewhere to land.
 */
function findSpawnPoint(state: ShatterState): { x: number; y: number } {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = range(state, 0, FIELD_W);
    const y = range(state, 0, FIELD_H);
    if (spawnPointIsClear(state, x, y)) return { x, y };
  }
  const steps = 32;
  for (let ix = 0; ix < steps; ix += 1) {
    for (let iy = 0; iy < steps; iy += 1) {
      const x = ((ix + 0.5) * FIELD_W) / steps;
      const y = ((iy + 0.5) * FIELD_H) / steps;
      if (spawnPointIsClear(state, x, y)) return { x, y };
    }
  }
  // Unreachable with this field and these margins; the corner furthest from both
  // is still the best answer if the figures ever change.
  return { x: 0, y: 0 };
}

/**
 * Pay `points` and grant every extra ship the payment carries the score across.
 *
 * The award is counted from the multiples crossed rather than from a running
 * threshold, so a single payment that crosses two multiples grants two ships and
 * a score POSED across a boundary grants none — which is what
 * `specs/instrumentation.md` requires of `setScore`, since a pose is a
 * precondition and the award belongs to the scoring path.
 */
export function addScore(state: ShatterState, points: number): void {
  const before = state.score;
  state.score += points;
  const awards =
    Math.floor(state.score / EXTRA_LIFE_STEP) -
    Math.floor(before / EXTRA_LIFE_STEP);
  for (let i = 0; i < awards; i += 1) {
    state.lives += 1;
    state.extraLifeShow = EXTRA_LIFE_SHOW;
    raise(state, CUES.extraLife);
  }
}

/**
 * The ship has been destroyed: a life is spent, and either the next ship appears
 * at the safe point inside its grace or the game is over.
 *
 * The last death puts no ship up — the ship is left where it died, so nothing
 * appears at the safe point — and the counter reaches `0`
 * (`specs/progression.md`).
 */
export function killShip(state: ShatterState): void {
  raise(state, CUES.death);
  state.ship.thrusting = false;
  state.lives -= 1;
  if (state.lives <= 0) {
    state.lives = 0;
    state.screen = "gameover";
    state.menuIndex = 0;
    return;
  }
  placeAtSafePoint(state.ship);
  state.ship.invuln = INVULN_TIME;
  // A respawn refills the torpedo and cancels any recharge in progress
  // (`specs/weapons.md`).
  state.torpedoCharge = 1;
}
