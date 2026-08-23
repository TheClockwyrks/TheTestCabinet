// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, when the engine is initialized; it
// returns the state and the surface together, as `[state, debug]`. `update` and `render` then run once
// each per frame — `update` first, with the frame's delta time in SECONDS, then
// `render`. The state is the only channel between them.
//
// There is no fixed timestep here and no accumulator. Every rate in
// `src/constants.ts` is per second and every one of them is multiplied by `dt`,
// which is what makes the simulation depend on how much TIME has passed rather
// than on how many frames have gone by: the same second of play reaches the same
// state whether it arrived as one long step, as a hundred short ones, or as an
// uneven mixture. That is the property specs/balls.md requires and the property
// the debug API in `src/debug.ts` leans on.
//
// THE STATE SHAPE BELOW IS A CONTRACT. It is what the debug API reads and poses,
// and what this case's checks read back. So:
//
//   * Every field is declared here, under its declared name, with its declared
//     type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     this one is arithmetic over the record below. `reset()` on the debug API
//     restores exactly these fields, so a scenario replays identically.

import {
  FIELD_CY,
  HOLD_TIME,
  MATCHOVER_ITEMS,
  P2_X0,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_SPEED,
  TITLE_ITEMS,
  WIN_LEAD,
  WIN_SCORE,
  BALL_R,
  CUES,
  DEFAULT_SEED,
  FIELD_W,
} from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { createBalls, integratePaddle, parkBall } from "./entities";
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
import { step } from "./physics";
import { renderGame } from "./render";
import { nextAngle } from "./rng";
import { recordTrail } from "./trail";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";

// The surface is part of the module contract and is declared beside the game
// it types, so the type is exported from here whichever module implements it.
export type { CaromDebugApi };

/**
 * The top-level state machine (specs/ui.md). `countdown` and `playing` both
 * render the live field; the rest are menu or overlay screens.
 */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/** One paddle. `x` is fixed by the side, so only the vertical axis is state. */
export interface PaddleState {
  /** Center y, in logical pixels. Clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY]. */
  cy: number;
  /**
   * The paddle's actual vertical velocity this frame, in units per second. This is what the
   * spin mechanic reads at contact, so a paddle pinned against a bound reports
   * zero even while a movement action is held.
   */
  vy: number;
}

/**
 * One ball. `speed` is derived (`hypot(vx, vy)`) and is not stored.
 *
 * Every field is that ball's own, which is the whole of what makes the three
 * independent: they carry separate velocities, separate spin, separate holds, and
 * separate trails (specs/balls.md).
 */
export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * The signed lateral-curvature scalar (magnitude in units per second squared). Positive and
   * negative curve the flight opposite ways; it decays by half every
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
   * counting down to 0, at which point it launches; 0 while it is in flight.
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

/**
 * Who is driving the paddles.
 *
 * Inert during normal play: `paddles` is false, the registered actions move the
 * human paddles and, in Solo, the AI moves the right one. A control operation on
 * the debug surface sets `paddles` to true, after which BOTH paddles follow `vy`
 * and neither the input actions nor the AI move them — until `reset()`. That is
 * what lets a scenario be posed and replayed exactly (specs/instrumentation.md).
 */
export interface DriverState {
  /** True once a control operation has taken the paddles from the player. */
  paddles: boolean;
  /**
   * Solo only: hand the right paddle back to the computer opponent for the rest
   * of a driven scenario, so the real AI plays against the posed ball while the
   * left paddle and the ball stay under the caller's control.
   */
  ai: boolean;
  /** The vertical velocity each paddle holds while `paddles` is true, in units per second. */
  vy: { left: number; right: number };
}

/**
 * The whole of Carom's state.
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
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  resumeScreen: Screen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  score: { p1: number; p2: number };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null;

  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match always travels toward player one ("left").
   */
  paddles: { left: PaddleState; right: PaddleState };
  /**
   * The three balls in play, in play order (specs/balls.md). They never start,
   * reset, or score as a group: each runs its own hold and its own respawn while
   * the other two carry on.
   */
  balls: BallState[];

  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /**
   * Mirrors the engine's mute bit, refreshed every `update` from
   * `api.audio.muted()`. The engine owns muting; this is the game's readable
   * copy of it, and it is what `snapshot()` reports.
   */
  muted: boolean;
  /**
   * The state of the game's seeded random generator. `reset({ seed })` sets it,
   * so reseeding and replaying the same calls reproduces the same result. A
   * build that uses no randomness simply never reads it.
   */
  rngState: number;

  /** The debug driver's hold on the paddles. Inert during normal play. */
  driver: DriverState;
}

// ---- Building and posing the state --------------------------------------

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
}

/**
 * The complete initial state: the title screen, with every field present.
 *
 * Exported so this build's own tests can construct a state without standing an
 * engine up around it.
 *
 * These are the same values `reset()` restores in `src/debug.ts`, deliberately —
 * quitting to the menu and resetting from the debug API must not leave the game
 * looking at two different title screens.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: {
      left: { cy: FIELD_CY, vy: 0 },
      right: { cy: FIELD_CY, vy: 0 },
    },
    balls: createBalls(),
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

// ---- Screen transitions -------------------------------------------------

/**
 * Return to the title screen.
 *
 * `simTime` is deliberately untouched: it is accumulated simulation time, not a
 * property of the screen, and only a `reset()` starts it over.
 */
function toTitle(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = 0;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  parkBalls(state, 0);
}

/**
 * Put every ball back on its own home point with the same wait ahead of it.
 *
 * A `hold` of 0 is the title screen's pose: parked, and no part of a live match.
 */
function parkBalls(state: CaromState, hold: number): void {
  for (let i = 0; i < state.balls.length; i++)
    parkBall(state.balls[i], i, hold);
}

/**
 * Start a match. All three balls take their home points with a full hold, so the
 * match opens on the countdown screen and they launch together (specs/balls.md).
 */
function startMatch(state: CaromState, mode: Mode): void {
  state.mode = mode;
  state.screen = "countdown";
  state.resumeScreen = "playing";
  state.menuIndex = 0;
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  parkBalls(state, HOLD_TIME);
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
 * Read this frame's one-shot actions and act on them.
 *
 * Every edge read in Carom happens here, once, which is what the engine's
 * consume-on-read edges ask for: two readers of the same action in one frame would
 * split one press between them.
 */
function handleInput(state: CaromState, api: UpdateApi): void {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title":
      menuInput(state, api, TITLE_ITEMS.length, (i) => selectTitle(state, i));
      break;
    case "howto": {
      // `back` and `confirm` both leave; read both so neither is left armed.
      const accepted = confirm(api);
      const left = back(api);
      if (accepted || left) toTitle(state);
      break;
    }
    case "countdown":
    case "playing":
      // A match is live, so Escape means `pause` rather than `back`.
      if (pause(api)) pauseMatch(state);
      break;
    case "paused":
      // A menu is up, so Escape means `back` — which here is "resume".
      if (back(api)) resumeMatch(state);
      else
        menuInput(state, api, PAUSE_ITEMS.length, (i) => selectPause(state, i));
      break;
    case "matchover":
      menuInput(state, api, MATCHOVER_ITEMS.length, (i) =>
        selectMatchOver(state, i),
      );
      break;
  }
}

function menuInput(
  state: CaromState,
  api: UpdateApi,
  count: number,
  onConfirm: (index: number) => void,
): void {
  // All three are read before any is acted on, so exactly one press moves the
  // selection or accepts it and nothing is left armed for a later frame.
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);
  if (up) {
    state.menuIndex = (state.menuIndex + count - 1) % count;
  } else if (down) {
    state.menuIndex = (state.menuIndex + 1) % count;
  } else if (accepted) {
    onConfirm(state.menuIndex);
  }
}

function selectTitle(state: CaromState, index: number): void {
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
 * The debug driver's hold is checked first: once a control operation has taken the
 * paddles (`driver.paddles`), both follow the driver's held velocities through the
 * real integrator and neither the input actions nor the AI move them. Inert during
 * normal play.
 */
function updatePaddles(state: CaromState, api: UpdateApi, dt: number): void {
  const live = state.screen === "playing";

  if (state.driver.paddles) {
    state.paddles.left.vy = state.driver.vy.left;
    integratePaddle(state.paddles.left, dt);
    // In Solo a scenario can hand the right paddle back to the AI, so the computer
    // opponent plays its own side against the posed ball while the left paddle and
    // the ball stay driver-posed. Otherwise the driver moves the right paddle too.
    if (state.driver.ai && state.mode === "solo") {
      updateAi(state.paddles.right, threatBall(state.balls), live, dt);
    } else {
      state.paddles.right.vy = state.driver.vy.right;
      integratePaddle(state.paddles.right, dt);
    }
    return;
  }

  // Player one (left). Solo has no player two, so both sliders drive this paddle.
  const p1 = state.mode === "solo" ? soloAxis(api) : p1Axis(api);
  state.paddles.left.vy = p1 * PADDLE_SPEED;
  integratePaddle(state.paddles.left, dt);

  // The right paddle: the AI in Solo, a second human in Versus.
  if (state.mode === "solo") {
    updateAi(state.paddles.right, threatBall(state.balls), live, dt);
  } else {
    state.paddles.right.vy = p2Axis(api) * PADDLE_SPEED;
    integratePaddle(state.paddles.right, dt);
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
  index: number,
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
  parkBall(state.balls[index], index, HOLD_TIME);
}

/** A point is scored the moment a ball has fully passed a goal edge. */
function checkGoals(state: CaromState, api: UpdateApi): void {
  for (let i = 0; i < state.balls.length; i++) {
    const ball = state.balls[i];
    if (ball.held) continue;
    if (ball.x - BALL_R > FIELD_W) score(state, api, "left", i);
    else if (ball.x + BALL_R < 0) score(state, api, "right", i);
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

  const events = step(state.balls, state.paddles.left, state.paddles.right, dt);
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/ui.md). A ball-to-ball hit is ONE event between two
  // balls: `events.ball` records the frame a pair met rather than the balls it
  // happened to, so the cue plays once for the pair. Playing it from a loop over
  // the balls would sound the same contact twice, once for each side of it.
  if (events.paddle) api.audio.play(CUES.paddleHit);
  if (events.wall) api.audio.play(CUES.wallBounce);
  if (events.obstacle) api.audio.play(CUES.obstacleBounce);
  if (events.ball) api.audio.play(CUES.ballBounce);
  for (const ball of state.balls) recordTrail(ball, state.simTime);
  checkGoals(state, api);

  // The opening countdown is over the moment the last ball has left its home.
  if (state.screen === "countdown" && state.balls.every((ball) => !ball.held)) {
    state.screen = "playing";
  }
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the five cues, build the complete initial state, register the
   * diagnostic sources over it, and hand the debug surface to the engine.
   *
   * The state is built before the diagnostics are registered, because each source
   * is a pure read of that object — and it is the object every later frame is
   * handed, so the overlay reports the live game rather than a snapshot. The
   * debug surface is built over that same object for the same reason, and
   * returned beside it because the pair is what the engine holds: by the time
   * this resolves, `engine.debug` reads the live game (specs/instrumentation.md).
   */
  initialize(api: InitApi): [CaromState, CaromDebugApi] {
    registerActions(api);
    defineCues(api);
    const state = createInitialState();
    registerDiagnostics(api, state);
    return [state, createDebugApi(state)];
  },

  /**
   * Runs once per frame, before `render`.
   *
   * The order matters. Edges are news for exactly one frame — the engine discards
   * whatever was not consumed — so they are read first, at the top of the frame
   * they belong to, and the state they may have changed is the state the rest of
   * the frame advances.
   */
  update(state: CaromState, api: UpdateApi, dt: number): void {
    handleInput(state, api);
    advance(state, api, dt);
    // The engine owns the mute bit; this is the game's readable copy of it, so the
    // HUD hint and `snapshot()` cannot drift from what the player actually hears.
    state.muted = api.audio.muted();
  },

  /** Runs once per frame, after `update`. Draws, and changes nothing. */
  render(state: CaromState, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
