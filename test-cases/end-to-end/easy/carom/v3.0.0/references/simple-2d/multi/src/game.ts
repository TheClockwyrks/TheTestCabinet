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
import { integratePaddle, obstacleRect, parkBall } from "./entities";
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
import { readPointerMenu } from "./pointer";
import { step } from "./physics";
import { renderGame } from "./render";
import { COLOR, HOWTO_ITEMS } from "./theme";
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
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "matchover";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/** The two screens a pause can resume to. */
export type ResumeScreen = "countdown" | "playing";

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
   * the AI (specs/instrumentation.md). Each side is taken on its own.
   */
  readonly driven: boolean;
  /**
   * The velocity a driven paddle moves at, in units per second. `setPaddleVy` is
   * the only thing that sets it, and it holds its value across frames whether or
   * not the paddle is driven.
   */
  readonly drivenVy: number;
}

/**
 * The AI opponent's two faculties, each gated on its own
 * (specs/modes/single-player.md).
 */
export interface AiState {
  /** Whether the AI senses the balls and chooses a target. */
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

/**
 * One ball. `speed` is derived (`hypot(vx, vy)`) and is not stored.
 *
 * Every field is that ball's own, which is the whole of what makes the three
 * independent: they carry separate velocities, separate spin, separate holds, and
 * separate trails (specs/balls.md).
 */
export interface BallState {
  /** This ball's place in play order, from 0 to BALL_COUNT - 1. */
  readonly index: number;
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
  /**
   * The angle, in radians, the next launch leaves along: drawn afresh whenever
   * the ball is parked and posed by the debug surface (specs/balls.md).
   */
  readonly launchAngle: number;
  /** This ball's recent positions, oldest first, for its own motion trail. */
  readonly trail: readonly TrailSample[];
}

/**
 * One obstacle, at its fixed center. Which obstacles are present is state
 * (specs/state.md); where a present one sits is not.
 */
export interface ObstacleState {
  /** Its place in the order of OBSTACLE_CENTERS, 0 or 1. */
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * One pointer's press, remembered from the frame it landed on.
 *
 * specs/ui.md confirms a menu item only when a press AND the release that
 * follows it fall inside one item's region, and the two edges may arrive on
 * different frames — so where a press landed has to survive to the frame its
 * release arrives on. It is transient input bookkeeping rather than authoritative
 * game state, but it is a value the game carries from one frame to the next, so
 * specs/state.md puts it here rather than in a module-level variable or a
 * closure. Nothing in the snapshot reports it and no operation of the debug
 * surface poses it.
 */
export interface PointerPress {
  /** The pointer the press belongs to, as the runtime numbers them. */
  readonly id: number;
  /** The menu item the press landed on, or -1 when it landed on none. */
  readonly index: number;
  /** The screen it landed on, so a press cannot confirm on another one. */
  readonly screen: Screen;
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
  /** The title menu's remembered selection (specs/ui.md). */
  readonly titleIndex: number;
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  readonly resumeScreen: ResumeScreen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  readonly score: { readonly p1: number; readonly p2: number };
  /** The winning side once the match is over, and null until then. */
  readonly winner: Side | null;

  /** The two paddles. Both are always present. */
  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  /** The AI opponent's faculties. */
  readonly ai: AiState;

  /**
   * The balls PRESENT in the field, in play order (specs/balls.md). They never
   * start, reset, or score as a group: each runs its own hold and its own
   * respawn while the other two carry on. An absent ball is simply not here.
   */
  readonly balls: readonly BallState[];
  /** The obstacles PRESENT in the field, in the order of OBSTACLE_CENTERS. */
  readonly obstacles: readonly ObstacleState[];

  /** Accumulated simulation time, in seconds. */
  readonly simTime: number;
  /**
   * The mute bit. `setMuted` poses it through the debug surface, the `mute`
   * action toggles it, and every `update` brings the engine's own bus into line
   * with it, so what `snapshot()` reports is what the player hears.
   */
  readonly muted: boolean;

  /**
   * The presses the menus are waiting on a release for. Not a declared field:
   * see {@link PointerPress} for why it lives in the state anyway.
   */
  readonly presses: readonly PointerPress[];
}

/** The read-only view of the state every transition below is handed. */
export type State = DeepReadonly<CaromState>;

// ---- Screen transitions -------------------------------------------------

/**
 * One ball launched from its home point at SERVE_SPEED along its own
 * `launchAngle`.
 *
 * The angle was drawn when the ball was parked, or posed since, and the launch
 * leaves it as it is (specs/balls.md).
 */
function launch(ball: BallState): BallState {
  return {
    ...ball,
    vx: SERVE_SPEED * Math.cos(ball.launchAngle),
    vy: SERVE_SPEED * Math.sin(ball.launchAngle),
    spin: 0,
    held: false,
    holdTimer: 0,
    trail: [],
  };
}

/**
 * Every waiting ball's hold counted down, each launched the moment its own timer
 * elapses. The three are independent, so one relaunching leaves the others
 * alone.
 */
function tickHolds(state: State, dt: number): CaromState {
  const balls: BallState[] = [];
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
    balls.push(launch({ ...ball, holdTimer: 0 }));
  }
  return { ...state, balls };
}

/** The ball the AI defends: of those flying at its goal, the one arriving first. */
export function threatBall(
  balls: readonly DeepReadonly<BallState>[],
): DeepReadonly<BallState> | null {
  let soonest: DeepReadonly<BallState> | null = null;
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
    presses: [],
  };
}

function resumeMatch(state: State): CaromState {
  return { ...state, screen: state.resumeScreen, presses: [] };
}

// ---- The menus ----------------------------------------------------------

/** What one menu screen offers, and what confirming an item there does. */
interface MenuScreen {
  readonly count: number;
  confirm(state: State, index: number): CaromState;
}

function selectTitle(state: State, index: number): CaromState {
  // Confirming a title item is what the title menu remembers (specs/ui.md), so
  // every path back here later restores this selection.
  const remembered: CaromState = { ...state, titleIndex: index, presses: [] };
  if (index === 0) return startMatch(remembered, "solo");
  if (index === 1) return startMatch(remembered, "versus");
  return { ...remembered, screen: "howto", menuIndex: 0 };
}

function selectHowTo(state: State, _index: number): CaromState {
  return toTitle(state);
}

function selectPause(state: State, index: number): CaromState {
  if (index === 0) return resumeMatch(state);
  if (index === 1) return startMatch({ ...state, presses: [] }, state.mode);
  return toTitle(state);
}

function selectMatchOver(state: State, index: number): CaromState {
  if (index === 0) return startMatch({ ...state, presses: [] }, state.mode);
  return toTitle(state);
}

/** The menu a screen shows, or null on the two screens that show none. */
function menuScreenFor(screen: Screen): MenuScreen | null {
  switch (screen) {
    case "title":
      return { count: TITLE_ITEMS.length, confirm: selectTitle };
    case "howto":
      return { count: HOWTO_ITEMS.length, confirm: selectHowTo };
    case "paused":
      return { count: PAUSE_ITEMS.length, confirm: selectPause };
    case "matchover":
      return { count: MATCHOVER_ITEMS.length, confirm: selectMatchOver };
    default:
      return null;
  }
}

// ---- Edge input (once per frame) ----------------------------------------

/**
 * This frame's one-shot actions read and acted on: the state after them.
 *
 * Every edge read in Carom happens here, once, which is what the engine's
 * consume-on-read edges ask for: two readers of the same action in one frame
 * would split one press between them. The screen the frame BEGAN on is what
 * decides which actions are read (specs/ui.md), so a screen an update reaches
 * takes its first input on the following update.
 */
function handleInput(state: State, api: UpdateApi): CaromState {
  switch (state.screen) {
    case "countdown":
    case "playing":
      // A match is live, so Escape means `pause`. It raises `back` on the same
      // frame, which no live screen reads, so the pause menu opens and stays.
      return pause(api) ? pauseMatch(state) : state;
    case "paused": {
      // `pause` and `back` are read BEFORE the menu edges, and a frame carrying
      // either resumes and does nothing else — which is what makes one Escape,
      // raising both, resume exactly once.
      const paused = pause(api);
      const left = back(api);
      if (paused || left) return resumeMatch(state);
      return menuFrame(state, api);
    }
    case "title":
      // The title reads `back`, where it does nothing. It is read all the same,
      // so the edge is accounted for on the frame it arrived on.
      back(api);
      return menuFrame(state, api);
    case "howto": {
      // `back` and `confirm` both leave; `back` is read first and `confirm` is
      // the menu's own edge, so neither is left armed.
      if (back(api)) return toTitle(state);
      return menuFrame(state, api);
    }
    case "matchover": {
      if (back(api)) return toTitle(state);
      return menuFrame(state, api);
    }
  }
}

/**
 * One menu screen's frame of input: the keyboard edges, then the pointer and the
 * touch contacts (specs/ui.md).
 *
 * Up is applied before down and movement before `confirm`, so a frame carrying
 * both an up and a down edge moves up only and a frame carrying a movement edge
 * and a `confirm` edge moves only. The pointer is applied after all of them, so a
 * frame carrying a keyboard movement edge together with a pointer selection
 * leaves `menuIndex` where the pointer put it.
 */
function menuFrame(state: State, api: UpdateApi): CaromState {
  const menu = menuScreenFor(state.screen);
  if (menu === null) return state;

  // All three are read before any is acted on, so exactly one press moves the
  // selection or accepts it and nothing is left armed for a later frame.
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);

  let moved: CaromState = state;
  if (up) {
    moved = {
      ...state,
      menuIndex: (state.menuIndex + menu.count - 1) % menu.count,
    };
  } else if (down) {
    moved = { ...state, menuIndex: (state.menuIndex + 1) % menu.count };
  }

  const pointed = readPointerMenu(moved, api);
  const selected: CaromState = {
    ...moved,
    menuIndex: pointed.menuIndex,
    presses: pointed.presses,
  };
  if (accepted) {
    // A frame carrying a movement edge and a `confirm` edge moves only, and the
    // pointer's selection still stands over the keyboard's.
    if (up || down) return selected;
    // A frame carrying a keyboard `confirm` together with a pointer or touch
    // confirm confirms the KEYBOARD's item alone, so the index the keyboard was
    // looking at is the one acted on.
    return menu.confirm(
      { ...moved, presses: pointed.presses },
      moved.menuIndex,
    );
  }
  return pointed.confirmed
    ? menu.confirm(selected, selected.menuIndex)
    : selected;
}

// ---- Simulation ---------------------------------------------------------

/**
 * One paddle moved for this frame.
 *
 * A DRIVEN paddle follows that side's `drivenVy` through the real integrator and
 * neither the input actions nor the AI touch it (specs/instrumentation.md). Each
 * side is taken on its own, so a scenario can drive one paddle and leave the
 * other to the player or the opponent.
 */
function updatePaddles(state: State, api: UpdateApi, dt: number): CaromState {
  const live = state.screen === "playing";
  const solo = state.mode === "solo";

  const leftPaddle = state.paddles.left;
  const left = leftPaddle.driven
    ? integratePaddle({ ...leftPaddle, vy: leftPaddle.drivenVy }, dt)
    : integratePaddle(
        {
          ...leftPaddle,
          vy: (solo ? soloAxis(api) : p1Axis(api)) * PADDLE_SPEED,
        },
        dt,
      );

  const rightPaddle = state.paddles.right;
  let right: PaddleState;
  if (rightPaddle.driven) {
    right = integratePaddle({ ...rightPaddle, vy: rightPaddle.drivenVy }, dt);
  } else if (solo) {
    right = updateAi(rightPaddle, threatBall(state.balls), state.ai, live, dt);
  } else {
    right = integratePaddle(
      { ...rightPaddle, vy: p2Axis(api) * PADDLE_SPEED },
      dt,
    );
  }

  return { ...state, paddles: { left, right } };
}

function checkWin(score: State["score"]): Side | null {
  const { p1, p2 } = score;
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

/** The state after `scorer` takes a point with the ball at `at` in `balls`. */
function score(
  state: State,
  api: UpdateApi,
  scorer: Side,
  at: number,
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
      presses: [],
    };
  }
  // Only the ball that crossed is affected: it takes its own home point and a
  // fresh hold, and the other two carry on uninterrupted.
  return {
    ...state,
    score: scored,
    balls: state.balls.map((ball, i) =>
      i === at ? parkBall(ball.index, HOLD_TIME) : ball,
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

  const stepped = step(
    held.balls,
    held.paddles.left,
    held.paddles.right,
    held.obstacles.map(obstacleRect),
    dt,
  );
  // One cue per event that actually happened. A frame long enough to contain two
  // different kinds of bounce plays both, because each is its own event and each
  // has its own cue (specs/audio.md). A ball-to-ball hit is ONE event between two
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

  /** Runs once per frame, after `update`, with the state it returned. Draws. */
  render(state: State, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
