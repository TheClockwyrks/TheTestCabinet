// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, when the engine is initialized; it
// returns the state and the surface together, as `[state, debug]`. `update` and
// `render` then run once each per frame — `update` first, with the frame's delta
// time in SECONDS, then `render`. The state is the only channel between them, and
// it is a VALUE: `update` is handed the current state as a `DeepReadonly` view and
// returns the next one, the engine stores what it returned, and `render` draws
// that. No function in this build writes to a state it was handed; every one of
// them is a transition, current state in and next state out, built by spreading
// what it keeps around what it changes.
//
// There is no fixed timestep here and no accumulator. Every rate in
// `src/constants.ts` is per second and every one of them is multiplied by `dt`,
// which is what makes the simulation depend on how much TIME has passed rather
// than on how many frames have gone by: the same second of play reaches the same
// state whether it arrived as one long step, as a hundred short ones, or as an
// uneven mixture. That is the property specs/balls.md requires and the property
// the debug surface in `src/debug.ts` leans on.
//
// THE STATE SHAPE BELOW IS A CONTRACT. specs/state.md declares it and this module
// carries that declaration verbatim: it is what the debug surface reads and poses,
// and what this case's checks read back. So:
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
//   * Every field is `readonly` and every array is a `readonly` array, so the
//     declared type and the `DeepReadonly` view the engine hands out are the same
//     shape: a transition spreads a state into the next one without a cast.

import {
  BALL_R,
  CUES,
  FIELD_W,
  PADDLE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { integratePaddle } from "./entities";
import { aiPaddle } from "./ai";
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
import { itemAt, menuFor } from "./menus";
import { step } from "./physics";
import {
  createInitialState,
  respawn,
  startMatch,
  toTitle,
  serveBall,
} from "./match";
import { renderGame } from "./render";
import { COLOR } from "./theme";
import { recordTrail } from "./trail";
import type {
  Game,
  InitApi,
  PointerSample,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

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
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "matchover";

/** The two screens a pause can resume to. */
export type ResumeScreen = "countdown" | "playing";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/** One paddle. `x` is fixed by the side, so only the vertical axis is state. */
export interface PaddleState {
  /** Center y, in logical units. Clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY]. */
  readonly cy: number;
  /**
   * The paddle's actual vertical velocity this frame, in units per second, after
   * the integration specs/playfield.md fixes. This is what the spin mechanic
   * reads at contact, so a paddle pinned against a bound reports zero even while
   * a movement action is held.
   */
  readonly vy: number;
  /**
   * Whether the debug surface is moving this paddle rather than the player or
   * the AI. `setPaddleDriven` is the only pose that changes it.
   */
  readonly driven: boolean;
  /**
   * The velocity a driven paddle moves at, in units per second. `setPaddleVy` is
   * the only pose that sets it, it holds its value across frames whether or not
   * the paddle is driven, and it is a separate field from `vy`.
   */
  readonly drivenVy: number;
}

/** The AI's two faculties, each gated on its own (specs/instrumentation.md). */
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
  /** True while the ball waits at its home point rather than flying. */
  readonly held: boolean;
  /** Seconds remaining of that wait. */
  readonly holdTimer: number;
  /** The ball's trail samples, oldest first. */
  readonly trail: readonly TrailSample[];
}

/** One obstacle present in the field, at its fixed center. */
export interface ObstacleState {
  /** Its index in the order of OBSTACLE_CENTERS. */
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * Where one pointer's current press began.
 *
 * Bookkeeping for the pointer rule specs/ui.md fixes — a confirm takes BOTH its
 * edges inside one item's region, so the release has to know where the press
 * landed, and a press and its release are frames apart. It is not part of the
 * declared state: nothing poses it, nothing reads it back, and it is rebuilt
 * from the pointer stream alone. It lives in `CaromState` rather than in a
 * module-level variable because specs/state.md requires every value the game
 * carries between frames to live in the state.
 */
export interface PressAnchor {
  /** The pointer the press came from, so several contacts are told apart. */
  readonly id: number;
  /** The screen the press landed on. */
  readonly screen: Screen;
  /** The menu item it landed in, or `-1` for a press outside every region. */
  readonly index: number;
}

/**
 * The whole of Carom's state.
 *
 * Every field is present from the moment `initialize` returns, and every one is
 * plain data: numbers, strings, booleans and containers of them, so a scenario
 * can be posed by spreading a change over it and read back the same way.
 */
export interface CaromState {
  /** The screen currently shown (specs/ui.md). */
  readonly screen: Screen;
  /** The mode the current or most recent match is played in. */
  readonly mode: Mode;
  /** The highlighted item on whichever menu `screen` is showing. */
  readonly menuIndex: number;
  /** The title menu's remembered selection. */
  readonly titleIndex: number;
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  readonly resumeScreen: ResumeScreen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  readonly score: { readonly p1: number; readonly p2: number };
  /** The winning side once the match is over, and null until then. */
  readonly winner: Side | null;

  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  /** The AI's two faculties. */
  readonly ai: AiState;

  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match always travels toward player one ("left").
   */
  readonly receiver: Side;
  /** The single ball, or null while no ball is present. */
  readonly ball: BallState | null;
  /** Every obstacle present, in the order of OBSTACLE_CENTERS. */
  readonly obstacles: readonly ObstacleState[];

  /** Accumulated simulation time, in seconds. */
  readonly simTime: number;
  /**
   * The mute bit. `setMuted` poses it through the debug surface, the `mute`
   * action toggles it, and every `update` brings the engine's own bus into line
   * with it, so what `snapshot()` reports is what the player hears.
   */
  readonly muted: boolean;
  /** The seed the game's random generator was last seeded from. */
  readonly seed: number;
  /** The whole state of that generator, as a single number. */
  readonly rngState: number;

  /** The presses in flight. Derived bookkeeping; see {@link PressAnchor}. */
  readonly presses: readonly PressAnchor[];
}

// ---- Screen moves -------------------------------------------------------

function pauseMatch(state: CaromState): CaromState {
  return {
    ...state,
    resumeScreen: state.screen === "countdown" ? "countdown" : "playing",
    screen: "paused",
    menuIndex: 0,
  };
}

function resumeMatch(state: CaromState): CaromState {
  return { ...state, screen: state.resumeScreen };
}

// ---- Menus --------------------------------------------------------------

/** What confirming the item at `index` does on the screen the state is on. */
type Select = (state: CaromState, index: number) => CaromState;

function selectTitle(state: CaromState, index: number): CaromState {
  // Confirming a title item is what sets the remembered selection, from the
  // keyboard, a pointer and a touch contact alike (specs/ui.md).
  const remembered = { ...state, titleIndex: index };
  if (index === 0) return startMatch(remembered, "solo");
  if (index === 1) return startMatch(remembered, "versus");
  return { ...remembered, screen: "howto", menuIndex: 0 };
}

function selectHowTo(state: CaromState, _index: number): CaromState {
  return toTitle(state);
}

function selectPause(state: CaromState, index: number): CaromState {
  if (index === 0) return resumeMatch(state);
  if (index === 1) return startMatch(state, state.mode);
  return toTitle(state);
}

function selectMatchOver(state: CaromState, index: number): CaromState {
  if (index === 0) return startMatch(state, state.mode);
  return toTitle(state);
}

/** The number of items on the menu the current screen shows. */
function menuCount(state: CaromState): number {
  return menuFor(state.screen)?.items.length ?? 0;
}

/**
 * One frame of a menu screen: this frame's keyboard edges, then this frame's
 * pointer and touch.
 *
 * All three keyboard edges are read before any is acted on, so exactly one press
 * is consumed per action and none is left armed for a later frame. The order
 * specs/ui.md fixes is up before down and movement before `confirm`, and the
 * pointer is applied after every keyboard edge.
 */
function menuFrame(
  state: CaromState,
  api: UpdateApi,
  select: Select,
): CaromState {
  const count = menuCount(state);
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);

  if (up) {
    return pointerFrame(
      { ...state, menuIndex: (state.menuIndex + count - 1) % count },
      api,
      select,
      false,
    );
  }
  if (down) {
    return pointerFrame(
      { ...state, menuIndex: (state.menuIndex + 1) % count },
      api,
      select,
      false,
    );
  }
  if (accepted) {
    // A frame carrying a keyboard confirm together with a pointer confirm
    // confirms the keyboard's item alone (specs/ui.md), so the pointer pass runs
    // for its bookkeeping and confirms nothing.
    return pointerFrame(select(state, state.menuIndex), api, select, true);
  }
  return pointerFrame(state, api, select, false);
}

/** The item one pointer sample landed in, or `null` for a miss. */
function sampleItem(state: CaromState, sample: PointerSample): number | null {
  const menu = menuFor(state.screen);
  return menu ? itemAt(menu, sample.x, sample.y) : null;
}

/**
 * This frame's pointer and touch, applied after the keyboard edges.
 *
 * Every sample the input frame collected is replayed in arrival order, which is
 * what makes a sweep that crossed several items select the last one it entered
 * rather than only the position it ended at. A press records where it landed, a
 * move selects the item it moves onto, and a release confirms only when it falls
 * inside the very item its own press did (specs/ui.md).
 */
function pointerFrame(
  state: CaromState,
  api: UpdateApi,
  select: Select,
  keyboardConfirmed: boolean,
): CaromState {
  const samples = api.input.pointerSamples();
  if (samples.length === 0) return state;

  let next = state;
  let presses = state.presses;
  let spent = keyboardConfirmed;

  for (const sample of samples) {
    const index = sampleItem(next, sample);
    if (sample.type === "down") {
      presses = [
        ...presses.filter((press) => press.id !== sample.id),
        { id: sample.id, screen: next.screen, index: index ?? -1 },
      ];
      // A finger does not hover, so a landing is what selects under touch.
      if (!spent && sample.device === "touch" && index !== null) {
        next = { ...next, menuIndex: index };
      }
      continue;
    }
    if (sample.type === "move") {
      if (!spent && index !== null) next = { ...next, menuIndex: index };
      continue;
    }
    const anchor = presses.find((press) => press.id === sample.id);
    presses = presses.filter((press) => press.id !== sample.id);
    if (
      !spent &&
      anchor !== undefined &&
      index !== null &&
      anchor.index === index &&
      anchor.screen === next.screen
    ) {
      next = select({ ...next, menuIndex: index }, index);
      spent = true;
    }
  }

  return { ...next, presses };
}

// ---- Edge input (once per frame) ----------------------------------------

/**
 * Read this frame's one-shot actions and act on them.
 *
 * Every edge read in Carom happens here, once, which is what the engine's
 * consume-on-read edges ask for: two readers of the same action in one frame
 * would split one press between them.
 */
function handleInput(state: CaromState, api: UpdateApi): CaromState {
  switch (state.screen) {
    case "title": {
      // `back` is read on the title and does nothing there (specs/ui.md).
      back(api);
      return menuFrame(state, api, selectTitle);
    }
    case "howto":
      // `back` and `confirm` both leave; `back` is read first, and the menu pass
      // reads `confirm` and drives the single item a pointer can also confirm.
      return back(api) ? toTitle(state) : menuFrame(state, api, selectHowTo);
    case "countdown":
    case "playing":
      // `pause` is read here and `back` is not, so one Escape opens the pause
      // menu and leaves it open (specs/ui.md).
      return pause(api) ? pauseMatch(state) : state;
    case "paused": {
      // `pause` and `back` are read before the menu edges, and a frame carrying
      // either resumes and does nothing else. Escape raises both, so one Escape
      // resumes once.
      const paused = pause(api);
      const left = back(api);
      return paused || left
        ? resumeMatch(state)
        : menuFrame(state, api, selectPause);
    }
    case "matchover":
      return back(api)
        ? toTitle(state)
        : menuFrame(state, api, selectMatchOver);
  }
}

// ---- Simulation ---------------------------------------------------------

/**
 * One paddle after this frame's movement.
 *
 * A driven paddle moves at its own `drivenVy` and neither the input actions nor
 * the AI touch it; the AI plays the right paddle in Solo; every other paddle is a
 * player's. Whoever moved it, the integration and the clamp are the one rule
 * specs/playfield.md fixes.
 */
function updatePaddle(
  state: CaromState,
  api: UpdateApi,
  side: Side,
  dt: number,
): PaddleState {
  const paddle = state.paddles[side];
  if (paddle.driven) return integratePaddle(paddle, paddle.drivenVy, dt);

  if (side === "right" && state.mode === "solo") {
    return aiPaddle(
      paddle,
      state.ball,
      state.ai,
      state.screen === "playing",
      dt,
    );
  }

  // Player one (left). Solo has no player two, so both sliders drive that paddle.
  const axis = playerAxis(state, api, side);
  return integratePaddle(paddle, axis * PADDLE_SPEED, dt);
}

/** The held axis driving one side's paddle, in `{-1, 0, 1}` (specs/modes/). */
function playerAxis(state: CaromState, api: UpdateApi, side: Side): number {
  if (side === "right") return p2Axis(api);
  return state.mode === "solo" ? soloAxis(api) : p1Axis(api);
}

function updatePaddles(
  state: CaromState,
  api: UpdateApi,
  dt: number,
): CaromState["paddles"] {
  return {
    left: updatePaddle(state, api, "left", dt),
    right: updatePaddle(state, api, "right", dt),
  };
}

function checkWin(score: CaromState["score"]): Side | null {
  const { p1, p2 } = score;
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

function score(state: CaromState, api: UpdateApi, scorer: Side): CaromState {
  const tally =
    scorer === "left"
      ? { ...state.score, p1: state.score.p1 + 1 }
      : { ...state.score, p2: state.score.p2 + 1 };
  api.audio.play(CUES.score);

  const winner = checkWin(tally);
  if (winner) {
    // The ball is left exactly where it was when it crossed the goal.
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
function checkGoals(state: CaromState, api: UpdateApi): CaromState {
  const ball = state.ball;
  if (ball === null) return state;
  if (ball.x - BALL_R > FIELD_W) return score(state, api, "left");
  if (ball.x + BALL_R < 0) return score(state, api, "right");
  return state;
}

/** One frame of the live rally: the ball's flight, its cues, and any goal. */
function playRally(state: CaromState, api: UpdateApi, dt: number): CaromState {
  const ball = state.ball;
  if (ball === null) return state;

  const flight = step(
    ball,
    state.paddles.left,
    state.paddles.right,
    state.obstacles,
    dt,
  );
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/audio.md).
  if (flight.events.paddle) api.audio.play(CUES.paddleHit);
  if (flight.events.wall) api.audio.play(CUES.wallBounce);
  if (flight.events.obstacle) api.audio.play(CUES.obstacleBounce);
  const flown = { ...state, ball: recordTrail(flight.ball, state.simTime) };
  return checkGoals(flown, api);
}

/** One frame of the pre-serve hold: the countdown, and the serve when it ends. */
function holdBall(state: CaromState, dt: number): CaromState {
  const ball = state.ball;
  if (ball === null) return state;

  const counted = { ...ball, holdTimer: ball.holdTimer - dt };
  // The ball is not advanced on the frame it is served, so the serve is applied
  // to the counted-down ball and the trail is recorded either way.
  if (counted.holdTimer <= 0) return serveBall({ ...state, ball: counted });
  return { ...state, ball: recordTrail(counted, state.simTime) };
}

/**
 * The state after `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * clock; the paused screen freezes the field entirely.
 */
function advance(state: CaromState, api: UpdateApi, dt: number): CaromState {
  const ticked = { ...state, simTime: state.simTime + dt };

  switch (ticked.screen) {
    case "countdown":
      return holdBall(
        { ...ticked, paddles: updatePaddles(ticked, api, dt) },
        dt,
      );
    case "playing":
      return playRally(
        { ...ticked, paddles: updatePaddles(ticked, api, dt) },
        api,
        dt,
      );
    default:
      return ticked;
  }
}

// ---- The game the engine drives -----------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the four cues, register the diagnostic sources, build the complete
   * initial state, and return it beside the debug surface.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one. The surface is returned beside the
   * state because the pair is what the engine holds: by the time this resolves,
   * `engine.debug` carries it (specs/instrumentation.md).
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
   * The order matters. Edges are news for exactly one frame — the engine
   * discards whatever was not consumed — so they are read first, at the top of
   * the frame they belong to, and the state they may have changed is the state
   * the rest of the frame advances.
   */
  update(
    state: DeepReadonly<CaromState>,
    api: UpdateApi,
    dt: number,
  ): CaromState {
    // Mute works on every screen, so its edge is read here rather than inside
    // the per-screen handling, and exactly once. THE STATE CARRIES THE BIT,
    // because `setMuted` poses it through the debug surface, which is a pure
    // state transform and cannot reach the engine's bus; the bus is brought
    // into line with the state BEFORE the frame advances, so a cue raised by
    // this frame's own collisions is already silenced.
    const muted = mute(api) ? !state.muted : state.muted;
    if (api.audio.muted() !== muted) api.audio.setMuted(muted);
    const advanced = advance(handleInput(state, api), api, dt);
    return { ...advanced, muted };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<CaromState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
