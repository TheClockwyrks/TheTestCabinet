// Meltdown — the run: its phases, its clocks, and how it is won and lost.
//
// The three phases of the `playing` screen and the transitions between them all
// live here, because every one of them pays something (specs/economy.md): a
// wave clearing pays its bonus and its score, entering a build phase between
// waves pays interest on the money that bonus left, sending early pays a coin a
// second, and clearing the final wave pays for every life still in hand.
//
// None of it is reachable from the debug surface: `setScreen` and `setPhase`
// set their field alone and run no entry effect, so an item whose requirement
// IS an entry effect has to reach the transition the way the game reaches it —
// a wave clearing, a send, a build timer running out, lives running out
// (specs/instrumentation.md).

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
} from "./constants";
import { figuresOf, waveSizeFor } from "./waves";
import type { MeltdownState } from "./game";

/** The interest a build phase between waves pays on the money in hand. */
export function interestOn(money: number): number {
  return Math.min(Math.floor(INTEREST_RATE * money), INTEREST_CAP);
}

/** What one wave clearing pays. */
export function waveClearBonus(wave: number): number {
  return WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * wave;
}

/** Nothing on the floor is fresh once a wave is running. */
function endFreshness(state: MeltdownState): void {
  for (const tower of state.towers) tower.fresh = false;
}

/**
 * Put the run into its wave phase: the wave's units owed, the release clock
 * armed so the first unit goes on this very frame, and every tower's freshness
 * ended.
 */
export function beginWave(state: MeltdownState): void {
  state.phase = "wave";
  state.wavePending = waveSizeFor(state, state.wave);
  state.spawnClock = WAVE_SPAWN_INTERVAL;
  state.buildTimer = 0;
  endFreshness(state);
}

/**
 * Send the coming wave. From a build phase it pays the early-send bonus of one
 * coin per whole second left; from the untimed opening phase it pays nothing,
 * because there is no clock to be early against.
 */
export function sendWave(state: MeltdownState): boolean {
  if (state.screen !== "playing") return false;
  if (state.phase === "wave") return false;
  if (state.phase === "building") {
    state.money += EARLY_SEND_PER_SECOND * Math.floor(state.buildTimer);
  }
  beginWave(state);
  return true;
}

/**
 * Count a build phase's timer down. Reaching `0` starts the wave, which is the
 * automatic start the world gate holds.
 */
export function advanceBuildTimer(state: MeltdownState, dt: number): void {
  if (state.phase !== "building") return;
  state.buildTimer = Math.max(0, state.buildTimer - dt);
  if (state.buildTimer > 0) return;
  if (!state.waveSpawning) return;
  beginWave(state);
}

/** The run won: every remaining life paid for, and the victory screen opened. */
export function winRun(state: MeltdownState): void {
  state.score += SCORE_VICTORY_PER_LIFE * state.lives;
  state.screen = "victory";
  state.menuIndex = 0;
}

/** The run lost, at once and whatever the phase. */
export function loseRun(state: MeltdownState): void {
  state.lives = 0;
  state.screen = "gameover";
  state.menuIndex = 0;
}

/** What settling the frame's removals produced. */
export interface ClearOutcome {
  cleared: boolean;
  won: boolean;
}

/**
 * Clear the wave when its last live unit has gone with none of it left to
 * release. `removed` is whether a unit left the roster on this frame, which is
 * what makes a phase that has released no unit never clear.
 */
export function settleWave(
  state: MeltdownState,
  removed: boolean,
): ClearOutcome {
  const outcome: ClearOutcome = { cleared: false, won: false };
  if (!removed) return outcome;
  if (state.phase !== "wave") return outcome;
  if (state.wavePending > 0 || state.surge.length > 0) return outcome;

  const cleared = state.wave;
  state.money += waveClearBonus(cleared);
  state.score += SCORE_WAVE_CLEAR * cleared;
  outcome.cleared = true;

  const figures = figuresOf(state);
  if (cleared >= figures.waveCount) {
    winRun(state);
    outcome.won = true;
    return outcome;
  }

  state.wave = cleared + 1;
  state.phase = "building";
  state.buildTimer = figures.buildPhases ? BUILD_PHASE_TIME : 0;
  state.spawnClock = 0;
  // Interest is taken on the money the wave-clear bonus has already left.
  if (figures.interest) state.money += interestOn(state.money);
  return outcome;
}
