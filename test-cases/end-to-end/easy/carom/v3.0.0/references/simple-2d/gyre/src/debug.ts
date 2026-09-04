// Carom (Gyre) — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `initialize` returns it beside the opening state, as
// `[createInitialState(), createDebugApi()]`: the engine holds the second element
// and returns it from `engine.debug`, and that is the one way a caller reaches
// it. It reaches nothing global, and it is inert during normal play: nothing
// below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. Each one sets ONE field, or one fixed pair of
// fields, or places or removes ONE entity, or reads the state. There is no
// operation that takes a partial object and merges it, and none that arranges
// several unrelated things at once — so a check that wants a driven left paddle
// and a live AI on the right can have exactly that, and a check about the real
// controls is a check about controls nothing took away. `reset` is the sole
// exception, and it is a lifecycle verb rather than a pose: it restores every
// declared field at once, which is how a check gets back to a known start.
//
// Every operation is written in the shape of `update`, because nothing in this
// build may hold a writable state. A POSE takes the current state and returns
// the next — `setScreen(state, "playing")` — and a caller drives it through
// `engine.apply((s) => engine.debug.setScreen(s, "playing"))`, which is what
// makes the next frame's `update` receive what the pose left. A READING takes the
// state and returns what it read — `snapshot(engine.state)`,
// `menuItemRect(engine.state, 1)`. The surface is therefore built over no state
// at all: `createDebugApi()` takes nothing, and the one value it carries is
// `version`.
//
// These calls ARRANGE THE WORLD and never fabricate an outcome: they put the
// game into a situation, and the game's own `update` — the real collision, the
// real serve, the real AI — is what runs from there when the runtime advances a
// frame. So a scenario driven from code behaves exactly like one played by hand.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to the
// runtime and is deliberately absent: there is no `advance` or `setAutoStep` (the
// runtime owns the clock and runs exact frames), no `keyDown`, `keyUp` or `press`
// (the runtime's registered actions and pointer are driven directly), and no
// overlay drawing or toggle (the runtime draws the panel and owns the backtick
// key).

import { CAROM_DEBUG_VERSION } from "./constants";
import { ballSpeed, parkedBall } from "./entities";
import type {
  BallState,
  CaromState,
  Mode,
  ObstacleState,
  PaddleState,
  Screen,
  Side,
  TrailSample,
} from "./game";
import { menuItemRect as rectOf, type MenuRect } from "./menus";
import { withObstacle } from "./obstacles";
import { resetToTitle, withObstacleClock } from "./screens";
import type { DeepReadonly } from "ts-essentials";

/** The current state as every operation below reads it. */
type State = DeepReadonly<CaromState>;

/** The two screens a pause can resume to, which `resumeScreen` holds. */
export type ResumeScreen = "countdown" | "playing";

export type { MenuRect };

/** One ball, as a snapshot reports it. */
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
  trail: TrailSample[];
}

/** One obstacle's live pose, exactly as the oriented collision sees it. */
export interface ObstacleSnapshot {
  /** Its index in the order of OBSTACLE_CENTERS. */
  index: number;
  /** Live center x, in logical units. */
  cx: number;
  /** Live center y, in logical units: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  cy: number;
  /** The velocity the last frame integrated, in units per second. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side, held across frames. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than a player or the AI. */
  driven: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation of this surface sets appears here, so every operation
 * is verified by setting a value and reading it back. Five figures are READ
 * rather than posed: `version`, a ball's `speed`, a paddle's `vy`, `muted`, and
 * `simTime`.
 */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  titleIndex: number;
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  seed: number;
  rngState: number;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  receiver: Side;
  /** The ball, or `null` while no ball is present. */
  ball: BallSnapshot | null;
  /** Every obstacle present, each entry under its own index. */
  obstacles: ObstacleSnapshot[];
  obstacleClock: number;
  obstacleClockRunning: boolean;
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`.
 *
 * Each pose is a transition — the current state in, the next state out — and the
 * two readings read the current state. None of them touches the state it was
 * handed: `DeepReadonly<CaromState>` is the view the engine hands out, and the
 * compiler is what says a pose returns a new value rather than mutating.
 */
export interface CaromDebugApi {
  version: number;

  /* The world. */

  clearWorld(state: State): CaromState;
  spawnBall(state: State): CaromState;
  spawnObstacle(state: State, index: number): CaromState;
  reset(state: State): CaromState;
  setSeed(state: State, seed: number): CaromState;

  /* Screens and menus. */

  setScreen(state: State, screen: Screen): CaromState;
  setMode(state: State, mode: Mode): CaromState;
  setMenuIndex(state: State, index: number): CaromState;
  setTitleIndex(state: State, index: number): CaromState;
  setResumeScreen(state: State, screen: ResumeScreen): CaromState;

  /* Match state. */

  setScore(state: State, p1: number, p2: number): CaromState;
  setWinner(state: State, side: Side | null): CaromState;
  setReceiver(state: State, side: Side): CaromState;

  /* Paddles. */

  setPaddleCy(state: State, side: Side, cy: number): CaromState;
  setPaddleVy(state: State, side: Side, vy: number): CaromState;
  setPaddleDriven(state: State, side: Side, driven: boolean): CaromState;

  /* The ball. Gyre plays with one, so none of these takes an index. */

  setBallPosition(state: State, x: number, y: number): CaromState;
  setBallVelocity(state: State, vx: number, vy: number): CaromState;
  setBallSpin(state: State, spin: number): CaromState;
  setBallHeld(state: State, held: boolean): CaromState;
  setBallHoldTimer(state: State, seconds: number): CaromState;

  /* The AI opponent: one operation per faculty. */

  setAiTracking(state: State, enabled: boolean): CaromState;
  setAiMovement(state: State, enabled: boolean): CaromState;

  /* Audio. */

  /** Sets the mute bit, the same bit the `mute` action toggles. */
  setMuted(state: State, muted: boolean): CaromState;

  /* The obstacle clock: gyre's alone. */

  setObstacleClock(state: State, t: number): CaromState;
  setObstacleClockRunning(state: State, running: boolean): CaromState;

  /* Readings. */

  snapshot(state: State): CaromSnapshot;
  menuItemRect(state: State, index: number): MenuRect | null;
}

// ---- The world ----------------------------------------------------------

/**
 * The field emptied: no ball, no obstacles. The paddles stay, because a paddle is
 * field furniture the game always has.
 *
 * This is the isolation a check leans on: an entity a check is not about is
 * REMOVED rather than parked somewhere harmless, so an escaped bystander cannot
 * make one check report another check's defect.
 */
export function clearWorld(state: State): CaromState {
  return { ...state, ball: null, obstacles: [] };
}

/**
 * The ball placed at its home point, held, with a full hold timer, zero velocity,
 * zero spin, and an empty trail. Spawning one that is already there returns it to
 * exactly that arrangement.
 */
export function spawnBall(state: State): CaromState {
  return { ...state, ball: parkedBall() };
}

/**
 * Obstacle `index` placed in the pose specs/playfield.md's formulas give it at the
 * CURRENT obstacle clock, so it stands exactly where the obstacles already on the
 * field stand. An index naming no obstacle leaves the field as it is.
 */
export function spawnObstacle(state: State, index: number): CaromState {
  return {
    ...state,
    obstacles: withObstacle(state.obstacles, index, state.obstacleClock),
  };
}

/**
 * The game returned to its title-screen state: every declared field at the value
 * specs/state.md gives it, with the world placed exactly as `spawnBall` and
 * `spawnObstacle` place it.
 *
 * `muted` alone is left as it is, and the clock is untouched: who advances time
 * is the runtime's business, and a caller that wants the game off real time says
 * so to the runtime rather than to the game.
 */
export function reset(state: State): CaromState {
  return resetToTitle(state);
}

/**
 * The game's random generator seeded: `seed` becomes the value given, and
 * `rngState` becomes that generator's starting state.
 *
 * mulberry32 is seeded by its state word, so the two are the same number here —
 * they are reported separately because `rngState` moves with every draw and
 * `seed` does not.
 */
export function setSeed(state: State, seed: number): CaromState {
  return { ...state, seed, rngState: seed };
}

// ---- Screens and menus --------------------------------------------------

/**
 * The current screen, and NOTHING else: the scores, the world and the menu
 * indices are left as they are, and the screen set then behaves exactly as
 * specs/ui.md states for that screen.
 */
export function setScreen(state: State, screen: Screen): CaromState {
  return { ...state, screen };
}

export function setMode(state: State, mode: Mode): CaromState {
  return { ...state, mode };
}

export function setMenuIndex(state: State, index: number): CaromState {
  return { ...state, menuIndex: index };
}

export function setTitleIndex(state: State, index: number): CaromState {
  return { ...state, titleIndex: index };
}

export function setResumeScreen(
  state: State,
  screen: ResumeScreen,
): CaromState {
  return { ...state, resumeScreen: screen };
}

// ---- Match state --------------------------------------------------------

/**
 * Both scores, as a precondition. The win and deuce rules still resolve through
 * real play, so a match ends when a real point is driven.
 */
export function setScore(state: State, p1: number, p2: number): CaromState {
  return { ...state, score: { p1, p2 } };
}

export function setWinner(state: State, side: Side | null): CaromState {
  return { ...state, winner: side };
}

export function setReceiver(state: State, side: Side): CaromState {
  return { ...state, receiver: side };
}

// ---- Paddles ------------------------------------------------------------

/** One side's paddle with `patch` applied, leaving the other side alone. */
function withPaddle(
  state: State,
  side: Side,
  patch: Partial<PaddleState>,
): CaromState {
  return {
    ...state,
    paddles: { ...state.paddles, [side]: { ...state.paddles[side], ...patch } },
  };
}

/**
 * That paddle's center y. It is set as given rather than clamped, so a caller
 * reads back what it wrote; the next frame that moves the paddle clamps it by the
 * one rule specs/playfield.md fixes.
 */
export function setPaddleCy(state: State, side: Side, cy: number): CaromState {
  return withPaddle(state, side, { cy });
}

/**
 * That paddle's `drivenVy` — the velocity it travels at while it is DRIVEN — and
 * nothing else. Its `vy` is left as it is, because `vy` is the velocity the last
 * frame actually integrated, which a pose cannot fabricate: a `drivenVy` set
 * while the paddle stands still reaches `vy` on the first frame advanced with
 * that side driven.
 *
 * `drivenVy` is held across frames whether or not the paddle is driven, so a
 * paddle posed with a velocity is still swinging when a ball reaches it.
 */
export function setPaddleVy(state: State, side: Side, vy: number): CaromState {
  return withPaddle(state, side, { drivenVy: vy });
}

/**
 * That paddle taken from the player, or handed back — ONE side, leaving the other
 * exactly as it was. It is the only pose that changes whose paddle a paddle is.
 */
export function setPaddleDriven(
  state: State,
  side: Side,
  driven: boolean,
): CaromState {
  return withPaddle(state, side, { driven });
}

// ---- The ball -----------------------------------------------------------

/**
 * The ball with `patch` applied, or the state as it was while no ball is present:
 * every ball operation has no effect on an empty field
 * (specs/instrumentation.md).
 */
function withBall(state: State, patch: Partial<BallState>): CaromState {
  if (!state.ball) return state;
  return { ...state, ball: { ...state.ball, ...patch } };
}

export function setBallPosition(
  state: State,
  x: number,
  y: number,
): CaromState {
  return withBall(state, { x, y });
}

export function setBallVelocity(
  state: State,
  vx: number,
  vy: number,
): CaromState {
  return withBall(state, { vx, vy });
}

export function setBallSpin(state: State, spin: number): CaromState {
  return withBall(state, { spin });
}

export function setBallHeld(state: State, held: boolean): CaromState {
  return withBall(state, { held });
}

/**
 * The seconds remaining of the ball's hold. `0` ends it, and the ball is served
 * on the next advanced frame through the game's own rule (specs/balls.md) rather
 * than by this operation.
 */
export function setBallHoldTimer(state: State, seconds: number): CaromState {
  return withBall(state, { holdTimer: seconds });
}

// ---- The AI opponent ----------------------------------------------------

/** Whether the AI senses the ball and chooses a target. */
export function setAiTracking(state: State, enabled: boolean): CaromState {
  return { ...state, ai: { ...state.ai, tracking: enabled } };
}

/** Whether the AI's paddle travels toward that target. */
export function setAiMovement(state: State, enabled: boolean): CaromState {
  return { ...state, ai: { ...state.ai, movement: enabled } };
}

// ---- Audio --------------------------------------------------------------

/**
 * The mute bit set. The state carries it and `game.update` brings the engine's
 * bus into line with it on the next frame.
 */
export function setMuted(state: State, muted: boolean): CaromState {
  return { ...state, muted: Boolean(muted) };
}

// ---- The obstacle clock -------------------------------------------------

/**
 * The obstacle clock at `t` seconds, with both obstacles taking the pose that
 * value gives them on this very frame — the clock is the sole input to the poses,
 * so the two can never be read apart.
 */
export function setObstacleClock(state: State, t: number): CaromState {
  return withObstacleClock(state, t);
}

/**
 * Whether the clock advances with the frame. While it does not, it keeps its
 * value across frames and both obstacles hold their poses, which is how a
 * scenario faces one chosen, known orientation instead of obstacles sweeping
 * through the shot. The freeze is its own gate: it takes nothing else away.
 */
export function setObstacleClockRunning(
  state: State,
  running: boolean,
): CaromState {
  return { ...state, obstacleClockRunning: running };
}

// ---- Readings -----------------------------------------------------------

function ballView(ball: DeepReadonly<BallState>): BallSnapshot {
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

function obstacleView(obstacle: DeepReadonly<ObstacleState>): ObstacleSnapshot {
  return {
    index: obstacle.index,
    cx: obstacle.cx,
    cy: obstacle.cy,
    theta: obstacle.theta,
  };
}

function paddleView(paddle: DeepReadonly<PaddleState>): PaddleSnapshot {
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}

/** A pure read of the whole declared state. It never changes anything. */
export function snapshot(state: State): CaromSnapshot {
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
      left: paddleView(state.paddles.left),
      right: paddleView(state.paddles.right),
    },
    ai: { tracking: state.ai.tracking, movement: state.ai.movement },
    receiver: state.receiver,
    ball: state.ball ? ballView(state.ball) : null,
    obstacles: state.obstacles.map(obstacleView),
    obstacleClock: state.obstacleClock,
    obstacleClockRunning: state.obstacleClockRunning,
    simTime: state.simTime,
  };
}

/**
 * The hit region of item `index` on the menu the current screen shows, in logical
 * units, or `null` on `countdown` and `playing`, which show no menu, and when
 * `index` names no item of that menu.
 *
 * This is the BUILD's own layout reported, not a layout the specification fixed:
 * `src/menus.ts` declares it once and `src/render.ts` draws from the same table,
 * so the region a pointer selects from is the region the item was drawn in.
 */
export function menuItemRect(state: State, index: number): MenuRect | null {
  return rectOf(state.screen, index);
}

/** The surface, as `initialize` returns it beside the opening state. */
export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,
    clearWorld,
    spawnBall,
    spawnObstacle,
    reset,
    setSeed,
    setScreen,
    setMode,
    setMenuIndex,
    setTitleIndex,
    setResumeScreen,
    setScore,
    setWinner,
    setReceiver,
    setPaddleCy,
    setPaddleVy,
    setPaddleDriven,
    setBallPosition,
    setBallVelocity,
    setBallSpin,
    setBallHeld,
    setBallHoldTimer,
    setAiTracking,
    setAiMovement,
    setMuted,
    setObstacleClock,
    setObstacleClockRunning,
    snapshot,
    menuItemRect,
  };
}
