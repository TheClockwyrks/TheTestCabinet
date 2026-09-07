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
// the next — `setScreen(state, "playing")`, `setBallPosition(state, 0, x, y)` —
// and a READING takes the state and returns what it read — `snapshot(state)`,
// `menuItemRect(state, index)`. A caller drives a pose through
// `engine.apply((s) => debug.setScreen(s, "playing"))`, which stores what it
// returns as the state the next frame receives, and a reading through
// `debug.snapshot(engine.state)`. None of them reaches a state of its own; every
// one is a function of the state it is handed.
//
// EVERY OPERATION IS ATOMIC. Each one sets one field, or one fixed pair of
// fields, or places or removes one entity, and leaves everything else exactly as
// it found it. There is no patch object and nothing that arranges several
// unrelated things at once, so a scenario is built by saying what it wants, one
// fact at a time, and nothing it did not ask for moves. `reset` is the sole
// exception, and it is a lifecycle verb rather than a pose: it restores every
// declared field at once, which is how a check gets back to a known start.
//
// That is the point of the split. These calls ARRANGE THE WORLD and never
// fabricate an outcome: they put the game into a situation, and the game's own
// `update` — the real collisions, the real launch, the real AI — is what runs
// from there when the runtime advances a frame. So a scenario driven from code
// behaves exactly like one played by hand, and the only thing the surface needs
// from the rest of the game is that the game honours the state it is handed.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// runtime and is deliberately absent: there is no `advance` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions are driven directly), and no overlay drawing
// or toggle (the runtime draws the panel and owns the backtick key).

import {
  BALL_COUNT,
  CAROM_DEBUG_VERSION,
  HOLD_TIME,
  OBSTACLE_CENTERS,
} from "./constants";
import { ballSpeed, makeObstacle, parkBall, placeByIndex } from "./entities";
import { createInitialState } from "./flow";
import { menuItemRect, type MenuRect } from "./menu";
import type {
  BallState,
  CaromState,
  Mode,
  ObstacleState,
  ResumeScreen,
  Screen,
  Side,
} from "./game";
import type { DeepReadonly } from "ts-essentials";
import { drawLaunchAngle } from "./random";

/** The read-only view of the state every operation is handed. */
type State = DeepReadonly<CaromState>;

/** One trail sample, as a snapshot reports it. */
export interface TrailSampleSnapshot {
  x: number;
  y: number;
  /** The simulation time the sample was recorded at, in seconds. */
  t: number;
}

/** One ball, as a snapshot reports it. */
export interface BallSnapshot {
  /** This ball's index in play order. */
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point for its own hold to elapse. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The angle, in radians, this ball's next launch leaves along. */
  launchAngle: number;
  /** This ball's trail samples, oldest first. */
  trail: TrailSampleSnapshot[];
}

/** One obstacle, as a snapshot reports it. */
export interface ObstacleSnapshot {
  /** Its index in the order of OBSTACLE_CENTERS. */
  index: number;
  cx: number;
  cy: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  cy: number;
  /** The velocity the last frame integrated. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than the player or the AI. */
  driven: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation of this surface sets appears here, so every operation
 * is verified by setting a value and reading it back. Five figures are read
 * rather than posed: `version`, a ball's `speed`, a paddle's `vy`, `muted`, and
 * `simTime`.
 */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The highlighted item on whichever menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection. */
  titleIndex: number;
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  /** Every ball present, in play order. */
  balls: BallSnapshot[];
  /** Every obstacle present, at its fixed center. */
  obstacles: ObstacleSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface: one plain number, two readings, and twenty-two poses, each of
 * them atomic.
 *
 * Every pose returns the next `CaromState` and leaves the one it was handed as
 * it was; a caller hands it to `engine.apply`. The readings return fresh plain
 * values and change nothing.
 */
export interface CaromDebugApi {
  version: number;

  /* The world. */
  clearWorld(state: State): CaromState;
  spawnBall(state: State, index: number): CaromState;
  spawnObstacle(state: State, index: number): CaromState;
  reset(state: State): CaromState;

  /* Screens and menus. */
  setScreen(state: State, screen: Screen): CaromState;
  setMode(state: State, mode: Mode): CaromState;
  setMenuIndex(state: State, index: number): CaromState;
  setTitleIndex(state: State, index: number): CaromState;
  setResumeScreen(state: State, screen: ResumeScreen): CaromState;

  /* Match state. */
  setScore(state: State, p1: number, p2: number): CaromState;
  setWinner(state: State, side: Side | null): CaromState;

  /* Paddles. */
  setPaddleCy(state: State, side: Side, cy: number): CaromState;
  setPaddleVy(state: State, side: Side, vy: number): CaromState;
  setPaddleDriven(state: State, side: Side, driven: boolean): CaromState;

  /* Balls. `index` comes first, selecting a ball in play order. */
  setBallPosition(
    state: State,
    index: number,
    x: number,
    y: number,
  ): CaromState;
  setBallVelocity(
    state: State,
    index: number,
    vx: number,
    vy: number,
  ): CaromState;
  setBallSpin(state: State, index: number, spin: number): CaromState;
  setBallHeld(state: State, index: number, held: boolean): CaromState;
  setBallHoldTimer(state: State, index: number, seconds: number): CaromState;
  setBallLaunchAngle(state: State, index: number, angle: number): CaromState;
  drawBallLaunchAngle(state: State, index: number): CaromState;

  /* The AI opponent: one operation per faculty. */
  setAiTracking(state: State, enabled: boolean): CaromState;
  setAiMovement(state: State, enabled: boolean): CaromState;

  /* Audio. */

  /** Sets the mute bit, the same bit the `mute` action toggles. */
  setMuted(state: State, muted: boolean): CaromState;

  /* Readings. */
  snapshot(state: State): CaromSnapshot;
  menuItemRect(state: State, index: number): MenuRect | null;
}

/** Whether `index` names one of the balls this variant plays with. */
function isBallIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < BALL_COUNT;
}

/** Whether `index` names one of the obstacles the field has. */
function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/**
 * `state` with ball `index` replaced by `change` applied to it.
 *
 * An operation naming an absent ball, or an index this variant does not have,
 * leaves the state exactly as it was (specs/instrumentation.md).
 */
function withBall(
  state: State,
  index: number,
  change: (ball: DeepReadonly<BallState>) => BallState,
): CaromState {
  if (!isBallIndex(index)) return state;
  let touched = false;
  const balls = state.balls.map((ball) => {
    if (ball.index !== index) return ball;
    touched = true;
    return change(ball);
  });
  return touched ? { ...state, balls } : state;
}

/** `state` with one side's paddle replaced by `change` applied to it. */
function withPaddle(
  state: State,
  side: Side,
  change: (
    paddle: CaromState["paddles"]["left"],
  ) => CaromState["paddles"]["left"],
): CaromState {
  return {
    ...state,
    paddles: { ...state.paddles, [side]: change(state.paddles[side]) },
  };
}

/** Build the surface. It holds nothing: every operation is over the state it is handed. */
export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The world ------------------------------------------------------

    /**
     * The field emptied of every ball and every obstacle. The paddles stay, and
     * so does everything else the state carries.
     */
    clearWorld(state) {
      return { ...state, balls: [], obstacles: [] };
    },

    /**
     * Ball `index` back on its own home point, held, with a full hold timer,
     * zero velocity, zero spin, and an empty trail — whether it was absent or
     * already in play.
     */
    spawnBall(state, index) {
      if (!isBallIndex(index)) return state;
      return {
        ...state,
        balls: placeByIndex<BallState>(state.balls, parkBall(index, HOLD_TIME)),
      };
    },

    /** Obstacle `index` back at `OBSTACLE_CENTERS[index]`. */
    spawnObstacle(state, index) {
      if (!isObstacleIndex(index)) return state;
      return {
        ...state,
        obstacles: placeByIndex<ObstacleState>(
          state.obstacles,
          makeObstacle(index),
        ),
      };
    },

    /**
     * The game back at its title screen: every declared field at the value
     * specs/state.md gives it, with the world placed exactly as `spawnBall` and
     * `spawnObstacle` place it, and the clock at zero.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     */
    reset(state) {
      return { ...createInitialState(), muted: state.muted };
    },

    // ---- Screens and menus ----------------------------------------------

    setScreen(state, screen) {
      return { ...state, screen };
    },

    setMode(state, mode) {
      return { ...state, mode };
    },

    setMenuIndex(state, index) {
      return { ...state, menuIndex: index };
    },

    setTitleIndex(state, index) {
      return { ...state, titleIndex: index };
    },

    setResumeScreen(state, screen) {
      return { ...state, resumeScreen: screen };
    },

    // ---- Match state ----------------------------------------------------

    /**
     * The two scores set directly, as a precondition. The win and deuce rules
     * still resolve through real play, so drive a real point to end a match.
     */
    setScore(state, p1, p2) {
      return { ...state, score: { p1, p2 } };
    },

    setWinner(state, side) {
      return { ...state, winner: side };
    },

    // ---- Paddles --------------------------------------------------------

    setPaddleCy(state, side, cy) {
      return withPaddle(state, side, (paddle) => ({ ...paddle, cy }));
    },

    /**
     * That side's `drivenVy`, the velocity a driven paddle travels at. It holds
     * across frames whether or not the paddle is driven, and it is NOT the
     * paddle's `vy`, which is what the last frame actually integrated.
     */
    setPaddleVy(state, side, vy) {
      return withPaddle(state, side, (paddle) => ({ ...paddle, drivenVy: vy }));
    },

    /**
     * That side taken from the player, or handed back. Driving one side leaves
     * the other exactly as it was, so a scenario can drive one paddle and let the
     * real AI or a real player work the other.
     */
    setPaddleDriven(state, side, driven) {
      return withPaddle(state, side, (paddle) => ({ ...paddle, driven }));
    },

    // ---- Balls ----------------------------------------------------------

    setBallPosition(state, index, x, y) {
      return withBall(state, index, (ball) => ({ ...ball, x, y }));
    },

    setBallVelocity(state, index, vx, vy) {
      return withBall(state, index, (ball) => ({ ...ball, vx, vy }));
    },

    setBallSpin(state, index, spin) {
      return withBall(state, index, (ball) => ({ ...ball, spin }));
    },

    setBallHeld(state, index, held) {
      return withBall(state, index, (ball) => ({ ...ball, held }));
    },

    /**
     * The seconds remaining of that ball's hold. `0` ends it: the ball launches
     * on the next advanced frame through the game's own rule, at SERVE_SPEED
     * along a fresh angle drawn from the generator.
     */
    setBallHoldTimer(state, index, seconds) {
      return withBall(state, index, (ball) => ({
        ...ball,
        holdTimer: seconds,
      }));
    },

    /** The angle ball `index`'s next launch leaves along, in radians. */
    setBallLaunchAngle(state, index, angle) {
      return withBall(state, index, (ball) => ({
        ...ball,
        launchAngle: angle,
      }));
    },

    /** The one draw parking makes, made again on its own (specs/balls.md). */
    drawBallLaunchAngle(state, index) {
      return withBall(state, index, (ball) => ({
        ...ball,
        launchAngle: drawLaunchAngle(),
      }));
    },

    // ---- The AI opponent ------------------------------------------------

    /**
     * Whether the AI senses the balls and chooses a target. With it off the AI
     * targets AI_HOME_Y with AI_HOME_DEADZONE, whatever the balls are doing.
     */
    setAiTracking(state, enabled) {
      return { ...state, ai: { ...state.ai, tracking: enabled } };
    },

    /**
     * Whether the AI's paddle travels toward its target. With it off the paddle
     * stays where it is, with a `vy` of 0.
     */
    setAiMovement(state, enabled) {
      return { ...state, ai: { ...state.ai, movement: enabled } };
    },

    // ---- Audio ----------------------------------------------------------

    /**
     * The mute bit set. The state carries it and `game.update` brings the
     * engine's bus into line with it on the next frame.
     */
    setMuted(state, muted) {
      return { ...state, muted: Boolean(muted) };
    },

    // ---- Readings -------------------------------------------------------

    /** A pure read. It never changes anything. */
    snapshot(state) {
      return {
        version: CAROM_DEBUG_VERSION,
        screen: state.screen,
        mode: state.mode,
        menuIndex: state.menuIndex,
        titleIndex: state.titleIndex,
        resumeScreen: state.resumeScreen,
        score: { p1: state.score.p1, p2: state.score.p2 },
        winner: state.winner,
        muted: state.muted,
        paddles: {
          left: snapshotPaddle(state.paddles.left),
          right: snapshotPaddle(state.paddles.right),
        },
        ai: { tracking: state.ai.tracking, movement: state.ai.movement },
        balls: state.balls.map((ball) => ({
          index: ball.index,
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: ballSpeed(ball),
          spin: ball.spin,
          held: ball.held,
          holdTimer: ball.holdTimer,
          launchAngle: ball.launchAngle,
          trail: ball.trail.map((sample) => ({
            x: sample.x,
            y: sample.y,
            t: sample.t,
          })),
        })),
        obstacles: state.obstacles.map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.cx,
          cy: obstacle.cy,
        })),
        simTime: state.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — the build's own layout, reported, so a caller drives the
     * menus with a pointer at the places the build actually put them.
     */
    menuItemRect(state, index) {
      return menuItemRect(state.screen, index);
    },
  };
}

/** One paddle read out for a snapshot. */
function snapshotPaddle(
  paddle: DeepReadonly<CaromState["paddles"]["left"]>,
): PaddleSnapshot {
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}
