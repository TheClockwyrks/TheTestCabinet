// Carom — the debugging and automation surface, `window.__carom`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// Almost every operation is expressed as a read or a pose of `CaromState`. That
// is the point of the split. These calls ARRANGE THE WORLD and never fabricate an
// outcome: they put the game into a situation, and the game's own `update` — the
// real collision, the real serve, the real AI — is what runs from there on the
// next frame. So a scenario driven from code behaves exactly like one played by
// hand.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Without them a scenario could only be driven by
// waiting, and a check that waits measures the machine it ran on. Everything else
// about driving a browser game stays absent: there is no `keyDown`, `keyUp` or
// `press` (the runtime's registered actions are driven by dispatching real key
// events at the page) and no overlay drawing or toggle (the runtime draws the
// panel and owns the backtick key).

import { CAROM_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
import { parkBall } from "./entities";
import {
  startMatch,
  toTitle,
  type CaromState,
  type Mode,
  type Screen,
  type Side,
} from "./game";

/** The `window` property the API is installed on. */
export const CAROM_HANDLE = "__carom";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

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

export interface CaromDebugApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;
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
 * Restore every declared field of the state to its title-screen value.
 *
 * The game's own return to the title does most of it; a reset additionally
 * starts the clock over, reseeds the generator, and hands the paddles back.
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again.
 */
function poseTitle(state: CaromState, seed: number): void {
  toTitle(state);
  state.simTime = 0;
  state.rngState = seed;
  state.driver.paddles = false;
  state.driver.ai = false;
  state.driver.vy.left = 0;
  state.driver.vy.right = 0;
}

/** Build the API over one live state object and the runtime driving it. */
export function createDebugApi(
  state: CaromState,
  clock: DebugClock,
): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * `false` stops the frame loop advancing the simulation from the wall clock,
     * so the game changes only when `advance` says so; `true` returns it to
     * running itself, which is how a build starts and how it is played. Drawing
     * is unaffected either way: the loop keeps rendering, so the canvas shows the
     * state the most recent frame left.
     *
     * It does not touch the paddles. Who is driving them is a separate question
     * from who is driving the clock, and a scenario that takes the game off real
     * time to watch the KEYBOARD move a paddle is exactly what the control checks
     * are.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — so
     * the game's own collision, serve and AI produce the result and the canvas
     * reflects it. Every rate in this game is integrated against the frame's
     * delta, so `advance(1, 1)` and `advance(1, 60)` cover the same second and
     * reach the same outcome, beyond the drift a change in step size explains.
     *
     * Advancing while the game is still stepping automatically ADDS to what the
     * wall clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      clock.advance(seconds, frames);
    },

    /**
     * Return to the title screen, handing the paddles back to the player and (in
     * Solo) the AI, and reseed the game's randomness.
     *
     * It does not touch the clock. A reset restores the declared fields of the
     * state, and whether the game is stepping itself is not one of them:
     * `setAutoStep` is how that is said, and a driver that resets mid-scenario
     * means to re-pose the world, not to hand it back to real time.
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
      startMatch(state, mode);
    },

    /**
     * Launch the ball now, ending the pre-serve countdown immediately instead of
     * waiting it out. On a live rally it re-serves: the ball is returned to its
     * spawn point and handed back to a countdown that has already elapsed.
     *
     * The launch itself is the game's. Expiring the countdown is what this call
     * does, so the ball leaves on the next frame the runtime advances, through the
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
export function installDebugApi(
  state: CaromState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[CAROM_HANDLE] = api;
  return () => {
    if (target[CAROM_HANDLE] === api) delete target[CAROM_HANDLE];
  };
}
