// Meltdown — the run: phases, the release, and how a run is won and lost.
//
// specs/waves.md fixes the three phases, the untimed opening, the 15-second
// build countdown and its auto-start, the release cadence and the vent draw,
// and what clearing a wave does. specs/economy.md fixes the four income
// lines, and the ORDER of two of them: the wave-clear bonus lands first and the
// interest is taken on the money it left.
//
// Every entry effect in the game lives here, which is exactly why the debug
// surface's `setScreen` and `setPhase` run none of them: an item whose
// requirement is an entry effect has to reach the transition the way the game
// does.

import {
  BUILD_PHASE_TIME,
  EARLY_SEND_PER_SECOND,
  INTEREST_CAP,
  INTEREST_RATE,
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
  WAVE_SPAWN_INTERVAL,
  type DifficultyName,
  type ModeName,
} from "./constants";
import {
  hpScaleOf,
  interestOf,
  startLivesOf,
  startMoneyOf,
  unitTypeOf,
  waveCountOf,
  waveSizeOf,
} from "./modes";
import { routesOf } from "./routes";
import { drawVent, newUnit } from "./surge";
import type { MeltdownState } from "./game";

/** The slack every countdown comparison carries; see `src/combat.ts`. */
const EPS = 1e-9;

/** The cues a frame's run transitions raised. */
export interface RunEvents {
  waveClear: boolean;
  victory: boolean;
  gameOver: boolean;
}

/** An empty set of run events, for a frame that raised none. */
export function noRunEvents(): RunEvents {
  return { waveClear: false, victory: false, gameOver: false };
}

/** The number of waves this run fights. */
export function waveCountFor(state: MeltdownState): number {
  return waveCountOf(state.mode, state.difficulty);
}

/**
 * A fresh run on `mode` and `difficulty`: the opening phase on wave 1, with
 * that pair's starting money and lives, an empty floor, and nothing armed.
 */
export function freshRun(
  state: MeltdownState,
  mode: ModeName,
  difficulty: DifficultyName,
): MeltdownState {
  return {
    ...state,
    screen: "playing",
    phase: "opening",
    menuIndex: 0,
    mode,
    difficulty,
    money: startMoneyOf(mode, difficulty),
    lives: startLivesOf(mode),
    score: 0,
    wave: 1,
    buildTimer: 0,
    wavePending: 0,
    spawnClock: 0,
    speed: 1,
    towers: [],
    surge: [],
    selected: null,
    hoverShop: null,
    build: null,
    waveSpawning: true,
    nextId: 1,
  };
}

/**
 * The wave phase begins: its units are queued, the spawner's clock is set so
 * the first unit is released on this very frame, and every tower on the floor
 * stops being fresh (specs/building.md, Freshness).
 */
export function enterWave(state: MeltdownState): MeltdownState {
  return {
    ...state,
    phase: "wave",
    wavePending: waveSizeOf(state.mode, state.wave, waveCountFor(state)),
    spawnClock: 0,
    towers: state.towers.map((tower) => ({ ...tower, fresh: false })),
  };
}

/**
 * A between-wave build phase begins: the countdown is set and the interest of
 * specs/economy.md is paid, on the money the wave-clear bonus already left.
 */
export function enterBuildPhase(state: MeltdownState): MeltdownState {
  const interest = interestOf(state.mode)
    ? Math.min(Math.floor(INTEREST_RATE * state.money), INTEREST_CAP)
    : 0;
  return {
    ...state,
    phase: "building",
    buildTimer: BUILD_PHASE_TIME,
    money: state.money + interest,
  };
}

/** The victory screen, with its per-life score bonus. */
export function toVictory(state: MeltdownState): MeltdownState {
  return {
    ...state,
    screen: "victory",
    menuIndex: 0,
    score: state.score + SCORE_VICTORY_PER_LIFE * Math.max(0, state.lives),
  };
}

/** The game-over screen. */
export function toGameOver(state: MeltdownState): MeltdownState {
  return { ...state, screen: "gameover", menuIndex: 0 };
}

/**
 * Sending: Wave 1 from the untimed opening phase, or the next wave early from a
 * build phase, which pays `1` per whole second left on the timer. Sending
 * during a wave does nothing.
 */
export function send(state: MeltdownState): {
  state: MeltdownState;
  sent: boolean;
} {
  if (state.screen !== "playing") return { state, sent: false };
  if (state.phase === "wave") return { state, sent: false };
  const bonus =
    state.phase === "building"
      ? EARLY_SEND_PER_SECOND * Math.floor(Math.max(0, state.buildTimer))
      : 0;
  return {
    state: enterWave({
      ...state,
      money: state.money + bonus,
      buildTimer: 0,
    }),
    sent: true,
  };
}

/**
 * The build timer and the wave spawner, one frame's worth. The world gate holds
 * the timer's automatic start of the next wave and the spawner's release, and
 * nothing else: the timer still counts down with the gate off.
 */
export function stepRelease(state: MeltdownState, dt: number): MeltdownState {
  let next = state;
  if (next.phase === "building") {
    const timer = Math.max(0, next.buildTimer - dt);
    next = { ...next, buildTimer: timer };
    if (timer <= 0 && next.waveSpawning) next = enterWave(next);
  }
  if (next.phase !== "wave" || !next.waveSpawning) return next;

  let pending = next.wavePending;
  let clock = next.spawnClock;
  if (pending <= 0) return { ...next, spawnClock: clock };
  clock -= dt;
  let surge = next.surge;
  let nextId = next.nextId;
  const size = waveSizeOf(next.mode, next.wave, waveCountFor(next));
  const scale = hpScaleOf(next.mode, next.wave);
  const routes = routesOf(next.towers);
  let guard = 0;
  while (clock <= EPS && pending > 0 && guard < 512) {
    guard += 1;
    const index = Math.max(0, size - pending);
    const type = unitTypeOf(next.mode, next.wave, waveCountFor(next), index);
    // The posed vent while one is posed, else the draw (specs/waves.md).
    const vent = next.spawnVent ?? drawVent();
    surge = [...surge, newUnit(nextId, type, vent, scale, routes)];
    nextId += 1;
    pending -= 1;
    clock += WAVE_SPAWN_INTERVAL;
  }
  return {
    ...next,
    surge,
    wavePending: pending,
    spawnClock: clock,
    nextId,
  };
}

/**
 * The wave-clear transition. A wave clears on the frame its last live unit dies
 * or leaks with none of it left to release, so a phase that released no unit
 * never clears — which is what lets a scenario pose an empty floor.
 */
export function resolveWaveClear(
  state: MeltdownState,
  unitWent: boolean,
  lostLives: boolean,
  events: RunEvents,
): MeltdownState {
  if (state.screen !== "playing") return endIfDead(state, lostLives, events);
  if (
    state.phase !== "wave" ||
    !unitWent ||
    state.wavePending > 0 ||
    state.surge.length > 0
  ) {
    return endIfDead(state, lostLives, events);
  }
  const wave = state.wave;
  const cleared: MeltdownState = {
    ...state,
    money: state.money + WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * wave,
    score: state.score + SCORE_WAVE_CLEAR * wave,
  };
  events.waveClear = true;
  if (cleared.lives <= 0) {
    events.gameOver = true;
    return toGameOver(cleared);
  }
  if (wave >= waveCountFor(cleared)) {
    events.victory = true;
    return toVictory(cleared);
  }
  return enterBuildPhase({ ...cleared, wave: wave + 1 });
}

/**
 * Lives reaching `0` ends the run at once, ON THE FRAME IT HAPPENS and whatever
 * the phase. A run posed at `0` lives has not lost them on this frame, so a
 * precondition never ends a run by itself: only a leak does.
 */
function endIfDead(
  state: MeltdownState,
  lostLives: boolean,
  events: RunEvents,
): MeltdownState {
  if (!lostLives || state.screen !== "playing" || state.lives > 0) return state;
  events.gameOver = true;
  return toGameOver(state);
}
