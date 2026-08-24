// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, when the engine is initialized; it
// returns the state and the surface together, as `[state, debug]`. `update` and
// `render` then run once each per frame — `update` first, with the frame's delta
// time in SECONDS, then `render`.
//
// The state is a VALUE, and every frame is a transition over it. `update` is
// handed the current state as a read-only view (`DeepReadonly<CaromState>`) and
// returns the next state; the engine stores what it returns, hands that to
// `render` under the same view, and hands it to the next `update`. Nothing in
// this build ever holds a writable `CaromState`: every function below, and every
// module beside this one, takes a state (or a slice of one) and returns a new
// one, built by spreading the parts that change over the parts that do not. The
// compiler is what enforces that — `render` cannot change what it is handed, and
// nothing but a transition advances the simulation — so no comment here has to
// ask for it.
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
  HOLD_TIME,
  MATCHOVER_ITEMS,
  P2_X0,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_SPEED,
  TITLE_ITEMS,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { integratePaddle, parkBall } from "./entities";
import { createInitialState, startMatch, toTitle } from "./flow";
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
   * The paddle's actual vertical velocity this frame, in units per second. This
   * is what the spin mechanic reads at contact, so a paddle pinned against a
   * bound reports zero even while a movement action is held.
   */
  readonly vy: number;
}

/**
 * One ball. `speed` is derived (`hypot(vx, vy)`) and is not stored.
 *
 * Every field is that ball's own, which is the whole of what makes the three
 * independent: they carry separate velocities, separate spin, separate holds, and
 * separate trails (specs/balls.md).
 */
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
   * True while the ball waits at its home point rather than flying. A waiting
   * ball is motionless and SOLID: another ball that reaches it bounces off, and
   * it launches when its own hold timer elapses and at no other moment.
   */
  readonly held: boolean;
  /**
   * Seconds remaining of that wait. HOLD_TIME when the ball takes its home point,
   * counting down to 0, at which point it launches; 0 while it is in flight.
   */
  readonly holdTimer: number;
  /** This ball's recent positions, oldest first, for its own motion trail. */
  readonly trail: readonly TrailSample[];
}

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  readonly x: number;
  readonly y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  readonly t: number;
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
 * can be posed by building the next state and read back by reading this one.
 * Every field is declared `readonly`, and every array is a readonly array, so the
 * declared type and the `DeepReadonly` view the engine hands out are one and the
 * same: a function that spreads a read-only state into a new one has built a
 * `CaromState`, with no cast.
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

  /** The two paddles. */
  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  /**
   * The three balls in play, in play order (specs/balls.md). They never start,
   * reset, or score as a group: each runs its own hold and its own respawn while
   * the other two carry on.
   */
  readonly balls: readonly BallState[];

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

/** The read-only view of the state every transition below is handed. */
export type State = DeepReadonly<CaromState>;

// ---- Screen transitions -------------------------------------------------

/**
 * One ball launched from its home point at SERVE_SPEED, beside the generator
 * state after the draw.
 *
 * The direction is a fresh uniform draw over the full circle from the seeded
 * generator, the one piece of randomness this game has, and it is the same draw
 * for the first launch of a match and for every relaunch (specs/balls.md).
 */
function launch(
  ball: BallState,
  rngState: number,
): { ball: BallState; rngState: number } {
  const [angle, next] = nextAngle(rngState);
  return {
    ball: {
      ...ball,
      vx: SERVE_SPEED * Math.cos(angle),
      vy: SERVE_SPEED * Math.sin(angle),
      spin: 0,
      held: false,
      holdTimer: 0,
      trail: [],
    },
    rngState: next,
  };
}

/**
 * Every waiting ball's hold counted down, each launched the moment its own timer
 * elapses. The three are independent, so one relaunching leaves the others
 * alone. The generator threads through the launches in play order, so the state
 * returned carries the draw every launch this frame made.
 */
function tickHolds(state: State, dt: number): CaromState {
  const balls: BallState[] = [];
  let rngState = state.rngState;
  for (const ball of state.balls) {
    if (!ball.held) {
      balls.push(ball);
      continue;
    }
    const holdTimer = ball.holdTimer - dt;
    if (holdTimer > 0) {
      balls.push({ ...ball, holdTimer });
      continue;
    }
    const launched = launch({ ...ball, holdTimer }, rngState);
    balls.push(launched.ball);
    rngState = launched.rngState;
  }
  return { ...state, balls, rngState };
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
 * This frame's one-shot actions read and acted on: the state after them.
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
      // A menu is up, so Escape means `back` — which here is "to the title".
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
  if (up) return { ...state, menuIndex: (state.menuIndex + count - 1) % count };
  if (down) return { ...state, menuIndex: (state.menuIndex + 1) % count };
  if (accepted) return onConfirm(state, state.menuIndex);
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
        ? updateAi(state.paddles.right, threatBall(state.balls), live, dt)
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
      ? updateAi(state.paddles.right, threatBall(state.balls), live, dt)
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

/** The state after `scorer` takes a point with ball `index`. */
function score(
  state: State,
  api: UpdateApi,
  scorer: Side,
  index: number,
): CaromState {
  const scored =
    scorer === "left"
      ? { p1: state.score.p1 + 1, p2: state.score.p2 }
      : { p1: state.score.p1, p2: state.score.p2 + 1 };
  api.audio.play(CUES.score);

  const winner = checkWin(scored);
  if (winner) {
    return {
      ...state,
      score: scored,
      winner,
      screen: "matchover",
      menuIndex: 0,
    };
  }
  // Only the ball that crossed is affected: it takes its own home point and a
  // fresh hold, and the other two carry on uninterrupted.
  return {
    ...state,
    score: scored,
    balls: state.balls.map((ball, i) =>
      i === index ? parkBall(index, HOLD_TIME) : ball,
    ),
  };
}

/** A point is scored the moment a ball has fully passed a goal edge. */
function checkGoals(state: State, api: UpdateApi): CaromState {
  let next: CaromState = state;
  for (let i = 0; i < next.balls.length; i++) {
    const ball = next.balls[i];
    if (ball.held) continue;
    if (ball.x - BALL_R > FIELD_W) next = score(next, api, "left", i);
    else if (ball.x + BALL_R < 0) next = score(next, api, "right", i);
    // A won match ends the frame: the remaining balls are frozen where they are.
    if (next.screen === "matchover") return next;
  }
  return next;
}

/**
 * The simulation advanced by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * clock; the paused screen freezes the field entirely.
 */
function advance(state: State, api: UpdateApi, dt: number): CaromState {
  const clocked: CaromState = { ...state, simTime: state.simTime + dt };

  if (clocked.screen !== "countdown" && clocked.screen !== "playing") {
    return clocked;
  }

  const paddled = updatePaddles(clocked, api, dt);
  // Every waiting ball counts its own hold down and launches when that hold
  // elapses, on the opening countdown and mid-rally alike. A waiting ball is
  // skipped by the step below, so the opening screen advances nothing but the
  // holds — the two screens run one simulation and differ only in what is drawn.
  const held = tickHolds(paddled, dt);

  const stepped = step(held.balls, held.paddles.left, held.paddles.right, dt);
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/ui.md). A ball-to-ball hit is ONE event between two
  // balls: `events.ball` records the frame a pair met rather than the balls it
  // happened to, so the cue plays once for the pair. Playing it from a loop over
  // the balls would sound the same contact twice, once for each side of it.
  const { events } = stepped;
  if (events.paddle) api.audio.play(CUES.paddleHit);
  if (events.wall) api.audio.play(CUES.wallBounce);
  if (events.obstacle) api.audio.play(CUES.obstacleBounce);
  if (events.ball) api.audio.play(CUES.ballBounce);
  const trailed: CaromState = {
    ...held,
    balls: stepped.balls.map((ball) => recordTrail(ball, held.simTime)),
  };
  const scored = checkGoals(trailed, api);

  // The opening countdown is over the moment the last ball has left its home.
  if (scored.screen === "countdown" && scored.balls.every((b) => !b.held)) {
    return { ...scored, screen: "playing" };
  }
  return scored;
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the five cues, register the diagnostic sources, build the complete
   * initial state, and hand the debug surface to the engine beside it.
   *
   * Nothing registered here closes over the state built here. Each diagnostic
   * source is handed the state current at the read, and the debug surface is a
   * set of transitions and readings over whatever state it is handed — because
   * the state a frame leaves behind is a new value, and anything holding the
   * first one would report the title screen forever. The pair is what the
   * engine holds: by the time this resolves, `engine.debug` is the surface and
   * `engine.state` is the value it operates on (specs/instrumentation.md).
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
    const advanced = advance(handleInput(state, api), api, dt);
    // The engine owns the mute bit; this is the game's readable copy of it, so the
    // HUD hint and `snapshot()` cannot drift from what the player actually hears.
    return { ...advanced, muted: api.audio.muted() };
  },

  /** Runs once per frame, after `update`, with the state it returned. Draws. */
  render(state: State, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
