// Carom — the debugging and automation surface. CASE-PROVIDED. Do not edit.
//
// `window.__carom` is specified by `specs/instrumentation.md` and supplied here,
// already written, so the full surface exists in every build and behaves the same
// way in each. It is installed by `src/main.ts` as soon as the engine has
// initialized, and it is inert during normal play: nothing below runs until
// something calls it.
//
// Every operation is expressed as a read or a pose of `CaromState`. That is the
// point of the split. These calls ARRANGE THE WORLD and never fabricate an
// outcome: they put the game into a situation, and the game's own `update` — the
// real collision, the real serve, the real AI — is what runs from there when the
// engine advances a frame. So a scenario driven from code behaves exactly like
// one played by hand, and the only thing this file needs from the build is that
// the build honours the state it is handed.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// engine and is deliberately absent: there is no `step` or `setAutoStep` (the
// engine owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the engine's registered actions are driven directly), and no overlay drawing
// or toggle (the engine draws the panel and owns the backtick key).

import { FIELD_CX, FIELD_CY, HOLD_TIME } from "./constants";
import type { BallState, CaromState, Mode, Screen, Side } from "./game";

/** The `window` property the API is installed on. */
export const CAROM_HANDLE = "__carom";

/** The surface's version, reported as `version` and bumped when it changes. */
export const CAROM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The fields `setPaddle` may set. Anything omitted is left as it is. */
export interface PaddlePatch {
  /** Center y, in logical pixels. */
  cy?: number;
  /** Vertical velocity in px/s. It PERSISTS across frames, so the paddle is
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

/** Park the ball at its spawn point: motionless, and with no spin. */
function parkBall(ball: BallState): void {
  ball.x = FIELD_CX;
  ball.y = FIELD_CY;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
}

/**
 * Restore every declared field of the state to its title-screen value.
 *
 * `muted` is deliberately untouched: muting is a player preference the engine
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
  state.receiver = "left";
  state.holdTimer = 0;
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
  parkBall(state.ball);
  state.trail.length = 0;
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
     * It does not touch the clock: who advances time is the engine's business,
     * and a driver that wants the game off real time says so to the engine
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
     * Start a real match, exactly as choosing it from the menu would. The match
     * opens on the pre-serve countdown, with the first serve aimed at player one.
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
      state.receiver = "left";
      state.holdTimer = HOLD_TIME;
      state.paddles.left.cy = FIELD_CY;
      state.paddles.left.vy = 0;
      state.paddles.right.cy = FIELD_CY;
      state.paddles.right.vy = 0;
      parkBall(state.ball);
      state.trail.length = 0;
    },

    /**
     * Launch the ball now, ending the pre-serve countdown immediately instead of
     * waiting it out. On a live rally it re-serves: the ball is returned to its
     * spawn point and handed back to a countdown that has already elapsed.
     *
     * The launch itself is the game's. Expiring the countdown is what this call
     * does, so the ball leaves on the next frame the engine advances, through the
     * build's own serve — at SERVE_SPEED, toward `state.receiver`.
     */
    serve() {
      if (state.screen !== "countdown" && state.screen !== "playing") return;
      takeControl(state);
      if (state.screen === "playing") {
        parkBall(state.ball);
        state.trail.length = 0;
        state.screen = "countdown";
      }
      state.holdTimer = 0;
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
     * Place and aim a ball. `index` is `0`, selecting the single ball in play.
     */
    setBall(index, patch) {
      if (index !== 0) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has one ball, index 0`,
        );
      }
      takeControl(state);
      if (patch?.x !== undefined) state.ball.x = patch.x;
      if (patch?.y !== undefined) state.ball.y = patch.y;
      if (patch?.vx !== undefined) state.ball.vx = patch.vx;
      if (patch?.vy !== undefined) state.ball.vy = patch.vy;
      if (patch?.spin !== undefined) state.ball.spin = patch.spin;
    },

    /**
     * Hand the AI-controlled (right) paddle back to the computer opponent for the
     * rest of the driven scenario, so advancing the game runs the real AI against
     * the posed ball while the left paddle and the ball stay under the caller's
     * control. Solo only; `false` is the default, and `reset()` clears it.
     */
    setAiControl(enabled) {
      takeControl(state);
      state.driver.ai = Boolean(enabled);
    },
  };
}

/**
 * Install the API on `window.__carom` and return the function that removes it
 * again, while the installed object is still the one this call published.
 */
export function installDebugApi(state: CaromState): () => void {
  const api = createDebugApi(state);
  const target = window as unknown as Record<string, unknown>;
  target[CAROM_HANDLE] = api;
  return () => {
    if (target[CAROM_HANDLE] === api) delete target[CAROM_HANDLE];
  };
}
