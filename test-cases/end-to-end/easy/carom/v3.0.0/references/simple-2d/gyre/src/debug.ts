// Carom (Gyre) — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `initialize` returns it beside the opening state, as
// `[createInitialState(), createDebugApi()]`: the engine holds the second element
// and returns it from `engine.debug`, and that is the one way a caller reaches
// it. It reaches nothing global, and it is inert during normal play: nothing
// below runs until something calls it.
//
// Every operation is written in the shape of `update`, because nothing in this
// build may hold a writable state. A POSE takes the current state and returns
// the next — `serve(state)`, `setBall(state, 0, patch)` — and a caller drives it
// through `engine.apply((s) => engine.debug.serve(s))`, which is what makes the
// next frame's `update` receive what the pose left. A READING takes the state
// and returns what it read — `snapshot(engine.state)`. The surface is therefore
// built over no state at all: `createDebugApi()` takes nothing, and the one
// value it carries is `version`.
//
// These calls ARRANGE THE WORLD and never fabricate an outcome: they put the
// game into a situation, and the game's own `update` — the real collision, the
// real serve, the real AI — is what runs from there when the runtime advances a
// frame. So a scenario driven from code behaves exactly like one played by hand,
// and the only thing the surface needs from the rest of the game is that the
// game honours the state it is handed.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// runtime and is deliberately absent: there is no `step` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions are driven directly), and no overlay drawing
// or toggle (the runtime draws the panel and owns the backtick key).

import { CAROM_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
import { parkedBall } from "./entities";
import type { CaromState, Mode, Screen, Side } from "./game";
import { startMatch, toTitle } from "./match";
import type { DeepReadonly } from "ts-essentials";

/** The current state as every operation below reads it. */
type State = DeepReadonly<CaromState>;

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

/** One obstacle's live pose, exactly as the oriented collision sees it. */
export interface ObstacleSnapshot {
  /** Live center x, in logical pixels. */
  cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
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
  /**
   * Both obstacles' live poses, in the order of OBSTACLE_CENTERS. Read straight
   * off `state.obstacles`, which the game recomputes from the obstacle clock
   * every frame — so this reports the pose of the LAST frame that ran, and a
   * scenario that has just posed the clock should advance one frame before
   * reading it.
   */
  obstacles: ObstacleSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface. Every member but `version` is a transition (state in, next state
 * out) or a reading (state in, value out) over `CaromState`.
 */
export interface CaromDebugApi {
  version: number;
  reset(state: State, options?: { seed?: number }): CaromState;
  snapshot(state: State): CaromSnapshot;
  startMatch(state: State, mode: Mode): CaromState;
  serve(state: State): CaromState;
  setScore(state: State, p1: number, p2: number): CaromState;
  setPaddle(state: State, side: Side, patch?: PaddlePatch): CaromState;
  setBall(state: State, index: number, patch?: BallPatch): CaromState;
  setAiControl(state: State, enabled: boolean): CaromState;
  setObstacleClock(state: State, t: number): CaromState;
}

/**
 * The state with the paddles taken from the player and the AI.
 *
 * Every control operation goes through this, because posing part of a scenario
 * while the keyboard or the opponent still moves a paddle would make the
 * scenario unreproducible. `reset()` gives them back.
 */
function takeControl(state: State): CaromState {
  return { ...state, driver: { ...state.driver, paddles: true } };
}

/**
 * Every declared field of the state at its title-screen value.
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again.
 */
function poseTitle(state: State, seed: number): CaromState {
  return {
    ...toTitle(state),
    simTime: 0,
    rngState: seed,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/**
 * Return to the title screen, handing the paddles back to the player and (in
 * Solo) the AI, and reseed the game's randomness.
 *
 * It does not touch the clock: who advances time is the runtime's business, and
 * a driver that wants the game off real time says so to the runtime rather than
 * to the game.
 */
export function reset(state: State, options?: { seed?: number }): CaromState {
  return poseTitle(state, options?.seed ?? DEFAULT_SEED);
}

/** A pure read. It never changes anything. */
export function snapshot(state: State): CaromSnapshot {
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
    obstacles: state.obstacles.map((o) => ({
      cx: o.cx,
      cy: o.cy,
      theta: o.theta,
    })),
    simTime: state.simTime,
  };
}

/**
 * A real match, started exactly as choosing it from the menu would. The match
 * opens on the pre-serve countdown, with the first serve aimed at player one.
 */
export function startMatchOp(state: State, mode: Mode): CaromState {
  return startMatch(takeControl(state), mode);
}

/**
 * The ball launched now, ending the pre-serve countdown immediately instead of
 * waiting it out. On a live rally it re-serves: the ball is returned to its
 * spawn point and handed back to a countdown that has already elapsed.
 *
 * The launch itself is the game's. Expiring the countdown is what this does, so
 * the ball leaves on the next frame the runtime advances, through the build's
 * own serve — at SERVE_SPEED, toward `state.receiver`. On any other screen the
 * state is returned as it was.
 */
export function serve(state: State): CaromState {
  if (state.screen !== "countdown" && state.screen !== "playing") return state;
  const held = takeControl(state);
  const parked: CaromState =
    held.screen === "playing"
      ? { ...held, ball: parkedBall(), trail: [], screen: "countdown" }
      : held;
  return { ...parked, holdTimer: 0 };
}

/**
 * The two scores set directly, as a precondition. The win and deuce rules
 * still resolve through real play, so drive a real point to end a match.
 */
export function setScore(state: State, p1: number, p2: number): CaromState {
  return { ...takeControl(state), score: { p1, p2 } };
}

/**
 * A paddle posed or moved. A `vy` set here persists across frames, because it
 * is the driver's held velocity rather than a one-frame nudge.
 */
export function setPaddle(
  state: State,
  side: Side,
  patch?: PaddlePatch,
): CaromState {
  const held = takeControl(state);
  const paddle = held.paddles[side];
  const cy = patch?.cy !== undefined ? patch.cy : paddle.cy;
  const vy = patch?.vy !== undefined ? patch.vy : paddle.vy;
  const driverVy =
    patch?.vy !== undefined
      ? { ...held.driver.vy, [side]: patch.vy }
      : held.driver.vy;
  return {
    ...held,
    paddles: { ...held.paddles, [side]: { cy, vy } },
    driver: { ...held.driver, vy: driverVy },
  };
}

/** A ball placed and aimed. `index` is `0`, selecting the single ball in play. */
export function setBall(
  state: State,
  index: number,
  patch?: BallPatch,
): CaromState {
  if (index !== 0) {
    throw new RangeError(
      `Carom: setBall index ${index} — this variant has one ball, index 0`,
    );
  }
  const held = takeControl(state);
  const ball = held.ball;
  return {
    ...held,
    ball: {
      x: patch?.x !== undefined ? patch.x : ball.x,
      y: patch?.y !== undefined ? patch.y : ball.y,
      vx: patch?.vx !== undefined ? patch.vx : ball.vx,
      vy: patch?.vy !== undefined ? patch.vy : ball.vy,
      spin: patch?.spin !== undefined ? patch.spin : ball.spin,
    },
  };
}

/**
 * The AI-controlled (right) paddle handed back to the computer opponent for the
 * rest of the driven scenario, so advancing the game runs the real AI against
 * the posed ball while the left paddle and the ball stay under the caller's
 * control. Solo only; `false` is the default, and `reset()` clears it.
 */
export function setAiControl(state: State, enabled: boolean): CaromState {
  const held = takeControl(state);
  return { ...held, driver: { ...held.driver, ai: Boolean(enabled) } };
}

/**
 * The obstacles posed by setting the obstacle clock and holding them there.
 *
 * `t = 0` is upright at the base centers; a larger `t` sways and rotates them
 * exactly as normal play would at that moment. Because this is a control
 * operation it takes the paddles, and while `driver.paddles` is true the game
 * holds the obstacle clock still rather than advancing it with the frame — so a
 * scenario faces one chosen, known orientation instead of obstacles sweeping
 * through the shot. `reset()` returns to normal, moving obstacles.
 *
 * Only the CLOCK is set here. The poses themselves are the game's, recomputed
 * from this clock on its next frame, which is why a scenario advances a frame
 * before reading `snapshot().obstacles` back.
 */
export function setObstacleClock(state: State, t: number): CaromState {
  return { ...takeControl(state), obstacleClock: t };
}

/** The surface, as `initialize` returns it beside the opening state. */
export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,
    reset,
    snapshot,
    startMatch: startMatchOp,
    serve,
    setScore,
    setPaddle,
    setBall,
    setAiControl,
    setObstacleClock,
  };
}
