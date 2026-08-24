// Carom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi()` builds it, and `initialize` returns it beside the state it
// built, as `[state, createDebugApi()]`: the engine holds the second element and
// returns it from `engine.debug`, and that is the one way a caller reaches it. It
// reaches nothing global, holds no state, and is inert during normal play:
// nothing below runs until something calls it.
//
// Every operation is written in the shape of `update`. A POSE takes the current
// state and returns the next one — `serve(state)`, `setBall(state, 0, patch)` —
// and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.serve(s))`, so the next frame receives what
// it left. A READING takes the state and returns what it read —
// `snapshot(engine.state)`. Nothing here holds a writable state, because nothing
// in the engine hands one out: the state is a value the engine replaces every
// frame, so a surface that closed over the object `initialize` built would pose a
// state no frame reads any more.
//
// That is the point of the split. These calls ARRANGE THE WORLD and never
// fabricate an outcome: they put the game into a situation, and the game's own
// `update` — the real collision, the real serve, the real AI — is what runs from
// there when the runtime advances a frame. So a scenario driven from code behaves
// exactly like one played by hand, and the only thing the surface needs from the
// rest of the game is that the game honours the state it is handed.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// runtime and is deliberately absent: there is no `step` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions are driven directly), and no overlay drawing
// or toggle (the runtime draws the panel and owns the backtick key).

import { CAROM_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
import type {
  BallState,
  CaromState,
  Mode,
  PaddleState,
  Screen,
  Side,
} from "./game";
import { parkBallAndTrail, startMatch, toTitle } from "./match";
import type { DeepReadonly } from "ts-essentials";

/** The fields `setPaddle` may set. Anything omitted is left as it is. */
export interface PaddlePatch {
  /** Center y, in logical pixels. */
  cy?: number;
  /** Vertical velocity in units per second. It PERSISTS across frames, so the paddle is
   * still moving when it strikes the ball, which is what drives the spin
   * mechanic. */
  vy?: number;
}

/** The fields `setBall` may set. Anything omitted is left as it is. */
export interface BallPatch {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity. */
  speed: number;
  spin: number;
  /** True while the ball is parked for its pre-serve countdown. */
  held: boolean;
}

export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: {
    left: { cy: number; vy: number };
    right: { cy: number; vy: number };
  };
  ball: BallSnapshot;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface. Every pose takes the current state and returns the next; the one
 * reading, `snapshot`, takes the current state and returns what it read.
 */
export interface CaromDebugApi {
  version: number;
  reset(
    state: DeepReadonly<CaromState>,
    options?: { seed?: number },
  ): CaromState;
  snapshot(state: DeepReadonly<CaromState>): CaromSnapshot;
  startMatch(state: DeepReadonly<CaromState>, mode: Mode): CaromState;
  serve(state: DeepReadonly<CaromState>): CaromState;
  setScore(state: DeepReadonly<CaromState>, p1: number, p2: number): CaromState;
  setPaddle(
    state: DeepReadonly<CaromState>,
    side: Side,
    patch?: PaddlePatch,
  ): CaromState;
  setBall(
    state: DeepReadonly<CaromState>,
    index: number,
    patch?: BallPatch,
  ): CaromState;
  setAiControl(state: DeepReadonly<CaromState>, enabled: boolean): CaromState;
}

/**
 * Take the paddles from the player and the AI.
 *
 * Every control operation goes through this, because posing part of a scenario
 * while the keyboard or the opponent still moves a paddle would make the scenario
 * unreproducible. `reset()` gives them back.
 */
function takeControl(state: CaromState): CaromState {
  return { ...state, driver: { ...state.driver, paddles: true } };
}

/** The paddles with one side replaced. */
function withPaddle(
  paddles: CaromState["paddles"],
  side: Side,
  paddle: PaddleState,
): CaromState["paddles"] {
  return side === "left"
    ? { ...paddles, left: paddle }
    : { ...paddles, right: paddle };
}

/** The driver's held velocities with one side replaced. */
function withHeldVy(
  vy: CaromState["driver"]["vy"],
  side: Side,
  value: number,
): CaromState["driver"]["vy"] {
  return side === "left" ? { ...vy, left: value } : { ...vy, right: value };
}

/**
 * Every declared field of the state at its title-screen value.
 *
 * `toTitle` is what quitting to the menu does; a reset additionally starts the
 * clock over, reseeds the generator, and hands the paddles back. `muted` is
 * deliberately untouched: muting is a player preference the runtime owns, and a
 * reset is not a reason to start making noise again.
 */
function poseTitle(state: CaromState, seed: number): CaromState {
  return {
    ...toTitle(state),
    simTime: 0,
    rngState: seed,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    /**
     * The title screen, with the paddles handed back to the player and (in Solo)
     * the AI, and the game's randomness reseeded.
     *
     * It does not touch the clock: who advances time is the runtime's business,
     * and a driver that wants the game off real time says so to the runtime
     * rather than to the game.
     */
    reset(state, options) {
      return poseTitle(state, options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read. It never changes anything. */
    snapshot(state) {
      return {
        version: CAROM_DEBUG_VERSION,
        screen: state.screen,
        mode: state.mode,
        score: { p1: state.score.p1, p2: state.score.p2 },
        winner: state.winner,
        muted: state.muted,
        paddles: {
          left: {
            cy: state.paddles.left.cy,
            vy: state.paddles.left.vy,
          },
          right: {
            cy: state.paddles.right.cy,
            vy: state.paddles.right.vy,
          },
        },
        ball: {
          x: state.ball.x,
          y: state.ball.y,
          vx: state.ball.vx,
          vy: state.ball.vy,
          speed: Math.hypot(state.ball.vx, state.ball.vy),
          spin: state.ball.spin,
          held: state.holdTimer > 0,
        },
        simTime: state.simTime,
      };
    },

    /**
     * The opening of a real match, exactly as choosing it from the menu would
     * pose it: the pre-serve countdown, with the first serve aimed at player one.
     */
    startMatch(state, mode) {
      return startMatch(takeControl(state), mode);
    },

    /**
     * The countdown expired now, so the ball launches on the next frame instead
     * of waiting the hold out. On a live rally it re-serves: the ball is returned
     * to its spawn point and handed back to a countdown that has already elapsed.
     *
     * The launch itself is the game's. Expiring the countdown is what this does,
     * so the ball leaves on the next frame the runtime advances, through the
     * build's own serve — at SERVE_SPEED, toward `state.receiver`.
     */
    serve(state) {
      if (state.screen !== "countdown" && state.screen !== "playing") {
        return state;
      }
      const taken = takeControl(state);
      const held =
        taken.screen === "playing"
          ? { ...parkBallAndTrail(taken), screen: "countdown" as const }
          : taken;
      return { ...held, holdTimer: 0 };
    },

    /**
     * The two scores set directly, as a precondition. The win and deuce rules
     * still resolve through real play, so drive a real point to end a match.
     */
    setScore(state, p1, p2) {
      return { ...takeControl(state), score: { p1, p2 } };
    },

    /**
     * A paddle posed or set moving. A `vy` set here persists across frames,
     * because it is the driver's held velocity rather than a one-frame nudge.
     */
    setPaddle(state, side, patch) {
      const taken = takeControl(state);
      const current = taken.paddles[side];
      const paddle: PaddleState = {
        cy: patch?.cy !== undefined ? patch.cy : current.cy,
        vy: patch?.vy !== undefined ? patch.vy : current.vy,
      };
      return {
        ...taken,
        paddles: withPaddle(taken.paddles, side, paddle),
        driver:
          patch?.vy !== undefined
            ? {
                ...taken.driver,
                vy: withHeldVy(taken.driver.vy, side, patch.vy),
              }
            : taken.driver,
      };
    },

    /**
     * A ball placed and aimed. `index` is `0`, selecting the single ball in play.
     */
    setBall(state, index, patch) {
      if (index !== 0) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has one ball, index 0`,
        );
      }
      const taken = takeControl(state);
      const ball: BallState = {
        x: patch?.x !== undefined ? patch.x : taken.ball.x,
        y: patch?.y !== undefined ? patch.y : taken.ball.y,
        vx: patch?.vx !== undefined ? patch.vx : taken.ball.vx,
        vy: patch?.vy !== undefined ? patch.vy : taken.ball.vy,
        spin: patch?.spin !== undefined ? patch.spin : taken.ball.spin,
      };
      return { ...taken, ball };
    },

    /**
     * The AI-controlled (right) paddle handed back to the computer opponent for
     * the rest of the driven scenario, so advancing the game runs the real AI
     * against the posed ball while the left paddle and the ball stay under the
     * caller's control. Solo only; `false` is the default, and `reset()` clears
     * it.
     */
    setAiControl(state, enabled) {
      const taken = takeControl(state);
      return { ...taken, driver: { ...taken.driver, ai: Boolean(enabled) } };
    },
  };
}
