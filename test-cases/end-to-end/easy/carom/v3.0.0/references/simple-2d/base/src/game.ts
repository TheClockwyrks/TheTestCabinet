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
  BALL_R,
  CUES,
  FIELD_W,
  MATCHOVER_ITEMS,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_ANGLE,
  SERVE_SPEED,
  TITLE_ITEMS,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { integratePaddle, parkBall } from "./entities";
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
import { createInitialState, respawn, startMatch, toTitle } from "./match";
import { renderGame } from "./render";
import { nextSign } from "./rng";
import { COLOR } from "./theme";
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
 * The field background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.bg;

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

/** The ball. `speed` is derived (`hypot(vx, vy)`) and is not stored. */
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
  receiver: Side;
  /**
   * Seconds remaining of the pre-serve hold. HOLD_TIME at the start of a match
   * and after each point, counting down to 0, at which point the ball is served.
   * 0 during a live rally.
   */
  holdTimer: number;

  paddles: { left: PaddleState; right: PaddleState };
  /** The single ball in play (specs/balls.md). */
  ball: BallState;
  /** Recent ball positions, oldest first, for the motion trail. */
  trail: TrailSample[];

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

// ---- Serving ------------------------------------------------------------

/**
 * Launch the ball toward the receiver at SERVE_SPEED.
 *
 * The serve leaves at exactly SERVE_ANGLE from horizontal (specs/balls.md); the
 * SIGN of its vertical component is the one draw this game makes from its
 * seeded generator.
 */
function serve(state: CaromState): void {
  const dir = state.receiver === "left" ? -1 : 1;
  parkBall(state.ball);
  state.ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
  state.ball.vy = nextSign(state) * SERVE_SPEED * Math.sin(SERVE_ANGLE);
  state.trail.length = 0;
  state.holdTimer = 0;
  state.screen = "playing";
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
      // A menu is up, so Escape means `back` — which here is "to the title".
      if (back(api)) toTitle(state);
      else
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
      updateAi(state.paddles.right, state.ball, live, dt);
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
    updateAi(state.paddles.right, state.ball, live, dt);
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

function score(state: CaromState, api: UpdateApi, scorer: Side): void {
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
  // The next serve travels toward the player who was just scored on.
  respawn(state, scorer === "left" ? "right" : "left");
}

/** A point is scored the moment the ball has fully passed a goal edge. */
function checkGoals(state: CaromState, api: UpdateApi): void {
  if (state.ball.x - BALL_R > FIELD_W) score(state, api, "left");
  else if (state.ball.x + BALL_R < 0) score(state, api, "right");
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

  if (state.screen === "countdown" || state.screen === "playing") {
    updatePaddles(state, api, dt);
  }

  if (state.screen === "countdown") {
    state.holdTimer -= dt;
    // The ball is held at the center; record so the (collapsed) trail stays in
    // sync with the simulation clock.
    recordTrail(state);
    if (state.holdTimer <= 0) serve(state);
  } else if (state.screen === "playing") {
    const events = step(
      state.ball,
      state.paddles.left,
      state.paddles.right,
      dt,
    );
    // One cue per event that actually happened. A frame long enough to contain two
    // different kinds of bounce plays both, because each is its own event and each
    // has its own cue (specs/ui.md).
    if (events.paddle) api.audio.play(CUES.paddleHit);
    if (events.wall) api.audio.play(CUES.wallBounce);
    if (events.obstacle) api.audio.play(CUES.obstacleBounce);
    recordTrail(state);
    checkGoals(state, api);
  }
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the four cues, build the complete initial state, register the
   * diagnostic sources over it, and return the state beside the debug surface.
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
