// Carom — the game. THIS IS THE ONE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/host.ts`, `src/debug.ts`, `src/constants.ts` and the
// project's configuration are supplied by the case and must not be edited. They
// stand the host up over the page's canvas, install `window.__carom`, and name
// every figure the specification fixes. What is missing is the game itself: the
// three functions below.
//
// A `Game<S>` is three functions and a state type. `initialize` runs once, when
// the host is initialized, and returns the state. `update` and `render` then run
// once each per frame — `update` first, with the frame's delta time in SECONDS,
// then `render`. The state is the only channel between them. `src/host.ts`
// defines all of this and the scoped APIs each function receives; read it before
// you start.
//
// THE STATE SHAPE BELOW IS A CONTRACT. It is what the debug API in
// `src/debug.ts` reads and poses, and what this case's checks read back. So:
//
//   * Keep every field declared here, under its declared name, with its declared
//     type and meaning. Do not remove one, rename one, or make one optional.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * You may ADD fields for your own implementation, but only DERIVED data you
//     can rebuild from the fields declared here. `reset()` on the debug API
//     restores the declared fields to their title-screen values and does not know
//     about yours, so anything authoritative that lives only in a field of your
//     own would survive a reset and stop a scenario from replaying identically.
//   * Do not hold game state anywhere but this object — no module-level
//     variables, no closures over mutable data. The state handed to `update` is
//     the whole of the game.

import type { Game, InitApi, RenderApi, UpdateApi } from "./host";

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
 * `window.__carom` sets `paddles` to true, after which BOTH paddles follow `vy`
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
   * Mirrors the host's mute bit, refreshed every `update` from
   * `api.audio.muted()`. The host owns muting; this is the game's readable copy
   * of it, and it is what `snapshot()` reports.
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

const NOT_IMPLEMENTED = "Carom: src/game.ts is not implemented yet";

/**
 * The game this build's host drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the host.
 */
export const game: Game<CaromState> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the four CUES,
   * register the diagnostic sources specs/instrumentation.md lists, and build and
   * return the complete initial state — the title screen, with every field of
   * CaromState set.
   */
  initialize(_api: InitApi): CaromState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`.
   *
   * `dt` is the real elapsed SECONDS of this frame. Every rate in
   * `src/constants.ts` is per second and is multiplied by it, so the same
   * interval of game time reaches the same state however it was divided into
   * frames. Read input, advance the simulation, play cues, and mirror the
   * host's mute bit into `state.muted`.
   */
  update(_state: CaromState, _api: UpdateApi, _dt: number): void {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so draw
   * in 1280x720 coordinates and never read the canvas element's size. Draw only:
   * rendering must not change `state`.
   */
  render(_state: CaromState, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
