// Carom — the debugging and automation surface.
//
// The surface is specified by specs/instrumentation.md and implemented here.
// `createDebugApi()` builds it, and `initialize` returns it beside the state it
// built, as `[state, createDebugApi()]`: the engine holds the second element and
// returns it from `engine.debug`, and that is the one way a caller reaches it. It
// reaches nothing global, holds no state, and is inert during normal play:
// nothing below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. Each one sets ONE field, or one fixed pair of
// fields, or places or removes ONE entity, or reads the state. There is no
// operation that takes a partial object and merges it, and none that arranges
// several unrelated things at once. `reset` is the sole exception, and it is a
// lifecycle verb rather than a pose: it restores every declared field at once,
// which is how a scenario gets back to a known start.
//
// Every operation is written in the shape of `update`. A POSE takes the current
// state and returns the next one — `setScreen(state, "playing")` — and a caller
// drives it through the engine, as
// `engine.apply((s) => engine.debug.setScreen(s, "playing"))`, so the next frame
// receives what it left. A READING takes the state and returns what it read —
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
// runtime and is deliberately absent: there is no `advance` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions are driven directly), and no overlay drawing
// or toggle (the runtime draws the panel and owns the backtick key).

import { CAROM_DEBUG_VERSION } from "./constants";
import { ballSpeed, homeBall, isObstacleIndex, obstacleAt } from "./entities";
import type {
  AiState,
  BallState,
  CaromState,
  Mode,
  ObstacleState,
  PaddleState,
  ResumeScreen,
  Screen,
  Side,
} from "./game";
import { itemRect, menuFor, type MenuRect } from "./menus";
import { createInitialState } from "./match";
import { seedState } from "./rng";
import type { DeepReadonly } from "ts-essentials";

export type { MenuRect };

/** One trail sample, as a snapshot reports it. */
export interface TrailSampleSnapshot {
  x: number;
  y: number;
  /** The simulation time the sample was recorded at, in seconds. */
  t: number;
}

/** The ball, as a snapshot reports it. This variant has one, and it has no index. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point rather than flying. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The ball's trail samples, oldest first. */
  trail: TrailSampleSnapshot[];
}

/** One obstacle present in the field, as a snapshot reports it. */
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
 * rather than posed: `version`, the ball's `speed`, a paddle's `vy`, `muted`, and
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
  /** The screen a pause resumes to. */
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  /** The winning side once the match is over. */
  winner: Side | null;
  /** Whether the mute toggle is currently on. */
  muted: boolean;
  /** The seed the generator was last seeded from. */
  seed: number;
  /** That generator's current state, as a single number. */
  rngState: number;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  /** The AI's two faculties, each gated on its own. */
  ai: { tracking: boolean; movement: boolean };
  /** The side the next serve travels toward. */
  receiver: Side;
  /** The ball, or `null` while no ball is present. */
  ball: BallSnapshot | null;
  /** Every obstacle present, each entry under its own index. */
  obstacles: ObstacleSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface. Every pose takes the current state and returns the next; the two
 * readings take the current state and return what they read.
 */
export interface CaromDebugApi {
  version: number;

  /* The world. */

  /** Removes every ball and every obstacle. The paddles stay. */
  clearWorld(state: DeepReadonly<CaromState>): CaromState;
  /** Places the ball at its home point, held, with an empty trail. */
  spawnBall(state: DeepReadonly<CaromState>): CaromState;
  /** Places obstacle `index` at `OBSTACLE_CENTERS[index]`. */
  spawnObstacle(state: DeepReadonly<CaromState>, index: number): CaromState;
  /** Returns the game to its title-screen state. Leaves `muted` alone. */
  reset(state: DeepReadonly<CaromState>): CaromState;
  /** Seeds the game's random generator, setting `seed` and `rngState`. */
  setSeed(state: DeepReadonly<CaromState>, seed: number): CaromState;

  /* Screens and menus. */

  setScreen(state: DeepReadonly<CaromState>, screen: Screen): CaromState;
  setMode(state: DeepReadonly<CaromState>, mode: Mode): CaromState;
  /** Sets the highlighted item on whichever menu the current screen shows. */
  setMenuIndex(state: DeepReadonly<CaromState>, index: number): CaromState;
  /** Sets the title menu's remembered selection. */
  setTitleIndex(state: DeepReadonly<CaromState>, index: number): CaromState;
  /** Sets the screen a pause resumes to. */
  setResumeScreen(
    state: DeepReadonly<CaromState>,
    screen: ResumeScreen,
  ): CaromState;

  /* Match state. */

  /** Sets both scores: a fixed pair, not a patch. */
  setScore(state: DeepReadonly<CaromState>, p1: number, p2: number): CaromState;
  /** Sets the winning side, or clears it with `null`. */
  setWinner(state: DeepReadonly<CaromState>, side: Side | null): CaromState;
  /** Sets the side the next serve travels toward. */
  setReceiver(state: DeepReadonly<CaromState>, side: Side): CaromState;

  /* Paddles. */

  /** Sets that paddle's center y. */
  setPaddleCy(
    state: DeepReadonly<CaromState>,
    side: Side,
    cy: number,
  ): CaromState;
  /** Sets that paddle's `drivenVy`, and leaves its `vy` as it is. */
  setPaddleVy(
    state: DeepReadonly<CaromState>,
    side: Side,
    vy: number,
  ): CaromState;
  /** Takes that paddle from the player, or hands it back. */
  setPaddleDriven(
    state: DeepReadonly<CaromState>,
    side: Side,
    driven: boolean,
  ): CaromState;

  /* The ball. */

  /** Places the ball. */
  setBallPosition(
    state: DeepReadonly<CaromState>,
    x: number,
    y: number,
  ): CaromState;
  /** Sets the ball's velocity, in units per second. */
  setBallVelocity(
    state: DeepReadonly<CaromState>,
    vx: number,
    vy: number,
  ): CaromState;
  /** Sets the ball's spin, in units per second squared. */
  setBallSpin(state: DeepReadonly<CaromState>, spin: number): CaromState;
  /** Sets whether the ball waits at its home point rather than flying. */
  setBallHeld(state: DeepReadonly<CaromState>, held: boolean): CaromState;
  /** Sets the seconds remaining of the ball's hold. `0` ends it. */
  setBallHoldTimer(
    state: DeepReadonly<CaromState>,
    seconds: number,
  ): CaromState;

  /* The AI opponent: one operation per faculty. */

  /** Whether the AI senses the ball and chooses a target. */
  setAiTracking(state: DeepReadonly<CaromState>, enabled: boolean): CaromState;
  /** Whether the AI's paddle travels toward that target. */
  setAiMovement(state: DeepReadonly<CaromState>, enabled: boolean): CaromState;

  /* Audio. */

  /** Sets the mute bit, the same bit the `mute` action toggles. */
  setMuted(state: DeepReadonly<CaromState>, muted: boolean): CaromState;

  /* Readings. */

  /** The whole declared state. */
  snapshot(state: DeepReadonly<CaromState>): CaromSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on `countdown` and `playing`, which show no menu, or when `index`
   * names no item of that menu.
   */
  menuItemRect(state: DeepReadonly<CaromState>, index: number): MenuRect | null;
}

// ---- The small edits every pose is built from ---------------------------

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

/** The state with one field of one paddle changed and nothing else. */
function posePaddle(
  state: DeepReadonly<CaromState>,
  side: Side,
  patch: Partial<PaddleState>,
): CaromState {
  const paddle: PaddleState = { ...state.paddles[side], ...patch };
  return { ...state, paddles: withPaddle(state.paddles, side, paddle) };
}

/**
 * The state with one field of the ball changed and nothing else.
 *
 * Every ball operation has no effect while the ball is absent
 * (specs/instrumentation.md), which is what the `null` guard says.
 */
function poseBall(
  state: DeepReadonly<CaromState>,
  patch: Partial<BallState>,
): CaromState {
  if (state.ball === null) return state;
  const ball: BallState = { ...state.ball, ...patch };
  return { ...state, ball };
}

/** The state with one of the AI's two faculties changed and nothing else. */
function poseAi(
  state: DeepReadonly<CaromState>,
  patch: Partial<AiState>,
): CaromState {
  const ai: AiState = { ...state.ai, ...patch };
  return { ...state, ai };
}

/** The obstacles with `obstacle` present, kept in index order. */
function withObstacle(
  obstacles: readonly ObstacleState[],
  obstacle: ObstacleState,
): readonly ObstacleState[] {
  return [
    ...obstacles.filter((other) => other.index !== obstacle.index),
    obstacle,
  ].sort((a, b) => a.index - b.index);
}

// ---- The readings -------------------------------------------------------

function ballSnapshot(
  ball: DeepReadonly<BallState> | null,
): BallSnapshot | null {
  if (ball === null) return null;
  return {
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    speed: ballSpeed(ball),
    spin: ball.spin,
    held: ball.held,
    holdTimer: ball.holdTimer,
    trail: ball.trail.map((sample) => ({
      x: sample.x,
      y: sample.y,
      t: sample.t,
    })),
  };
}

function paddleSnapshot(paddle: DeepReadonly<PaddleState>): PaddleSnapshot {
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The world -----------------------------------------------------

    /**
     * The field emptied of every ball and every obstacle. The paddles stay,
     * because both of them are always present (specs/state.md).
     */
    clearWorld(state) {
      return { ...state, ball: null, obstacles: [] };
    },

    /**
     * The ball at its home point, held for the full wait, with an empty trail.
     * Spawning a ball that is already present returns it to that arrangement.
     */
    spawnBall(state) {
      return { ...state, ball: homeBall() };
    },

    /**
     * Obstacle `index` at its fixed center. Spawning one already present returns
     * it there; an index outside the field's obstacles changes nothing.
     */
    spawnObstacle(state, index) {
      if (!isObstacleIndex(index)) return state;
      return {
        ...state,
        obstacles: withObstacle(state.obstacles, obstacleAt(index)),
      };
    },

    /**
     * The title screen, whole: every declared field back to the value
     * specs/state.md gives it, with the world placed exactly as `spawnBall` and
     * `spawnObstacle` place it, the paddles handed back, both of the AI's
     * faculties on, the clock at zero, and the generator reseeded from
     * DEFAULT_SEED.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     *
     * It does not touch the frame loop: who advances time is the runtime's
     * business, and a driver that wants the game off real time says so to the
     * runtime rather than to the game.
     */
    reset(state) {
      return { ...createInitialState(), muted: state.muted };
    },

    /** The generator seeded afresh: `seed` as given, `rngState` at its start. */
    setSeed(state, seed) {
      return { ...state, seed, rngState: seedState(seed) };
    },

    // ---- Screens and menus ---------------------------------------------

    /**
     * The screen alone. The scores, the world and the menu indices are left as
     * they are, and the screen it sets then behaves exactly as specs/ui.md
     * states for that screen.
     */
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

    // ---- Match state ---------------------------------------------------

    /**
     * Both scores, as a precondition. The win and deuce rules still resolve
     * through real play, so drive a real point to end a match.
     */
    setScore(state, p1, p2) {
      return { ...state, score: { p1, p2 } };
    },

    setWinner(state, side) {
      return { ...state, winner: side };
    },

    setReceiver(state, side) {
      return { ...state, receiver: side };
    },

    // ---- Paddles -------------------------------------------------------

    setPaddleCy(state, side, cy) {
      return posePaddle(state, side, { cy });
    },

    /**
     * The velocity a driven paddle moves at. It is a field of its own: `vy` is
     * the velocity the last frame integrated, whoever moved the paddle, so this
     * leaves `vy` alone and reaches it on the first frame advanced with that side
     * driven. It holds its value across frames whether or not the paddle is
     * driven.
     */
    setPaddleVy(state, side, vy) {
      return posePaddle(state, side, { drivenVy: vy });
    },

    /**
     * One side taken from the player, or handed back. Driving one side leaves
     * the other as it was, and no other pose touches either side's flag.
     */
    setPaddleDriven(state, side, driven) {
      return posePaddle(state, side, { driven });
    },

    // ---- The ball ------------------------------------------------------

    setBallPosition(state, x, y) {
      return poseBall(state, { x, y });
    },

    setBallVelocity(state, vx, vy) {
      return poseBall(state, { vx, vy });
    },

    setBallSpin(state, spin) {
      return poseBall(state, { spin });
    },

    setBallHeld(state, held) {
      return poseBall(state, { held });
    },

    /**
     * The seconds remaining of the hold. `0` ends it, and the ball is then served
     * on the next advanced frame through the game's own rule (specs/balls.md).
     */
    setBallHoldTimer(state, seconds) {
      return poseBall(state, { holdTimer: seconds });
    },

    // ---- The AI opponent -----------------------------------------------

    setAiTracking(state, enabled) {
      return poseAi(state, { tracking: enabled });
    },

    setAiMovement(state, enabled) {
      return poseAi(state, { movement: enabled });
    },

    // ---- Audio ---------------------------------------------------------

    /**
     * The mute bit set. The state carries it and `game.update` brings the
     * engine's bus into line with it on the next frame.
     */
    setMuted(state, muted) {
      return { ...state, muted: Boolean(muted) };
    },

    // ---- Readings ------------------------------------------------------

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
        seed: state.seed,
        rngState: state.rngState,
        paddles: {
          left: paddleSnapshot(state.paddles.left),
          right: paddleSnapshot(state.paddles.right),
        },
        ai: { tracking: state.ai.tracking, movement: state.ai.movement },
        receiver: state.receiver,
        ball: ballSnapshot(state.ball),
        obstacles: state.obstacles.map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.cx,
          cy: obstacle.cy,
        })),
        simTime: state.simTime,
      };
    },

    /**
     * The hit region the build laid out for item `index` of the menu the current
     * screen shows, in logical units — the same layout `src/render.ts` draws
     * from, so a pointer selects exactly what the player sees.
     */
    menuItemRect(state, index) {
      const menu = menuFor(state.screen);
      return menu === null ? null : itemRect(menu, index);
    },
  };
}
