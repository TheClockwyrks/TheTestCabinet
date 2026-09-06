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
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is what the debug
// surface reads and poses, and what this case's checks read back. So:
//
//   * Every field is declared here, under its declared name, with its declared
//     type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     this one is arithmetic over the record below. `reset()` on the debug
//     surface restores exactly these fields, so nothing survives a reset.

import {
  BALL_R,
  CUES,
  FIELD_CY,
  FIELD_W,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { integratePaddle, parkedBall } from "./entities";
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
import { menuItemCount } from "./menus";
import { poseObstacles } from "./obstacles";
import { step } from "./physics";
import { resolvePointer, type PointerPress } from "./pointer";
import { renderGame } from "./render";
import {
  confirmMenuItem,
  pauseMatch,
  resumeMatch,
  toTitle,
  withObstacleClock,
} from "./screens";
import { COLOR } from "./theme";
import { recordTrail } from "./trail";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game
// it types, so the type is exported from here whichever module implements it.
export type { CaromDebugApi };
export type { PointerPress };

/**
 * The field background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the field match the field itself.
 */
export const BACKGROUND: string = COLOR.bg;

// ---- The declared state (specs/state.md) --------------------------------

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
  /** Center y, in logical units. Clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY]. */
  readonly cy: number;
  /**
   * The paddle's ACTUAL vertical velocity this frame, in units per second, after
   * the integration specs/playfield.md fixes. This is what the spin mechanic
   * reads at contact, so a paddle pinned against a bound reports zero even while
   * a movement action is held.
   */
  readonly vy: number;
  /**
   * Whether the debug surface is moving this paddle rather than the player or the
   * AI. `setPaddleDriven` is the only thing that changes it, one side at a time
   * (specs/instrumentation.md).
   */
  readonly driven: boolean;
  /**
   * The velocity a DRIVEN paddle travels at, in units per second, which
   * `setPaddleVy` is the only thing that sets. It is held across frames whether or
   * not the paddle is driven, so a velocity posed while the paddle stands still
   * reaches `vy` on the first frame advanced with that side driven.
   */
  readonly drivenVy: number;
}

/**
 * The AI's two faculties, each gated on its own (specs/instrumentation.md).
 *
 * They are declared state rather than a flag on the driver, because a check
 * separates "it never saw the ball" from "it saw the ball and did not move".
 */
export interface AiState {
  /** Whether the AI senses the ball and chooses a target. */
  readonly tracking: boolean;
  /** Whether the AI's paddle travels toward that target. */
  readonly movement: boolean;
}

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  readonly x: number;
  readonly y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  readonly t: number;
}

/** The ball. `speed` is derived (`hypot(vx, vy)`) and is not stored. */
export interface BallState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /**
   * The signed lateral-curvature scalar (magnitude in units per second squared).
   * Positive and negative curve the flight opposite ways; it decays by half every
   * SPIN_HALFLIFE seconds and changes otherwise only on a paddle hit.
   */
  readonly spin: number;
  /**
   * Whether the ball waits at its home point rather than flying. It is the ball's
   * own flag, and a pause leaves it as it was (specs/state.md).
   */
  readonly held: boolean;
  /** Seconds remaining of that wait. */
  readonly holdTimer: number;
  /**
   * The vertical sign the serve takes, drawn afresh whenever the ball is parked
   * and posed by the debug surface (specs/balls.md).
   */
  readonly serveSign: 1 | -1;
  /** Recent ball positions, oldest first, for the motion trail. */
  readonly trail: readonly TrailSample[];
}

/**
 * One obstacle's live pose — which one it is, where it actually is this frame,
 * and how far it has turned.
 *
 * `cx`, `cy` and `theta` are DERIVED from `obstacleClock` by the sway and spin
 * formulas in `specs/playfield.md`, but they are declared state because they are
 * what the oriented collision resolves against and what `snapshot().obstacles`
 * reports. All three are recomputed every frame from the clock rather than
 * integrated, so a scenario that poses the clock faces exactly the pose the
 * formula names.
 */
export interface ObstacleState {
  /** Its index in the order of OBSTACLE_CENTERS: `0` or `1`. */
  readonly index: number;
  /** Live center x, in logical units. Never moves off the base center's x. */
  readonly cx: number;
  /** Live center y, in logical units: the base center swayed by the clock. */
  readonly cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  readonly theta: number;
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
  /**
   * The title menu's remembered selection: the item last confirmed there, which
   * every path back to the title restores `menuIndex` from (specs/ui.md).
   */
  readonly titleIndex: number;
  /** The screen the pause menu resumes to. */
  readonly resumeScreen: "countdown" | "playing";

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  readonly score: { readonly p1: number; readonly p2: number };
  /** The winning side once the match is over, and null until then. */
  readonly winner: Side | null;

  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  /** The AI opponent's two faculties. */
  readonly ai: AiState;

  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match always travels toward player one ("left").
   */
  readonly receiver: Side;
  /**
   * The single ball, or `null` while no ball is on the field. `clearWorld`
   * removes it and `spawnBall` puts it back (specs/instrumentation.md).
   */
  readonly ball: BallState | null;
  /**
   * The obstacles PRESENT, in the order of OBSTACLE_CENTERS, each under its own
   * index and at the live pose `obstacleClock` gives it.
   */
  readonly obstacles: readonly ObstacleState[];

  /** The obstacle clock, in seconds — the sole input to both obstacle poses. */
  readonly obstacleClock: number;
  /** Whether that clock advances with the frame. */
  readonly obstacleClockRunning: boolean;

  /** Accumulated simulation time, in seconds. Every update adds its `dt`. */
  readonly simTime: number;
  /**
   * The mute bit. `setMuted` poses it through the debug surface, the `mute`
   * action toggles it, and every `update` brings the engine's own bus into line
   * with it, so what `snapshot()` reports is what the player hears.
   */
  readonly muted: boolean;

  /**
   * The pointer and touch contacts currently pressed on a menu, and the item each
   * one came down on.
   *
   * NOT part of the declared contract, and nothing reports it: it is the frame-to
   * -frame bookkeeping a POINTER needs and the keyboard does not. specs/ui.md
   * confirms an item only when a press and its release both fall inside that one
   * item's region, and the two edges can arrive frames apart — a drag that begins
   * on `RESUME` and ends on `RESTART` confirms nothing — so the item a press began
   * on has to survive the frames between. It lives here rather than in a
   * module-level variable because the state is the whole of the game: `reset`
   * clears it with everything else, and nothing outside a `CaromState` remembers
   * anything.
   */
  readonly pointerPresses: readonly PointerPress[];
}

/** The current state as every transition below reads it. */
type State = DeepReadonly<CaromState>;

// ---- Building the state -------------------------------------------------

/** A paddle at the vertical center, stationary, and under its own player. */
export function freshPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/**
 * The complete initial state: the title screen, with every field present
 * (specs/state.md).
 *
 * Exported so this build's own tests can construct a state without standing an
 * engine up around it. `muted` opens `false` and is refreshed from the runtime on
 * the first update, because the mute bit belongs to the runtime and `InitApi`
 * does not expose it.
 */
export function createInitialState(muted = false): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    titleIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: { left: freshPaddle(), right: freshPaddle() },
    ai: { tracking: true, movement: true },
    receiver: "left",
    ball: parkedBall(),
    // Clock zero is the upright pose, so the title screen already shows the
    // field a match will open on.
    obstacles: poseObstacles(0),
    obstacleClock: 0,
    obstacleClockRunning: true,
    simTime: 0,
    muted,
    pointerPresses: [],
  };
}

// ---- Serving ------------------------------------------------------------

/**
 * The ball launched toward the receiver at SERVE_SPEED, SERVE_ANGLE from
 * horizontal (specs/balls.md). The SIGN of the vertical component is the ball's
 * own `serveSign`, drawn when it was parked and left as it is by the serve.
 */
function serve(state: CaromState): CaromState {
  const ball = state.ball;
  if (!ball) return state;
  const dir = state.receiver === "left" ? -1 : 1;
  return {
    ...state,
    // Exactly the four things specs/balls.md says a serve changes, plus the
    // velocity it leaves at. The ball's position is not among them: a waiting
    // ball is already at its home point, and the serve does not move it.
    ball: {
      ...ball,
      vx: dir * SERVE_SPEED * Math.cos(SERVE_ANGLE),
      vy: ball.serveSign * SERVE_SPEED * Math.sin(SERVE_ANGLE),
      held: false,
      holdTimer: 0,
      trail: [],
    },
    screen: "playing",
  };
}

// ---- Input (once per frame) ---------------------------------------------

/**
 * What one frame's keyboard reads left behind.
 *
 * `settled` says the keyboard TOOK A TRANSITION — it confirmed a menu item,
 * paused, resumed, or stepped back — which is what stops the pointer being
 * applied to a screen that no longer exists. A movement edge does not settle a
 * frame, because specs/ui.md says a frame carrying a keyboard movement edge and a
 * pointer selection ends on the item the POINTER named.
 */
interface KeyResult {
  readonly state: CaromState;
  readonly settled: boolean;
}

/**
 * The menu edges of one frame, in the order specs/ui.md fixes: up before down,
 * and movement before `confirm`.
 *
 * All three are read before any is acted on, so exactly one press moves the
 * selection or accepts it and nothing is left armed for a later frame.
 */
function menuKeys(state: State, api: UpdateApi): KeyResult {
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);
  const count = menuItemCount(state.screen);
  if (count === 0) return { state, settled: false };
  if (up) {
    const menuIndex = (((state.menuIndex - 1) % count) + count) % count;
    return { state: { ...state, menuIndex }, settled: false };
  }
  if (down) {
    const menuIndex = (((state.menuIndex + 1) % count) + count) % count;
    return { state: { ...state, menuIndex }, settled: false };
  }
  if (accepted && state.menuIndex >= 0 && state.menuIndex < count) {
    return { state: confirmMenuItem(state, state.menuIndex), settled: true };
  }
  return { state, settled: false };
}

/**
 * This frame's keyboard, screen by screen (specs/ui.md).
 *
 * Every edge Carom reads is read HERE, once, which is what the engine's
 * consume-on-read edges ask for: two readers of the same action in one frame
 * would split one press between them. `Escape` raises `pause` AND `back`, and
 * which of the two a screen reads is what makes one press mean "pause" during a
 * match and "resume" or "step back" on a menu.
 */
function readKeyboard(state: State, api: UpdateApi): KeyResult {
  switch (state.screen) {
    case "countdown":
    case "playing":
      // `back` is NOT read here, so the `back` edge an Escape raises alongside
      // `pause` is discarded at the end of the frame and the pause menu it just
      // opened stays open.
      return pause(api)
        ? { state: pauseMatch(state), settled: true }
        : { state, settled: false };
    case "paused": {
      // Both are read before the menu edges, and a frame carrying either resumes
      // and does nothing else — so one Escape, which raises both, resumes once.
      const paused = pause(api);
      const stepped = back(api);
      if (paused || stepped) {
        return { state: resumeMatch(state), settled: true };
      }
      return menuKeys(state, api);
    }
    case "matchover":
      if (back(api)) return { state: toTitle(state), settled: true };
      return menuKeys(state, api);
    case "howto": {
      // `back` and `confirm` both leave; read both so neither is left armed.
      const accepted = confirm(api);
      const stepped = back(api);
      return accepted || stepped
        ? { state: toTitle(state), settled: true }
        : { state, settled: false };
    }
    case "title":
      // `back` is read on the title and does nothing, so it is consumed here
      // rather than left armed for the screen a confirm moves to.
      back(api);
      return menuKeys(state, api);
  }
}

/**
 * The state after this frame's input has been read and acted on: the keyboard
 * first, then the pointer and the touch contacts.
 *
 * `mute` works on every screen, so it is read before the per-screen switch.
 */
function handleInput(state: State, api: UpdateApi): CaromState {
  const keys = readKeyboard(state, api);
  // A keyboard confirm takes the frame on its own: specs/ui.md says a frame
  // carrying one alongside a pointer confirm confirms the keyboard's item alone.
  if (keys.settled) return keys.state;
  return resolvePointer(keys.state, api.input.pointerSamples());
}

// ---- Simulation ---------------------------------------------------------

/** One paddle moved for this frame, by whoever is moving it. */
function movePaddle(
  state: State,
  side: Side,
  api: UpdateApi,
  playing: boolean,
  dt: number,
): PaddleState {
  const paddle = state.paddles[side];

  // The debug surface holds this side: it travels at that side's `drivenVy`,
  // through the same integrator and the same clamp, and neither the input actions
  // nor the AI touch it. Driving one side leaves the other exactly as it was.
  if (paddle.driven) {
    const moved = integratePaddle({ cy: paddle.cy, vy: paddle.drivenVy }, dt);
    return { ...paddle, cy: moved.cy, vy: moved.vy };
  }

  // Solo's right paddle is the computer opponent's.
  if (state.mode === "solo" && side === "right") {
    const moved = updateAi(paddle, state.ai, state.ball, playing, dt);
    return { ...paddle, cy: moved.cy, vy: moved.vy };
  }

  // Solo has no player two, so both sliders drive the one human paddle; Versus
  // gives each player its own.
  const axis =
    state.mode === "solo"
      ? soloAxis(api)
      : side === "left"
        ? p1Axis(api)
        : p2Axis(api);
  const moved = integratePaddle({ cy: paddle.cy, vy: axis * PADDLE_SPEED }, dt);
  return { ...paddle, cy: moved.cy, vy: moved.vy };
}

function updatePaddles(
  state: CaromState,
  api: UpdateApi,
  dt: number,
): CaromState {
  const playing = state.screen === "playing";
  return {
    ...state,
    paddles: {
      left: movePaddle(state, "left", api, playing, dt),
      right: movePaddle(state, "right", api, playing, dt),
    },
  };
}

function checkWin(score: { p1: number; p2: number }): Side | null {
  const { p1, p2 } = score;
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

function scorePoint(
  state: CaromState,
  api: UpdateApi,
  scorer: Side,
): CaromState {
  const score =
    scorer === "left"
      ? { p1: state.score.p1 + 1, p2: state.score.p2 }
      : { p1: state.score.p1, p2: state.score.p2 + 1 };
  api.audio.play(CUES.score);

  const winner = checkWin(score);
  if (winner) {
    // The ball is left exactly where it is (specs/balls.md).
    return { ...state, score, winner, screen: "matchover", menuIndex: 0 };
  }
  // The next serve travels toward the player who was just scored on.
  return {
    ...state,
    score,
    receiver: scorer === "left" ? "right" : "left",
    ball: parkedBall(),
    screen: "countdown",
  };
}

/** A point is scored the moment the ball has fully passed a goal edge. */
function checkGoals(state: CaromState, api: UpdateApi): CaromState {
  const ball = state.ball;
  if (!ball) return state;
  if (ball.x - BALL_R > FIELD_W) return scorePoint(state, api, "left");
  if (ball.x + BALL_R < 0) return scorePoint(state, api, "right");
  return state;
}

/** One `playing` frame's ball: the sub-stepped flight, its cues, and the goals. */
function advanceBall(
  state: CaromState,
  api: UpdateApi,
  dt: number,
): CaromState {
  const ball = state.ball;
  // An absent ball takes no part in a frame (specs/instrumentation.md).
  if (!ball) return state;

  const { ball: moved, events } = step(
    ball,
    state.paddles.left,
    state.paddles.right,
    state.obstacles,
    dt,
  );
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/audio.md).
  if (events.paddle) api.audio.play(CUES.paddleHit);
  if (events.wall) api.audio.play(CUES.wallBounce);
  if (events.obstacle) api.audio.play(CUES.obstacleBounce);

  const next = recordTrail({ ...ball, ...moved }, state.simTime);
  return checkGoals({ ...state, ball: next }, api);
}

/**
 * One `countdown` frame: the hold counted down, and the serve on the first frame
 * it runs out (specs/balls.md).
 *
 * The ball is not advanced here — a waiting ball sits at its home point — but its
 * trail is still recorded, so the (collapsed) comet stays in step with the
 * simulation clock right up to the launch, which clears it.
 */
function advanceCountdown(state: CaromState, dt: number): CaromState {
  const ball = state.ball;
  if (!ball) return state;
  const waiting = recordTrail(
    { ...ball, holdTimer: ball.holdTimer - dt },
    state.simTime,
  );
  const next: CaromState = { ...state, ball: waiting };
  return waiting.holdTimer <= 0 ? serve(next) : next;
}

/**
 * The simulation advanced by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. `simTime` accumulates on every screen; a
 * menu screen advances nothing else, and the paused screen freezes the field
 * entirely (specs/ui.md).
 */
function advance(state: CaromState, api: UpdateApi, dt: number): CaromState {
  const screen = state.screen;
  const live = screen === "countdown" || screen === "playing";
  let next: CaromState = { ...state, simTime: state.simTime + dt };

  if (live) next = updatePaddles(next, api, dt);
  if (screen === "playing") next = advanceBall(next, api, dt);
  else if (screen === "countdown") next = advanceCountdown(next, dt);

  // The clock advances ONCE per frame, after the ball has taken every sub-step,
  // so all of a frame's sub-steps faced one obstacle pose (specs/playfield.md).
  // Re-posing on every frame — not only on the frames that move it — is what
  // keeps `obstacles` equal to the formula at `obstacleClock` at all times.
  const clock =
    live && next.obstacleClockRunning
      ? next.obstacleClock + dt
      : next.obstacleClock;
  return withObstacleClock(next, clock);
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
   * the frame advances (specs/ui.md).
   */
  update(state: State, api: UpdateApi, dt: number): CaromState {
    // Mute works on every screen, so its edge is read here rather than inside
    // the per-screen handling, and exactly once. THE STATE CARRIES THE BIT,
    // because `setMuted` poses it through the debug surface, which is a pure
    // state transform and cannot reach the engine's bus; the bus is brought
    // into line with the state BEFORE the frame advances, so a cue raised by
    // this frame's own collisions is already silenced.
    const muted = mute(api) ? !state.muted : state.muted;
    if (api.audio.muted() !== muted) api.audio.setMuted(muted);
    const next = advance(handleInput(state, api), api, dt);
    return { ...next, muted };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: State, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
