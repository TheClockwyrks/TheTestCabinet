// Kessler — the world's live game state, and the accessor every module
// reaches it through.
//
// THE STATE BELOW IS A CONTRACT. It is the world's game state —
// `engine.world.state` is the one instance of it — and it is what the debug
// surface in `src/debug.ts` poses and reads, with `specs/instrumentation.md`
// fixing the snapshot taken off it. The framework's states are LIVE objects:
// a tick writes the fields it advances in place, and each field initializer
// is that field's title-screen value, the same value `reset` restores. Every
// value carried from one frame to the next lives on it; nothing authoritative
// is kept in a module-level variable or a closure, and every other module is
// either arithmetic over these fields or a system that writes them through
// the paths play runs on.
//
// The class lives here, at a leaf of the module graph, so the actors, the
// controller, the effects layer, and the debug surface can all reach the
// state without importing `src/game.ts` — which imports all of them.
// `src/game.ts` re-exports both names as the module contract asks.

import { GameState } from "@test-cabinet/structured-2d";
import type { World } from "@test-cabinet/structured-2d";
import {
  DEFAULT_SEED,
  DEFLECTOR_START_ANGLE_DEG,
  START_LIVES,
  START_WAVE,
  type Screen,
} from "./constants";
import { seedRng } from "./rng";
import { filledRings, type RingState } from "./rings";
import {
  clearedEffects,
  type Ball,
  type Effects,
  type Pod,
  type Session,
} from "./session";

export class KesslerState extends GameState implements Session {
  /** The screen the game is on; a session opens on `title`. */
  screen: Screen = "title";
  /** The highlighted item of the current screen's menu, counted from 0. */
  menuIndex = 0;

  /** Ticks resolved since the last reset, whatever the screen. */
  ticks = 0;
  /**
   * Ticks of SIMULATION time resolved since the last reset — the ticks the
   * `playing` screen advanced on. The ball sprite's spin runs on this clock
   * (`specs/assets.md`), so it holds exactly where a pause left it while
   * `ticks` keeps counting the frozen screens' resolved ticks.
   */
  simTicks = 0;

  /** The running score (`specs/scoring.md`). */
  score = 0;
  /** The lives remaining. */
  lives = START_LIVES;
  /** The number of the wave in play. */
  wave = START_WAVE;

  /** The deflector's center angle, normalized into `[0, 360)`. */
  paddleAngleDeg = DEFLECTOR_START_ANGLE_DEG;
  /** The three rings, ring 1 (the innermost) first. */
  rings: RingState[] = filledRings(START_WAVE);
  /** Every live ball, in spawn order, oldest first. */
  balls: Ball[] = [];
  /** Every falling pod, in spawn order, oldest first. */
  pods: Pod[] = [];
  /** The effects in force: three whole-tick timers and the shield. */
  effects: Effects = clearedEffects();

  /** The `waveAdvance` driver switch; on when the game is played. */
  waveAdvance = true;
  /** The `podSpawn` driver switch; on when the game is played. */
  podSpawn = true;

  /** The seed the pod stream reseeds from at each session start. */
  seed = DEFAULT_SEED;
  /** The seeded pod stream's whole state; pod draws alone advance it. */
  rngState = seedRng(DEFAULT_SEED);
  /** The next ball or pod identity the session hands out. */
  nextId = 0;

  /** The rotation actions' held values, sampled by each tick's step 1. */
  readonly held = { left: false, right: false };
  /** Ticks left on the wave-clear interstitial while on `waveclear`. */
  interstitialTicks = 0;
  /**
   * The menu entry a pointer press is down inside, and the screen it went
   * down on. A release inside the same entry of the same screen accepts it
   * (`specs/controls.md`); anything else clears the latch and accepts
   * nothing. It is derived from the contact alone, so any pose leaves it
   * consistent: a pose that changes the screen leaves a press that can no
   * longer match.
   */
  pointerPress: { screen: Screen; entry: number } | null = null;
  /** Unconsumed game time carried between frames, in seconds. */
  accumulator = 0;
}

/**
 * The open world's state, as the state it is: the mode names `KesslerState`
 * as its `gameStateClass`, so this holds of every world this game opens, and
 * the check turns a wrong wiring into a named error instead of a silent cast.
 */
export function kesslerState(world: World): KesslerState {
  const state = world.state;
  if (!(state instanceof KesslerState)) {
    throw new Error("Kessler: the open world does not hold a KesslerState");
  }
  return state;
}
