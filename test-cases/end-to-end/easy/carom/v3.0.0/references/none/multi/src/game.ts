// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the runtime drives.
//
// A `Game<S>` is three functions and a state type. `initialize` runs once, when
// the runtime is initialized, and returns the state. `update` and `render` then
// run once each per frame — `update` first, with the frame's delta time in
// SECONDS, then `render`. The state is the only channel between them.
//
// There is no fixed timestep here and no accumulator. Every rate in
// `src/constants.ts` is per second and every one of them is multiplied by `dt`,
// which is what makes the simulation depend on how much TIME has passed rather
// than on how many frames have gone by: the same second of play reaches the same
// state whether it arrived as one long step, as a hundred short ones, or as an
// uneven mixture. That is the property specs/balls.md requires and the property
// the debug surface in `src/debug.ts` leans on.
//
// THE STATE SHAPE BELOW IS A CONTRACT. It is what the debug surface reads and
// poses, and what this case's checks read back. So:
//
//   * Every field `specs/state.md` declares is here, under its declared name,
//     with its declared type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     this one is arithmetic over the record below. `reset()` on the debug
//     surface restores exactly these fields, so a scenario replays identically.

import {
  BALL_COUNT,
  BALL_R,
  CUES,
  DEFAULT_SEED,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  P2_X0,
  PADDLE_SPEED,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import {
  createBalls,
  createObstacles,
  integratePaddle,
  parkBall,
  spawnBall,
} from "./entities";
import { updateAi } from "./ai";
import {
  back,
  confirm,
  menuDown,
  menuUp,
  mute,
  p1Axis,
  p2Axis,
  pause,
  registerActions,
  soloAxis,
} from "./input";
import { menuItemAt, menuItemCount } from "./menu";
import { step } from "./physics";
import type { PointerSample } from "./pointing";
import { renderGame } from "./render";
import { nextAngle, seedRandom } from "./rng";
import { recordTrail } from "./trail";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";

/**
 * The top-level state machine (specs/ui.md). `countdown` and `playing` both
 * render the live field; the rest are menu or overlay screens.
 */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "matchover";

/** The two screens a pause can resume to, which `resumeScreen` holds. */
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
   * The paddle's actual vertical velocity this frame, in units per second, after
   * the integration `specs/playfield.md` fixes. This is what the spin mechanic
   * reads at contact, so a paddle pinned against a bound reports zero even while
   * a movement action is held.
   */
  vy: number;
  /**
   * Whether the debug surface is moving this paddle rather than the player or the
   * AI. Each side is taken and handed back on its own (specs/instrumentation.md).
   */
  driven: boolean;
  /**
   * The velocity a driven paddle moves at, in units per second. It is set by
   * `setPaddleVy` alone and HOLDS ACROSS FRAMES whether or not the paddle is
   * driven, which is what lets a driven paddle really be swinging at the moment
   * it strikes.
   */
  drivenVy: number;
}

/**
 * The AI's two faculties, each declared state and each gated on its own
 * (specs/state.md).
 */
export interface AiState {
  /** Whether the AI senses the balls and chooses a target. */
  tracking: boolean;
  /** Whether the AI's paddle travels toward that target. */
  movement: boolean;
}

/**
 * One ball. `speed` is derived (`hypot(vx, vy)`) and is not stored.
 *
 * Every field is that ball's own, which is the whole of what makes the three
 * independent: they carry separate velocities, separate spin, separate holds, and
 * separate trails (specs/balls.md).
 */
export interface BallState {
  /** This ball's place in play order, from 0 to BALL_COUNT - 1. */
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * The signed lateral-curvature scalar (magnitude in units per second squared).
   * Positive and negative curve the flight opposite ways; it decays by half every
   * SPIN_HALFLIFE seconds and changes otherwise only on a paddle hit.
   */
  spin: number;
  /**
   * True while the ball waits at its home point rather than flying. A waiting
   * ball is motionless and SOLID: another ball that reaches it bounces off, and
   * it launches when its own hold timer elapses and at no other moment.
   */
  held: boolean;
  /**
   * Seconds remaining of that wait. HOLD_TIME when the ball takes its home point,
   * counting down to 0, at which point it launches.
   */
  holdTimer: number;
  /** This ball's recent positions, oldest first, for its own motion trail. */
  trail: TrailSample[];
}

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  x: number;
  y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  t: number;
}

/** One obstacle, at its fixed center in the order of `OBSTACLE_CENTERS`. */
export interface ObstacleState {
  index: number;
  cx: number;
  cy: number;
}

/**
 * The whole of Carom's state (specs/state.md).
 *
 * Every field is present from the moment `initialize` returns, and every one is
 * plain data: numbers, strings, booleans and containers of them, so a scenario
 * can be posed by assignment and read back the same way.
 */
export interface CaromState {
  /** The screen currently shown (specs/ui.md). */
  screen: Screen;
  /** The mode the current or most recent match is played in. */
  mode: Mode;
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex: number;
  /** The title menu's remembered selection: what a return to the title restores. */
  titleIndex: number;
  /** The screen the pause menu resumes to. */
  resumeScreen: ResumeScreen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  score: { p1: number; p2: number };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null;

  /** The two paddles, both always present. */
  paddles: { left: PaddleState; right: PaddleState };
  /** The AI opponent's two faculties. */
  ai: AiState;
  /** The balls PRESENT on the field, in play order, each under its own index. */
  balls: BallState[];
  /** The obstacles PRESENT in the field, in the order of `OBSTACLE_CENTERS`. */
  obstacles: ObstacleState[];

  /** Accumulated simulation time, in seconds. Every update adds its delta. */
  simTime: number;
  /**
   * Mirrors the runtime's mute bit, refreshed every `update` from
   * `api.audio.muted()`. The runtime owns muting; this is the game's readable
   * copy of it, and it is what `snapshot()` reports.
   */
  muted: boolean;
  /** The seed the game's random generator was last seeded from. */
  seed: number;
  /** The whole state of that generator, as a single number. */
  rngState: number;
}

// ---- Building and posing the state --------------------------------------

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
}

function newPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/**
 * The complete initial state: the title screen, with every field present and
 * holding the value `specs/state.md` gives it there.
 *
 * Exported so this build's own tests can construct a state without standing a
 * runtime up around it. {@link resetGame} restores the same values, so quitting
 * to the menu and resetting from the debug surface never leave the game looking
 * at two different title screens.
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
    paddles: { left: newPaddle(), right: newPaddle() },
    ai: { tracking: true, movement: true },
    balls: createBalls(HOLD_TIME),
    obstacles: createObstacles(),
    simTime: 0,
    muted: false,
    seed: DEFAULT_SEED,
    rngState: DEFAULT_SEED,
  };
}

/**
 * Put every ball back on the field, held at its own home point with a full wait.
 *
 * Every ball, not every ball that happened to still be there: a ball taken off
 * the field comes back with the rest of them, because "every ball is held at its
 * own home point" (specs/ui.md) is a statement about the world a match opens on.
 */
function respawnBalls(state: CaromState, hold: number): void {
  for (let index = 0; index < BALL_COUNT; index += 1) {
    spawnBall(state.balls, index, hold);
  }
}

// ---- Screen transitions -------------------------------------------------

/**
 * Return to the title screen (specs/ui.md).
 *
 * Every declared field takes its title-screen value except `titleIndex`,
 * `simTime`, `muted`, `seed` and `rngState`, which keep theirs — and `menuIndex`,
 * which becomes `titleIndex`, so the entry that led away from the title is the
 * entry highlighted on the way back to it.
 */
export function toTitle(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = state.titleIndex;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  for (const side of ["left", "right"] as const) {
    state.paddles[side].driven = false;
    state.paddles[side].drivenVy = 0;
  }
  state.ai.tracking = true;
  state.ai.movement = true;
  respawnBalls(state, HOLD_TIME);
  state.obstacles = createObstacles();
}

/**
 * Return the game to its title-screen state entirely: what `reset()` on the debug
 * surface does.
 *
 * {@link toTitle} is the player's route back and keeps the clock, the generator
 * and the remembered title selection; a reset is the scenario's route back and
 * restores those too. The mute bit and the auto-step setting are deliberately
 * left alone: muting is a player preference the runtime owns, and whether the
 * game is stepping itself is the clock's business rather than a declared field.
 */
export function resetGame(state: CaromState): void {
  state.titleIndex = 0;
  toTitle(state);
  state.simTime = 0;
  seedRandom(state, DEFAULT_SEED);
}

/**
 * Start a match (specs/ui.md). `SOLO` and `VERSUS` on the title, `RESTART` on the
 * pause menu, and `PLAY AGAIN` on the match-over screen all come here.
 *
 * All three balls take their home points with a full hold, so the match opens on
 * the countdown screen and they launch together (specs/balls.md). `titleIndex`
 * keeps its value, because the title menu's memory is not part of a match.
 */
export function startMatch(state: CaromState, mode: Mode): void {
  state.mode = mode;
  state.screen = "countdown";
  state.resumeScreen = "playing";
  state.menuIndex = 0;
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  respawnBalls(state, HOLD_TIME);
}

/**
 * Launch one ball from its home point at SERVE_SPEED.
 *
 * The direction is a fresh uniform draw over the full circle from the seeded
 * generator, the one piece of randomness this game has, and it is the same draw
 * for the first launch of a match and for every relaunch (specs/balls.md).
 */
function launch(state: CaromState, ball: BallState): void {
  const angle = nextAngle(state);
  ball.vx = SERVE_SPEED * Math.cos(angle);
  ball.vy = SERVE_SPEED * Math.sin(angle);
  ball.spin = 0;
  ball.held = false;
  ball.holdTimer = 0;
  ball.trail.length = 0;
}

/**
 * Count every waiting ball's hold down, launching each the moment its own timer
 * elapses. The three are independent, so one relaunching leaves the others alone.
 */
function tickHolds(state: CaromState, dt: number): void {
  for (const ball of state.balls) {
    if (!ball.held) continue;
    ball.holdTimer -= dt;
    if (ball.holdTimer <= 0) launch(state, ball);
  }
}

/** The ball the AI defends: of those flying at its goal, the one arriving first. */
export function threatBall(balls: readonly BallState[]): BallState | null {
  let soonest: BallState | null = null;
  let bestTime = Infinity;
  for (const ball of balls) {
    if (ball.held || ball.vx <= 0 || ball.x >= P2_X0) continue;
    const time = (P2_X0 - ball.x) / ball.vx;
    if (time < bestTime) {
      bestTime = time;
      soonest = ball;
    }
  }
  return soonest;
}

function pauseMatch(state: CaromState): void {
  state.resumeScreen = state.screen === "countdown" ? "countdown" : "playing";
  state.screen = "paused";
  state.menuIndex = 0;
}

function resumeMatch(state: CaromState): void {
  state.screen = state.resumeScreen;
}

// ---- Edge input (once per frame) ----------------------------------------

/**
 * Read this frame's one-shot actions, and the frame's pointer and touch samples,
 * and act on them.
 *
 * Every edge read in Carom happens here, once, which is what the runtime's
 * consume-on-read edges ask for: two readers of the same action in one frame
 * would split one press between them. The pointer queue is drained here too, and
 * unconditionally — a sample that arrived while the game was on a live screen is
 * spent on that frame rather than saved up for the next menu.
 */
function handleInput(state: CaromState, api: UpdateApi): void {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  const pointer = api.pointer.take();

  switch (state.screen) {
    case "title":
      // `back` does nothing here, but it is read so a press is spent on the
      // frame it belongs to rather than left armed.
      void back(api);
      runMenu(state, api, pointer, (index) => selectTitle(state, index));
      break;
    case "howto":
      if (back(api)) {
        toTitle(state);
        break;
      }
      runMenu(state, api, pointer, () => toTitle(state));
      break;
    case "countdown":
    case "playing":
      // A match is live, so Escape means `pause`. `back` is not read on these
      // screens, which is why one Escape opens the pause menu and leaves it open.
      if (pause(api)) pauseMatch(state);
      break;
    case "paused": {
      // `pause` and `back` are read BEFORE the menu edges, and a frame carrying
      // either resumes and does nothing else — so one Escape, which raises both,
      // resumes exactly once (specs/ui.md).
      const paused = pause(api);
      const backed = back(api);
      if (paused || backed) {
        resumeMatch(state);
        break;
      }
      runMenu(state, api, pointer, (index) => selectPause(state, index));
      break;
    }
    case "matchover":
      if (back(api)) {
        toTitle(state);
        break;
      }
      runMenu(state, api, pointer, (index) => selectMatchOver(state, index));
      break;
  }
}

/**
 * Drive the menu the current screen shows from this frame's keyboard edges and
 * this frame's pointer and touch samples.
 *
 * The order is the one `specs/ui.md` fixes. Up is applied before down and
 * movement before `confirm`, so a frame carrying both an up and a down edge moves
 * up only and a frame carrying a movement edge and a `confirm` edge moves only.
 * The pointer is applied AFTER the keyboard, so a frame carrying a keyboard
 * movement edge together with a pointer selection ends on the item the pointer
 * named. A keyboard `confirm` is the one thing that ends the frame: it acts on
 * its own item, and the pointer's confirm is dropped rather than acted on as
 * well.
 */
function runMenu(
  state: CaromState,
  api: UpdateApi,
  pointer: readonly PointerSample[],
  onConfirm: (index: number) => void,
): void {
  const count = menuItemCount(state.screen);
  // All three are read before any is acted on, so exactly one press moves the
  // selection or accepts it and nothing is left armed for a later frame.
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);

  if (count > 0) {
    if (up) {
      state.menuIndex = (state.menuIndex + count - 1) % count;
    } else if (down) {
      state.menuIndex = (state.menuIndex + 1) % count;
    } else if (accepted) {
      onConfirm(state.menuIndex);
      return;
    }
  }

  applyPointer(state, pointer, onConfirm);
}

/**
 * Apply one frame's pointer and touch samples to the menu.
 *
 * A move onto an item's region selects it, and so does a contact landing on one —
 * a finger does not hover, so its landing is its first news. A release confirms
 * only when its own press landed in the SAME item's region: two edges in
 * different regions, and an edge outside every region, confirm nothing, which is
 * the slide-off a player cancels a press with.
 *
 * The item every confirm acts on is the item at `menuIndex`, whichever input
 * raised it, so a confirm selects its item first and then accepts it. Acting on a
 * confirm ends the frame's pointer read: the screen it moved to has its own menu,
 * and the rest of a gesture aimed at the old one is not news about the new one.
 */
function applyPointer(
  state: CaromState,
  pointer: readonly PointerSample[],
  onConfirm: (index: number) => void,
): void {
  for (const sample of pointer) {
    if (sample.phase === "up") {
      if (sample.from === null) continue;
      const pressed = menuItemAt(state.screen, sample.from.x, sample.from.y);
      const released = menuItemAt(state.screen, sample.x, sample.y);
      if (pressed === null || pressed !== released) continue;
      state.menuIndex = released;
      onConfirm(released);
      return;
    }
    const over = menuItemAt(state.screen, sample.x, sample.y);
    if (over !== null) state.menuIndex = over;
  }
}

function selectTitle(state: CaromState, index: number): void {
  // The title menu remembers what led away from it, and every route back
  // restores that entry (specs/ui.md).
  state.titleIndex = index;
  if (index === 0) startMatch(state, "solo");
  else if (index === 1) startMatch(state, "versus");
  else {
    state.screen = "howto";
    state.menuIndex = 0;
  }
}

function selectPause(state: CaromState, index: number): void {
  if (index === 0) resumeMatch(state);
  else if (index === 1) startMatch(state, state.mode);
  else toTitle(state);
}

function selectMatchOver(state: CaromState, index: number): void {
  if (index === 0) startMatch(state, state.mode);
  else toTitle(state);
}

// ---- Simulation ---------------------------------------------------------

/**
 * Move both paddles for this frame.
 *
 * Each side is answered on its own. A driven paddle moves at that side's
 * `drivenVy` through the real integrator and neither the input actions nor the AI
 * touch it; a paddle that is not driven plays normally — the registered actions
 * move the human paddles and, in Solo, the AI moves the right one.
 */
function updatePaddles(state: CaromState, api: UpdateApi, dt: number): void {
  const live = state.screen === "playing";
  const { left, right } = state.paddles;

  if (left.driven) {
    left.vy = left.drivenVy;
    integratePaddle(left, dt);
  } else {
    // Solo has no player two, so both sliders drive the one human paddle.
    const axis = state.mode === "solo" ? soloAxis(api) : p1Axis(api);
    left.vy = axis * PADDLE_SPEED;
    integratePaddle(left, dt);
  }

  if (right.driven) {
    right.vy = right.drivenVy;
    integratePaddle(right, dt);
  } else if (state.mode === "solo") {
    updateAi(right, threatBall(state.balls), live, state.ai, dt);
  } else {
    right.vy = p2Axis(api) * PADDLE_SPEED;
    integratePaddle(right, dt);
  }
}

function checkWin(state: CaromState): Side | null {
  const { p1, p2 } = state.score;
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

function score(
  state: CaromState,
  api: UpdateApi,
  scorer: Side,
  ball: BallState,
): void {
  if (scorer === "left") state.score.p1 += 1;
  else state.score.p2 += 1;
  api.audio.play(CUES.score);

  const winner = checkWin(state);
  if (winner) {
    state.winner = winner;
    state.screen = "matchover";
    state.menuIndex = 0;
    return;
  }
  // Only the ball that crossed is affected: it takes its own home point and a
  // fresh hold, and the other two carry on uninterrupted.
  parkBall(ball, HOLD_TIME);
}

/** A point is scored the moment a ball has fully passed a goal edge. */
function checkGoals(state: CaromState, api: UpdateApi): void {
  for (const ball of state.balls) {
    if (ball.held) continue;
    if (ball.x - BALL_R > FIELD_W) score(state, api, "left", ball);
    else if (ball.x + BALL_R < 0) score(state, api, "right", ball);
    // A won match ends the frame: the remaining balls are frozen where they are.
    if (state.screen === "matchover") return;
  }
}

/**
 * Advance the simulation by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * clock; the paused screen freezes the field entirely.
 */
function advance(state: CaromState, api: UpdateApi, dt: number): void {
  state.simTime += dt;

  if (state.screen !== "countdown" && state.screen !== "playing") return;

  updatePaddles(state, api, dt);
  // Every waiting ball counts its own hold down and launches when that hold
  // elapses, on the opening countdown and mid-rally alike. A waiting ball is
  // skipped by the step below, so the opening screen advances nothing but the
  // holds — the two screens run one simulation and differ only in what is drawn.
  tickHolds(state, dt);

  const events = step(
    state.balls,
    state.obstacles,
    state.paddles.left,
    state.paddles.right,
    dt,
  );
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/audio.md). A ball-to-ball hit is ONE event between two
  // balls: `events.ball` records the frame a pair met rather than the balls it
  // happened to, so the cue plays once for the pair. Playing it from a loop over
  // the balls would sound the same contact twice, once for each side of it.
  if (events.paddle) api.audio.play(CUES.paddleHit);
  if (events.wall) api.audio.play(CUES.wallBounce);
  if (events.obstacle) api.audio.play(CUES.obstacleBounce);
  if (events.ball) api.audio.play(CUES.ballBounce);
  for (const ball of state.balls) recordTrail(ball, state.simTime);
  checkGoals(state, api);

  // The opening countdown is over the moment no ball is still on its home point.
  if (state.screen === "countdown" && state.balls.every((ball) => !ball.held)) {
    state.screen = "playing";
  }
}

// ---- The game the runtime drives -----------------------------------------

export const game: Game<CaromState> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the five cues, build the complete initial state, and register the
   * diagnostic sources over it.
   *
   * The state is built before the diagnostics are registered, because each source
   * is a pure read of that object — and it is the object every later frame is
   * handed, so the overlay reports the live game rather than a snapshot.
   */
  initialize(api: InitApi): CaromState {
    registerActions(api);
    defineCues(api);
    const state = createInitialState();
    registerDiagnostics(api, state);
    return state;
  },

  /**
   * Runs once per frame, before `render`.
   *
   * The order matters. Edges are news for exactly one frame — the runtime
   * discards whatever was not consumed — so they are read first, at the top of
   * the frame they belong to, and the state they may have changed is the state
   * the rest of the frame advances.
   */
  update(state: CaromState, api: UpdateApi, dt: number): void {
    handleInput(state, api);
    advance(state, api, dt);
    // The runtime owns the mute bit; this is the game's readable copy of it, so
    // the HUD hint and `snapshot()` cannot drift from what the player hears.
    state.muted = api.audio.muted();
  },

  /** Runs once per frame, after `update`. Draws, and changes nothing. */
  render(state: CaromState, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
