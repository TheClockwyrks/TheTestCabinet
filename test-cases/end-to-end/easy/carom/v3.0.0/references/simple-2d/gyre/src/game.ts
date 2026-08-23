// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, when the engine is initialized; it
// returns the state and the surface together, as `[state, debug]`. `update` and
// `render` then run once each per frame — `update` first, with the frame's delta
// time in SECONDS, then `render`. The state is the only channel between them,
// and it is a VALUE: `update` is handed the current state as a `DeepReadonly`
// view and returns the next one, `render` is handed that next one and returns
// nothing, and the engine stores what `update` returned. Nothing in this build
// holds a writable state; every function below is current-state-in,
// next-state-out, built with spreads.
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
//   * Every field is declared here, under its declared name, with its declared
//     type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     this one is arithmetic over the record below. `reset()` on the debug
//     surface restores exactly these fields, so a scenario replays identically.

import {
  BALL_R,
  CUES,
  DEFAULT_SEED,
  FIELD_CX,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
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
import { integratePaddle, parkedBall } from "./entities";
import { updateAi } from "./ai";
import { startMatch, toTitle } from "./match";
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
import { poseObstacles } from "./obstacles";
import { step } from "./physics";
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
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game
// it types, so the type is exported from here whichever module implements it.
export type { CaromDebugApi };

/**
 * The field background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the field match the field itself.
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
  readonly cy: number;
  /**
   * The paddle's actual vertical velocity this frame, in units per second. This is what the
   * spin mechanic reads at contact, so a paddle pinned against a bound reports
   * zero even while a movement action is held.
   */
  readonly vy: number;
}

/** The ball. `speed` is derived (`hypot(vx, vy)`) and is not stored. */
export interface BallState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /**
   * The signed lateral-curvature scalar (magnitude in units per second squared). Positive and
   * negative curve the flight opposite ways; it decays by half every
   * SPIN_HALFLIFE seconds and changes otherwise only on a paddle hit.
   */
  readonly spin: number;
}

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  readonly x: number;
  readonly y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  readonly t: number;
}

/**
 * One obstacle's live pose — where it actually is this frame, and how far it has
 * turned.
 *
 * This is DERIVED from `obstacleClock` by the sway and spin formulas in
 * `specs/playfield.md`, but it is declared state because it is what the oriented
 * collision resolves against and what `snapshot().obstacles` reports. Recompute
 * both fields every frame from the clock rather than integrating them, so a
 * scenario that poses the clock faces exactly the pose the formula names.
 */
export interface ObstacleState {
  /** Live center x, in logical pixels. Never moves off the base center's x. */
  readonly cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  readonly cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  readonly theta: number;
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
  readonly paddles: boolean;
  /**
   * Solo only: hand the right paddle back to the computer opponent for the rest
   * of a driven scenario, so the real AI plays against the posed ball while the
   * left paddle and the ball stay under the caller's control.
   */
  readonly ai: boolean;
  /** The vertical velocity each paddle holds while `paddles` is true, in units per second. */
  readonly vy: { readonly left: number; readonly right: number };
}

/**
 * The whole of Carom's state.
 *
 * Every field is present from the moment `initialize` returns, and every one is
 * plain data: numbers, strings, booleans and containers of them, so a scenario
 * can be posed by building the next value and read back off the current one.
 * Every field is `readonly` and every array is a `readonly` array: a state is a
 * VALUE. A frame, a menu choice, and a debug pose each return a new one, and
 * the engine holds whichever was returned last.
 */
export interface CaromState {
  /** The screen currently shown (specs/ui.md). */
  readonly screen: Screen;
  /** The mode the current or most recent match is played in. */
  readonly mode: Mode;
  /** The highlighted item on whichever menu `screen` is showing. */
  readonly menuIndex: number;
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  readonly resumeScreen: Screen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  readonly score: { readonly p1: number; readonly p2: number };
  /** The winning side once the match is over, and null until then. */
  readonly winner: Side | null;

  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match always travels toward player one ("left").
   */
  readonly receiver: Side;
  /**
   * Seconds remaining of the pre-serve hold. HOLD_TIME at the start of a match
   * and after each point, counting down to 0, at which point the ball is served.
   * 0 during a live rally.
   */
  readonly holdTimer: number;

  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  /** The single ball in play (specs/balls.md). */
  readonly ball: BallState;
  /** Recent ball positions, oldest first, for the motion trail. */
  readonly trail: readonly TrailSample[];

  /**
   * The obstacle clock, in seconds — the sole input to both obstacle poses.
   *
   * It advances by the frame's delta time on every frame of a live match, the
   * pre-serve countdown included, is frozen while the game is paused, and resets
   * to 0 at the start of each match, so every match opens upright. It is held
   * still, rather than advancing, while `driver.paddles` is true, which is what
   * lets a scenario face a chosen, known orientation (specs/instrumentation.md).
   */
  readonly obstacleClock: number;
  /**
   * Both obstacles' live poses, in the order of OBSTACLE_CENTERS. Recomputed
   * from `obstacleClock` every frame; this is what the oriented collision uses
   * and what the debug API reports.
   */
  readonly obstacles: readonly ObstacleState[];

  /** Accumulated simulation time, in seconds. */
  readonly simTime: number;
  /**
   * Mirrors the engine's mute bit, refreshed every `update` from
   * `api.audio.muted()`. The engine owns muting; this is the game's readable
   * copy of it, and it is what `snapshot()` reports.
   */
  readonly muted: boolean;
  /**
   * The state of the game's seeded random generator. `reset({ seed })` sets it,
   * so reseeding and replaying the same calls reproduces the same result. A
   * build that uses no randomness simply never reads it.
   */
  readonly rngState: number;

  /** The debug driver's hold on the paddles. Inert during normal play. */
  readonly driver: DriverState;
}

// ---- Building and posing the state --------------------------------------

/**
 * The complete initial state: the title screen, with every field present.
 *
 * Exported so this build's own tests can construct a state without standing an
 * engine up around it.
 *
 * These are the values `toTitle` in `src/match.ts` restores, which is what
 * quitting to the menu and resetting from the debug surface both land on.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    holdTimer: 0,
    paddles: {
      left: { cy: FIELD_CY, vy: 0 },
      right: { cy: FIELD_CY, vy: 0 },
    },
    ball: { x: FIELD_CX, y: FIELD_CY, vx: 0, vy: 0, spin: 0 },
    trail: [],
    // Clock zero is the upright pose, so the title screen already shows the
    // field a match will open on.
    obstacleClock: 0,
    obstacles: poseObstacles(0),
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/** The current state as every transition below reads it. */
type State = DeepReadonly<CaromState>;

// ---- Screen transitions -------------------------------------------------

/** The ball parked and the pre-serve hold begun, aimed at `receiver`. */
function respawn(state: State, receiver: Side): CaromState {
  return {
    ...state,
    receiver,
    ball: parkedBall(),
    trail: [],
    holdTimer: HOLD_TIME,
    screen: "countdown",
  };
}

/**
 * The ball launched toward the receiver at SERVE_SPEED, SERVE_ANGLE from
 * horizontal (specs/balls.md). The SIGN of the vertical component is the one
 * draw this game makes from its seeded generator, so the generator's next state
 * travels out beside the ball.
 */
function serve(state: State): CaromState {
  const dir = state.receiver === "left" ? -1 : 1;
  const [sign, rngState] = nextSign(state.rngState);
  return {
    ...state,
    ball: {
      ...parkedBall(),
      vx: dir * SERVE_SPEED * Math.cos(SERVE_ANGLE),
      vy: sign * SERVE_SPEED * Math.sin(SERVE_ANGLE),
    },
    rngState,
    trail: [],
    holdTimer: 0,
    screen: "playing",
  };
}

function pauseMatch(state: State): CaromState {
  return {
    ...state,
    resumeScreen: state.screen === "countdown" ? "countdown" : "playing",
    screen: "paused",
    menuIndex: 0,
  };
}

function resumeMatch(state: State): CaromState {
  return { ...state, screen: state.resumeScreen };
}

// ---- Edge input (once per frame) ----------------------------------------

/**
 * The state after this frame's one-shot actions have been read and acted on.
 *
 * Every edge read in Carom happens here, once, which is what the engine's
 * consume-on-read edges ask for: two readers of the same action in one frame would
 * split one press between them.
 */
function handleInput(state: State, api: UpdateApi): CaromState {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title":
      return menuInput(state, api, TITLE_ITEMS.length, selectTitle);
    case "howto": {
      // `back` and `confirm` both leave; read both so neither is left armed.
      const accepted = confirm(api);
      const left = back(api);
      return accepted || left ? toTitle(state) : state;
    }
    case "countdown":
    case "playing":
      // A match is live, so Escape means `pause` rather than `back`.
      return pause(api) ? pauseMatch(state) : state;
    case "paused":
      // A menu is up, so Escape means `back` — which here is "resume".
      if (back(api)) return resumeMatch(state);
      return menuInput(state, api, PAUSE_ITEMS.length, selectPause);
    case "matchover":
      // A menu is up, so Escape means `back`, which from here is the title.
      if (back(api)) return toTitle(state);
      return menuInput(state, api, MATCHOVER_ITEMS.length, selectMatchOver);
  }
}

function menuInput(
  state: State,
  api: UpdateApi,
  count: number,
  onConfirm: (state: State, index: number) => CaromState,
): CaromState {
  // All three are read before any is acted on, so exactly one press moves the
  // selection or accepts it and nothing is left armed for a later frame.
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);
  if (up) {
    return { ...state, menuIndex: (state.menuIndex + count - 1) % count };
  } else if (down) {
    return { ...state, menuIndex: (state.menuIndex + 1) % count };
  } else if (accepted) {
    return onConfirm(state, state.menuIndex);
  }
  return state;
}

function selectTitle(state: State, index: number): CaromState {
  if (index === 0) return startMatch(state, "solo");
  if (index === 1) return startMatch(state, "versus");
  return { ...state, screen: "howto", menuIndex: 0 };
}

function selectPause(state: State, index: number): CaromState {
  if (index === 0) return resumeMatch(state);
  if (index === 1) return startMatch(state, state.mode);
  return toTitle(state);
}

function selectMatchOver(state: State, index: number): CaromState {
  if (index === 0) return startMatch(state, state.mode);
  return toTitle(state);
}

// ---- Simulation ---------------------------------------------------------

/**
 * Both paddles moved for this frame.
 *
 * The debug driver's hold is checked first: once a control operation has taken the
 * paddles (`driver.paddles`), both follow the driver's held velocities through the
 * real integrator and neither the input actions nor the AI move them. Inert during
 * normal play.
 */
function updatePaddles(state: State, api: UpdateApi, dt: number): CaromState {
  const live = state.screen === "playing";

  if (state.driver.paddles) {
    const left = integratePaddle(
      { ...state.paddles.left, vy: state.driver.vy.left },
      dt,
    );
    // In Solo a scenario can hand the right paddle back to the AI, so the computer
    // opponent plays its own side against the posed ball while the left paddle and
    // the ball stay driver-posed. Otherwise the driver moves the right paddle too.
    const right =
      state.driver.ai && state.mode === "solo"
        ? updateAi(state.paddles.right, state.ball, live, dt)
        : integratePaddle(
            { ...state.paddles.right, vy: state.driver.vy.right },
            dt,
          );
    return { ...state, paddles: { left, right } };
  }

  // Player one (left). Solo has no player two, so both sliders drive this paddle.
  const p1 = state.mode === "solo" ? soloAxis(api) : p1Axis(api);
  const left = integratePaddle(
    { ...state.paddles.left, vy: p1 * PADDLE_SPEED },
    dt,
  );

  // The right paddle: the AI in Solo, a second human in Versus.
  const right =
    state.mode === "solo"
      ? updateAi(state.paddles.right, state.ball, live, dt)
      : integratePaddle(
          { ...state.paddles.right, vy: p2Axis(api) * PADDLE_SPEED },
          dt,
        );
  return { ...state, paddles: { left, right } };
}

function checkWin(score: State["score"]): Side | null {
  const { p1, p2 } = score;
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

function score(state: State, api: UpdateApi, scorer: Side): CaromState {
  const tally =
    scorer === "left"
      ? { p1: state.score.p1 + 1, p2: state.score.p2 }
      : { p1: state.score.p1, p2: state.score.p2 + 1 };
  api.audio.play(CUES.score);

  const winner = checkWin(tally);
  if (winner) {
    return {
      ...state,
      score: tally,
      winner,
      screen: "matchover",
      menuIndex: 0,
    };
  }
  // The next serve travels toward the player who was just scored on.
  return respawn(
    { ...state, score: tally },
    scorer === "left" ? "right" : "left",
  );
}

/** A point is scored the moment the ball has fully passed a goal edge. */
function checkGoals(state: State, api: UpdateApi): CaromState {
  if (state.ball.x - BALL_R > FIELD_W) return score(state, api, "left");
  if (state.ball.x + BALL_R < 0) return score(state, api, "right");
  return state;
}

/**
 * The simulation advanced by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * clock; the paused screen freezes the field entirely.
 */
function advance(state: State, api: UpdateApi, dt: number): CaromState {
  let next: CaromState = { ...state, simTime: state.simTime + dt };

  if (next.screen === "countdown" || next.screen === "playing") {
    next = updatePaddles(next, api, dt);
    // The obstacles are live through the pre-serve countdown too, so they are
    // already moving when the ball is served. They are NOT advanced on the paused
    // screen — that branch is not this one — and they are held still while the
    // debug driver holds the paddles, which is what lets a scenario face one
    // chosen orientation instead of obstacles sweeping through the shot
    // (specs/instrumentation.md).
    if (!next.driver.paddles) {
      next = { ...next, obstacleClock: next.obstacleClock + dt };
    }
  }
  // Reposed every frame from the clock rather than integrated, so a posed clock
  // and a match that has run that long face the identical field.
  next = { ...next, obstacles: poseObstacles(next.obstacleClock) };

  if (next.screen === "countdown") {
    // The ball is held at the center; record so the (collapsed) trail stays in
    // sync with the simulation clock.
    next = recordTrail({ ...next, holdTimer: next.holdTimer - dt });
    return next.holdTimer <= 0 ? serve(next) : next;
  }
  if (next.screen === "playing") {
    const { ball, events } = step(
      next.ball,
      next.paddles.left,
      next.paddles.right,
      next.obstacles,
      dt,
    );
    // One cue per event that actually happened. A frame long enough to contain two
    // different kinds of bounce plays both, because each is its own event and each
    // has its own cue (specs/ui.md).
    if (events.paddle) api.audio.play(CUES.paddleHit);
    if (events.wall) api.audio.play(CUES.wallBounce);
    if (events.obstacle) api.audio.play(CUES.obstacleBounce);
    return checkGoals(recordTrail({ ...next, ball }), api);
  }
  return next;
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the four cues, register the diagnostic sources, build the complete
   * initial state, and return it beside the debug surface.
   *
   * Neither the diagnostics nor the surface is built over the state: the state a
   * frame leaves behind is a new value, so a source that closed over the opening
   * state would report the title screen forever. Each source is a pure read of
   * whatever state the engine hands it at the read, and each operation of the
   * surface is a transition or a reading over whatever state the caller hands
   * it. The pair is returned together because the pair is what the engine holds:
   * by the time this resolves, `engine.debug` carries the surface and
   * `engine.state` the opening state (specs/instrumentation.md).
   */
  initialize(api: InitApi<CaromState>): [CaromState, CaromDebugApi] {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);
    return [createInitialState(), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The order matters. Edges are news for exactly one frame — the engine discards
   * whatever was not consumed — so they are read first, at the top of the frame
   * they belong to, and the state they may have changed is the state the rest of
   * the frame advances.
   */
  update(state: State, api: UpdateApi, dt: number): CaromState {
    const next = advance(handleInput(state, api), api, dt);
    // The engine owns the mute bit; this is the game's readable copy of it, so the
    // HUD hint and `snapshot()` cannot drift from what the player actually hears.
    return { ...next, muted: api.audio.muted() };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: State, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
