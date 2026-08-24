// Carom (Multi-ball) — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi()` builds it, and `initialize` returns it beside the state it
// built, as `[state, createDebugApi()]`: the engine holds the second element and
// returns it from `engine.debug`, and that is the one way a caller reaches it. It
// reaches nothing global, and it is inert during normal play: nothing below runs
// until something calls it.
//
// Because the state is a value and nothing holds a writable one, the surface is
// written in the shape of `update`. A POSE takes the current state and returns
// the next — `serve(state)`, `setBall(state, index, patch)` — and a READING takes
// the state and returns what it read — `snapshot(state)`. A caller drives a pose
// through `engine.apply((s) => debug.serve(s))`, which stores what it returns as
// the state the next frame receives, and a reading through
// `debug.snapshot(engine.state)`. None of them reaches a state of its own; every
// one is a function of the state it is handed.
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

import { BALL_COUNT, CAROM_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
import { startMatch, toTitle } from "./flow";
import type { CaromState, Mode, Screen, Side } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The read-only view of the state every operation is handed. */
type State = DeepReadonly<CaromState>;

/** The fields `setPaddle` may set. Anything omitted is left as it is. */
export interface PaddlePatch {
  /** Center y, in logical pixels. */
  cy?: number;
  /** Vertical velocity in units per second. It PERSISTS across frames, so the
   * paddle is still moving when it strikes the ball, which is what drives the
   * spin mechanic. */
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

/**
 * The surface: one plain number, one reading, and seven poses.
 *
 * Every pose returns the next `CaromState` and leaves the one it was handed as
 * it was; a caller hands it to `engine.apply`. The reading returns a fresh plain
 * object and changes nothing.
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
}

/**
 * The state with the paddles taken from the player and the AI.
 *
 * Every control operation goes through this, because posing part of a scenario
 * while the keyboard or the opponent still moves a paddle would make the scenario
 * unreproducible. `reset()` gives them back.
 */
function takeControl(state: State): CaromState {
  return { ...state, driver: { ...state.driver, paddles: true } };
}

/**
 * Every declared field of the state at its title-screen value, the clock and the
 * driver included, with the generator reseeded.
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

/** Build the API. It holds nothing: every operation is over the state it is handed. */
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
     * The opening of a real match, exactly as choosing it from the menu would
     * pose it. The match opens with all three balls waiting on their home points,
     * so they launch together when the shared hold elapses.
     */
    startMatch(state, mode) {
      return startMatch(takeControl(state), mode);
    },

    /**
     * Every waiting ball's hold ended now, instead of waiting it out. A ball
     * already in flight is left exactly as it is, and on any screen but the two
     * live ones the state is returned as it was, the driver included.
     *
     * The launch itself is the game's. Expiring the hold is what this call does,
     * so each waiting ball leaves on the next frame the runtime advances, through
     * the build's own launch — at SERVE_SPEED, along a fresh random angle.
     */
    serve(state) {
      if (state.screen !== "countdown" && state.screen !== "playing") {
        return state;
      }
      const taken = takeControl(state);
      return {
        ...taken,
        balls: taken.balls.map((ball) =>
          ball.held ? { ...ball, holdTimer: 0 } : ball,
        ),
      };
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
      const paddle = taken.paddles[side];
      const posed = {
        cy: patch?.cy !== undefined ? patch.cy : paddle.cy,
        vy: patch?.vy !== undefined ? patch.vy : paddle.vy,
      };
      const driverVy =
        patch?.vy !== undefined
          ? { ...taken.driver.vy, [side]: patch.vy }
          : taken.driver.vy;
      return {
        ...taken,
        paddles: { ...taken.paddles, [side]: posed },
        driver: { ...taken.driver, vy: driverVy },
      };
    },

    /**
     * One of the three balls placed and aimed, `index` numbering them in play
     * order from 0.
     *
     * Posing a ball takes it into live play — `held` cleared and its hold timer
     * spent — so a scenario can drive one ball while parking the other two out of
     * the way. An index this variant does not have is refused before anything is
     * posed, so the state is left exactly as it was.
     */
    setBall(state, index, patch) {
      if (!Number.isInteger(index) || index < 0 || index >= BALL_COUNT) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has ${BALL_COUNT} balls, ` +
            `indices 0 to ${BALL_COUNT - 1}`,
        );
      }
      const taken = takeControl(state);
      return {
        ...taken,
        balls: taken.balls.map((ball, i) =>
          i === index
            ? {
                ...ball,
                x: patch?.x !== undefined ? patch.x : ball.x,
                y: patch?.y !== undefined ? patch.y : ball.y,
                vx: patch?.vx !== undefined ? patch.vx : ball.vx,
                vy: patch?.vy !== undefined ? patch.vy : ball.vy,
                spin: patch?.spin !== undefined ? patch.spin : ball.spin,
                held: false,
                holdTimer: 0,
              }
            : ball,
        ),
      };
    },

    /**
     * The AI-controlled (right) paddle handed back to the computer opponent for
     * the rest of the driven scenario, so advancing the game runs the real AI
     * against the posed balls while the left paddle and the balls stay under the
     * caller's control. Solo only; `false` is the default, and `reset()` clears
     * it.
     */
    setAiControl(state, enabled) {
      const taken = takeControl(state);
      return { ...taken, driver: { ...taken.driver, ai: Boolean(enabled) } };
    },
  };
}
