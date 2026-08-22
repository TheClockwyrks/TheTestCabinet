// Carom (Multi-ball) — the debugging and automation surface. CASE-PROVIDED. Do
// not edit.
//
// The surface is specified by `specs/instrumentation.md` and supplied here,
// already written, so it exists in every build and behaves the same way in each.
// The build hands it to the engine from its own `initialize`
// (`api.debug.expose(createDebugApi(state))`), and a caller reads it back off
// `engine.debug`. It reaches nothing global, and it is inert during normal play:
// nothing below runs until something calls it.
//
// Every operation is expressed as a read or a pose of `CaromState`. That is the
// point of the split. These calls ARRANGE THE WORLD and never fabricate an
// outcome: they put the game into a situation, and the game's own `update` — the
// real collision, the real serve, the real AI — is what runs from there when the
// runtime advances a frame. So a scenario driven from code behaves exactly like
// one played by hand, and the only thing this file needs from the build is that
// the build honours the state it is handed.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// runtime and is deliberately absent: there is no `step` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions are driven directly), and no overlay drawing
// or toggle (the runtime draws the panel and owns the backtick key).

import { BALL_COUNT, BALL_HOMES, FIELD_CY, HOLD_TIME } from "./constants";
import type { BallState, CaromState, Mode, Screen, Side } from "./game";

/** The surface's version, reported as `version` and bumped when it changes. */
export const CAROM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

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
  /** True while the ball waits at its home point for its own hold to elapse. */
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
  /** All three balls, in play order. */
  balls: BallSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

export interface CaromDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): CaromSnapshot;
  startMatch(mode: Mode): void;
  serve(): void;
  setScore(p1: number, p2: number): void;
  setPaddle(side: Side, state?: PaddlePatch): void;
  setBall(index: number, state?: BallPatch): void;
  setAiControl(enabled: boolean): void;
}

/**
 * Take the paddles from the player and the AI.
 *
 * Every control operation calls this, because posing part of a scenario while
 * the keyboard or the opponent still moves a paddle would make the scenario
 * unreproducible. `reset()` gives them back.
 */
function takeControl(state: CaromState): void {
  state.driver.paddles = true;
}

/**
 * Put one ball back on its own home point: motionless, spinless, and with an
 * empty trail. `hold` is the wait it starts, `0` leaving it parked and unheld,
 * which is the title screen's pose.
 */
function parkBall(ball: BallState, index: number, hold: number): void {
  const home = BALL_HOMES[index];
  ball.x = home.x;
  ball.y = home.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
  ball.held = hold > 0;
  ball.holdTimer = hold;
  ball.trail.length = 0;
}

/** Put every ball back on its own home point. */
function parkBalls(state: CaromState, hold: number): void {
  for (let i = 0; i < BALL_COUNT; i++) parkBall(state.balls[i], i, hold);
}

/**
 * Restore every declared field of the state to its title-screen value.
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again.
 */
function poseTitle(state: CaromState, seed: number): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = 0;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
  parkBalls(state, 0);
  state.simTime = 0;
  state.rngState = seed;
  state.driver.paddles = false;
  state.driver.ai = false;
  state.driver.vy.left = 0;
  state.driver.vy.right = 0;
}

/** Build the API over one live state object. */
export function createDebugApi(state: CaromState): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    /**
     * Return to the title screen, handing the paddles back to the player and (in
     * Solo) the AI, and reseed the game's randomness.
     *
     * It does not touch the clock: who advances time is the runtime's business,
     * and a driver that wants the game off real time says so to the runtime
     * rather than to the game.
     */
    reset(options) {
      poseTitle(state, options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read. It never changes anything. */
    snapshot() {
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
        balls: state.balls.map((ball) => ({
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: Math.hypot(ball.vx, ball.vy),
          spin: ball.spin,
          held: ball.held,
        })),
        simTime: state.simTime,
      };
    },

    /**
     * Start a real match, exactly as choosing it from the menu would. The match
     * opens with all three balls waiting on their home points, so they launch
     * together when the shared hold elapses.
     */
    startMatch(mode) {
      takeControl(state);
      state.mode = mode;
      state.screen = "countdown";
      state.resumeScreen = "playing";
      state.menuIndex = 0;
      state.score.p1 = 0;
      state.score.p2 = 0;
      state.winner = null;
      state.paddles.left.cy = FIELD_CY;
      state.paddles.left.vy = 0;
      state.paddles.right.cy = FIELD_CY;
      state.paddles.right.vy = 0;
      parkBalls(state, HOLD_TIME);
    },

    /**
     * Launch every waiting ball now, ending its hold immediately instead of
     * waiting it out. A ball already in flight is left exactly as it is.
     *
     * The launch itself is the game's. Expiring the hold is what this call does,
     * so each waiting ball leaves on the next frame the runtime advances, through
     * the build's own launch — at SERVE_SPEED, along a fresh random angle.
     */
    serve() {
      if (state.screen !== "countdown" && state.screen !== "playing") return;
      takeControl(state);
      for (const ball of state.balls) {
        if (ball.held) ball.holdTimer = 0;
      }
    },

    /**
     * Set the two scores directly, as a precondition. The win and deuce rules
     * still resolve through real play, so drive a real point to end a match.
     */
    setScore(p1, p2) {
      takeControl(state);
      state.score.p1 = p1;
      state.score.p2 = p2;
    },

    /**
     * Pose or move a paddle. A `vy` set here persists across frames, because it
     * is the driver's held velocity rather than a one-frame nudge.
     */
    setPaddle(side, patch) {
      takeControl(state);
      if (patch?.cy !== undefined) state.paddles[side].cy = patch.cy;
      if (patch?.vy !== undefined) {
        state.paddles[side].vy = patch.vy;
        state.driver.vy[side] = patch.vy;
      }
    },

    /**
     * Place and aim one of the three balls, `index` numbering them in play order
     * from 0.
     *
     * Posing a ball takes it into live play — `held` cleared and its hold timer
     * spent — so a scenario can drive one ball while parking the other two out of
     * the way.
     */
    setBall(index, patch) {
      if (!Number.isInteger(index) || index < 0 || index >= BALL_COUNT) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has ${BALL_COUNT} balls, ` +
            `indices 0 to ${BALL_COUNT - 1}`,
        );
      }
      takeControl(state);
      const ball = state.balls[index];
      if (patch?.x !== undefined) ball.x = patch.x;
      if (patch?.y !== undefined) ball.y = patch.y;
      if (patch?.vx !== undefined) ball.vx = patch.vx;
      if (patch?.vy !== undefined) ball.vy = patch.vy;
      if (patch?.spin !== undefined) ball.spin = patch.spin;
      ball.held = false;
      ball.holdTimer = 0;
    },

    /**
     * Hand the AI-controlled (right) paddle back to the computer opponent for the
     * rest of the driven scenario, so advancing the game runs the real AI against
     * the posed balls while the left paddle and the balls stay under the caller's
     * control. Solo only; `false` is the default, and `reset()` clears it.
     */
    setAiControl(enabled) {
      takeControl(state);
      state.driver.ai = Boolean(enabled);
    },
  };
}
