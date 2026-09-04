// Carom — the whole of the game's state, and the transitions that pose it.
//
// THE SHAPE BELOW IS A CONTRACT. specs/state.md declares every field this record
// carries, specs/instrumentation.md's `snapshot` reports each of them, and its
// operations pose them one at a time — so this file is where each field is
// declared once, under its declared name, with its declared meaning, and where
// the four transitions that touch many fields at once live: opening on the title,
// returning to it, resetting to it, and starting a match.
//
// Everything here is plain data: numbers, strings, booleans, and containers of
// them. Nothing in this build holds game state anywhere else — no module-level
// variable, no closure over mutable data — so a scenario is posed by assignment,
// read back the same way, and replayed exactly.
//
// The world is state as well. Which balls and which obstacles are on the field is
// something the debug surface changes (`clearWorld`, `spawnBall`,
// `spawnObstacle`), so the ball is a record or `null` and the obstacles are the
// ones present rather than a fixed pair.

import {
  DEFAULT_SEED,
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
} from "./constants";

/**
 * The top-level state machine (specs/ui.md). `countdown` and `playing` both
 * render the live field; the rest are menu or overlay screens.
 */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

/** The two screens a pause can resume to. */
export type ResumeScreen = "countdown" | "playing";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/** One paddle. `x` is fixed by the side, so only the vertical axis is state. */
export interface PaddleState {
  /** Center y, in logical units. Clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY]. */
  cy: number;
  /**
   * The paddle's actual vertical velocity for the frame, in units per second,
   * after the integration specs/playfield.md fixes. The spin mechanic reads it at
   * contact, so a paddle pinned against a bound reports zero even while a
   * movement action is held.
   */
  vy: number;
  /**
   * Whether the debug surface is moving this paddle rather than the player or the
   * AI. Only `setPaddleDriven` changes it, and it is inert during normal play.
   */
  driven: boolean;
  /**
   * The velocity a driven paddle moves at, in units per second. `setPaddleVy` is
   * the only pose that writes it; it holds across frames whether or not the
   * paddle is driven, and it reaches `vy` through the same integration everything
   * else does.
   */
  drivenVy: number;
}

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  x: number;
  y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  t: number;
}

/** The ball. `speed` is derived (`hypot(vx, vy)`) and is not stored. */
export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * The signed lateral-curvature scalar, in units per second squared. Positive
   * and negative curve the flight opposite ways; it decays by half every
   * SPIN_HALFLIFE seconds and changes otherwise only on a paddle hit.
   */
  spin: number;
  /**
   * Whether the ball waits at its home point rather than flying. It is the ball's
   * own flag: a pause leaves it exactly as it was.
   */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** Recent positions, oldest first, spanning the last TRAIL_TIME seconds. */
  trail: TrailSample[];
}

/** One obstacle on the field, at its fixed center. */
export interface ObstacleState {
  /** Its index in the order of OBSTACLE_CENTERS. */
  index: number;
  cx: number;
  cy: number;
}

/**
 * The AI's two faculties, each declared and each gated on its own
 * (specs/instrumentation.md): one decides whether it senses the ball, the other
 * whether its paddle travels toward what it sensed.
 */
export interface AiState {
  tracking: boolean;
  movement: boolean;
}

/**
 * The whole of Carom's state.
 *
 * Every field is present from the moment `createInitialState` returns, which is
 * why none is optional: by the time any frame can observe the state, all of it is
 * there.
 */
export interface CaromState {
  /** The screen currently shown (specs/ui.md). */
  screen: Screen;
  /** The mode the current or most recent match is played in. */
  mode: Mode;
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex: number;
  /** The title menu's remembered selection, which every return to it restores. */
  titleIndex: number;
  /** The screen the pause menu resumes to. */
  resumeScreen: ResumeScreen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  score: { p1: number; p2: number };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null;
  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match travels toward player one.
   */
  receiver: Side;

  paddles: Record<Side, PaddleState>;
  ai: AiState;
  /** The single ball, or null while no ball is on the field. */
  ball: BallState | null;
  /** The obstacles on the field, in the order of OBSTACLE_CENTERS. */
  obstacles: ObstacleState[];

  /** Accumulated simulation time, in seconds. Every update adds its delta. */
  simTime: number;
  /**
   * Mirrors the runtime's mute bit, refreshed every update. The runtime owns
   * muting; this is the game's readable copy of it (specs/audio.md).
   */
  muted: boolean;
  /** The seed the game's generator was last seeded from. */
  seed: number;
  /** That generator's whole state, as a single number. */
  rngState: number;
}

// ---- The world -----------------------------------------------------------

/** A paddle at rest on the field's center line, under whoever holds it. */
export function createPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/**
 * Park a ball at its home point: held, with a full hold timer, no motion, no
 * spin, and no trail.
 *
 * The one arrangement three rules share — the ball a match opens with, the ball a
 * scored point re-parks, and the ball `spawnBall` places — so it is written once.
 */
export function parkBall(ball: BallState): void {
  ball.x = FIELD_CX;
  ball.y = FIELD_CY;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
  ball.held = true;
  ball.holdTimer = HOLD_TIME;
  ball.trail.length = 0;
}

/** A ball placed as `spawnBall` places it. */
export function createBall(): BallState {
  const ball: BallState = {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: 0,
    vy: 0,
    spin: 0,
    held: true,
    holdTimer: HOLD_TIME,
    trail: [],
  };
  parkBall(ball);
  return ball;
}

/** Whether `index` names an obstacle of this field. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/**
 * Place obstacle `index` at its fixed center, replacing it if it is already
 * there. An index this field has no obstacle for places nothing.
 */
export function spawnObstacle(state: CaromState, index: number): void {
  if (!isObstacleIndex(index)) return;
  const center = OBSTACLE_CENTERS[index];
  const placed: ObstacleState = { index, cx: center.x, cy: center.y };
  const at = state.obstacles.findIndex((obstacle) => obstacle.index === index);
  if (at >= 0) {
    state.obstacles[at] = placed;
    return;
  }
  state.obstacles.push(placed);
  state.obstacles.sort((a, b) => a.index - b.index);
}

/** Every obstacle the field is built with, in the order of OBSTACLE_CENTERS. */
export function allObstacles(): ObstacleState[] {
  return OBSTACLE_CENTERS.map((center, index) => ({
    index,
    cx: center.x,
    cy: center.y,
  }));
}

/** Take every ball and every obstacle off the field. The paddles stay. */
export function clearWorld(state: CaromState): void {
  state.ball = null;
  state.obstacles = [];
}

// ---- Building and posing the state --------------------------------------

/** Stand both paddles on the field's center line, stationary. */
function centerPaddles(state: CaromState): void {
  for (const side of ["left", "right"] as const) {
    state.paddles[side].cy = FIELD_CY;
    state.paddles[side].vy = 0;
  }
}

/**
 * The complete initial state: the title screen, with every field present.
 *
 * Exported so this build's own tests can construct a state without standing a
 * runtime up around it.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    titleIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    paddles: { left: createPaddle(), right: createPaddle() },
    ai: { tracking: true, movement: true },
    ball: createBall(),
    obstacles: allObstacles(),
    simTime: 0,
    muted: false,
    seed: DEFAULT_SEED,
    rngState: DEFAULT_SEED,
  };
}

/**
 * Every declared field the title screen fixes, back to its title-screen value.
 *
 * The three transitions that reach the title differ only in what they do with the
 * five fields specs/ui.md carries across — `titleIndex`, `simTime`, `muted`,
 * `seed`, `rngState` — and with `menuIndex`, so all of that is left to the
 * callers below and none of it is touched here.
 */
function toTitleState(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.receiver = "left";
  state.paddles.left = createPaddle();
  state.paddles.right = createPaddle();
  state.ai.tracking = true;
  state.ai.movement = true;
  state.ball = createBall();
  state.obstacles = allObstacles();
}

/**
 * Return to the title the way the game does: quitting from the pause menu,
 * leaving the match-over screen, or backing out of how-to-play.
 *
 * `titleIndex`, `simTime`, `muted`, `seed` and `rngState` keep their values, and
 * the selection lands on the item that led away from the title (specs/ui.md).
 */
export function returnToTitle(state: CaromState): void {
  toTitleState(state);
  state.menuIndex = state.titleIndex;
}

/**
 * The debug surface's `reset`: the title-screen state, whole.
 *
 * Beyond a return to the title it also starts the clock over, reseeds the
 * generator, and puts both menu selections back at the first item. The mute bit
 * is deliberately untouched — it is a player preference the runtime owns — and so
 * is the auto-step setting, which is the clock's rather than the state's.
 */
export function resetState(state: CaromState): void {
  toTitleState(state);
  state.menuIndex = 0;
  state.titleIndex = 0;
  state.simTime = 0;
  state.seed = DEFAULT_SEED;
  state.rngState = DEFAULT_SEED;
}

/**
 * Start a match (specs/ui.md): SOLO and VERSUS on the title, RESTART on the pause
 * menu, and PLAY AGAIN on the match-over screen all come through here.
 *
 * The match opens on the pre-serve countdown with the first serve aimed at player
 * one, so every match opens the same way. `titleIndex` keeps its value, and so do
 * the paddles' driven flags and the AI's faculties: who is moving a paddle is not
 * something starting a match decides.
 */
export function startMatch(state: CaromState, mode: Mode): void {
  state.mode = mode;
  state.screen = "countdown";
  state.resumeScreen = "playing";
  state.menuIndex = 0;
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.receiver = "left";
  centerPaddles(state);
  if (state.ball === null) state.ball = createBall();
  else parkBall(state.ball);
}
