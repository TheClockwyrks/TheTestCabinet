// Carom — the game: the state contract, the state machine, the per-frame update,
// and the binding of the three functions the runtime drives.
//
// A `Game<S>` is three functions and a state type. `initialize` runs once, when
// the runtime is initialized, and returns the state. `update` and `render` then run
// once each per frame — `update` first, with the frame's delta time in SECONDS,
// then `render`. The state is the only channel between them.
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
//   * Every field specs/state.md declares is declared here, under its declared
//     name, with its declared type and meaning.
//   * `initialize` builds the whole state in one go, which is why no field is
//     optional: by the time any frame can observe the state, every field is
//     present.
//   * Nothing authoritative lives anywhere else. There is no module-level game
//     state in this build and no closure over mutable data — every module beside
//     this one is arithmetic over the record below. `reset()` on the debug API
//     restores exactly these fields, so nothing survives a reset.
//
// WHAT IS ON THE FIELD IS ITSELF STATE. The ball may be absent (`null`) and the
// obstacle array carries only the obstacles present, because
// `specs/instrumentation.md` lets a scenario empty the field and spawn back
// exactly the bodies its requirement concerns. An absent body takes no part in a
// frame: it is not advanced, not drawn, and collides with nothing.

import {
  BALL_R,
  CUES,
  FIELD_W,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { defineCues } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import {
  centerPaddle,
  createBall,
  createPaddle,
  integratePaddle,
  restBall,
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
import { fullField, poseObstacles } from "./obstacles";
import { step } from "./physics";
import type { PointerSample } from "./pointer";
import { renderGame } from "./render";
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

/** The two screens a pause can resume to. */
export type ResumeScreen = "countdown" | "playing";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/** One paddle. `x` is fixed by the side, so only the vertical axis is state. */
export interface PaddleState {
  /** Center y, in logical pixels. Clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY]. */
  cy: number;
  /**
   * The paddle's actual vertical velocity this frame, in units per second, after
   * the integration specs/playfield.md fixes — whoever moved it. This is what the
   * spin mechanic reads at contact, so a paddle pinned against a bound reports
   * zero even while a movement action is held.
   */
  vy: number;
  /**
   * The velocity this paddle moves at while it is driven, in units per second.
   *
   * `setPaddleVy` is the only thing that writes it, it holds its value across
   * frames whether or not the paddle is driven, and it is a separate field from
   * `vy` — which is the INTEGRATED velocity of the frame just run
   * (specs/instrumentation.md).
   */
  drivenVy: number;
  /** Whether the debug surface is moving this paddle rather than the player or the AI. */
  driven: boolean;
}

/**
 * The AI's two faculties, each gated on its own (specs/instrumentation.md).
 *
 * They are declared state rather than a flag on the opponent, because the
 * opponent holds nothing: it is a pure function of the state, and these two are
 * the part of that state the surface poses.
 */
export interface AiState {
  /** Whether the AI senses the ball and chooses a target. */
  tracking: boolean;
  /** Whether the AI's paddle travels toward that target. */
  movement: boolean;
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
   * The signed lateral-curvature scalar (magnitude in units per second squared). Positive and
   * negative curve the flight opposite ways; it decays by half every
   * SPIN_HALFLIFE seconds and changes otherwise only on a paddle hit.
   */
  spin: number;
  /**
   * Whether the ball waits at its home point rather than flying. The ball's own
   * flag, so a pause leaves it exactly as it was (specs/state.md).
   */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /**
   * The vertical sign the serve takes, drawn afresh whenever the ball is parked
   * and posed by the debug surface (specs/balls.md).
   */
  serveSign: 1 | -1;
  /** Recent ball positions, oldest first, for the motion trail. */
  trail: TrailSample[];
}

/**
 * One obstacle's live pose — where it actually is this frame, and how far it has
 * turned.
 *
 * This is DERIVED from `obstacleClock` by the sway and spin formulas in
 * `specs/playfield.md`, but it is declared state because it is what the oriented
 * collision resolves against and what `snapshot().obstacles` reports. Recompute
 * all three fields from the clock rather than integrating them, so a scenario that
 * poses the clock faces exactly the pose the formula names.
 */
export interface ObstacleState {
  /** Its index in the order of OBSTACLE_CENTERS. */
  index: number;
  /** Live center x, in logical pixels. Never moves off the base center's x. */
  cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/**
 * One device's half-finished gesture: where it pressed, and on which screen.
 *
 * Not a declared field — `specs/state.md` names nothing here and a snapshot
 * reports none of it. It lives on the state anyway rather than in a closure,
 * because this build keeps no mutable data outside the record `reset()` restores,
 * and because carrying the SCREEN alongside the item is what makes a press whose
 * screen has since changed confirm nothing.
 */
export interface PointerHold {
  screen: Screen | null;
  item: number;
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
  /**
   * The title menu's remembered selection: the entry that last led away from the
   * title, which every return to it selects again (specs/ui.md).
   */
  titleIndex: number;
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  resumeScreen: ResumeScreen;

  /** The two scores. First to WIN_SCORE, winning by at least WIN_LEAD. */
  score: { p1: number; p2: number };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null;

  /**
   * The side the next serve travels toward: the player who was just scored on.
   * The first serve of a match always travels toward player one ("left").
   */
  receiver: Side;

  paddles: { left: PaddleState; right: PaddleState };
  /** The AI's two faculties. */
  ai: AiState;
  /** The single ball in play (specs/balls.md), or null while none is present. */
  ball: BallState | null;

  /**
   * The obstacles present, in the order of OBSTACLE_CENTERS, each under its own
   * index. Empty on a cleared field.
   */
  obstacles: ObstacleState[];
  /**
   * The obstacle clock, in seconds — the sole input to both obstacle poses.
   *
   * It advances by the frame's delta time on every frame of a live match, the
   * pre-serve countdown included, is frozen while the game is paused, and resets
   * to 0 at the start of each match, so every match opens upright.
   */
  obstacleClock: number;
  /** Whether that clock advances with the frame (specs/instrumentation.md). */
  obstacleClockRunning: boolean;

  /** Accumulated simulation time, in seconds. Every update adds its delta. */
  simTime: number;
  /**
   * Mirrors the runtime's mute bit, refreshed every `update` from
   * `api.audio.muted()`. The runtime owns muting; this is the game's readable
   * copy of it, and it is what `snapshot()` reports.
   */
  muted: boolean;

  /** The mouse's and the finger's half-finished gestures. Not declared state. */
  holds: { mouse: PointerHold; touch: PointerHold };
}

// ---- Building and posing the state --------------------------------------

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  centerPaddle(state.paddles.left);
  centerPaddle(state.paddles.right);
}

/** A device with no gesture in progress. */
function idleHold(): PointerHold {
  return { screen: null, item: -1 };
}

/**
 * The complete initial state: the title screen, with every field present and at
 * the value specs/state.md gives it there.
 *
 * Exported so this build's own tests can construct a state without standing a
 * runtime up around it. These are the same values `reset()` restores in
 * `src/debug.ts`, deliberately — quitting to the menu and resetting from the
 * debug surface must not leave the game looking at two different title screens.
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
    // Clock zero is the upright pose, so the title screen already shows the
    // field a match will open on.
    obstacles: fullField(0),
    obstacleClock: 0,
    obstacleClockRunning: true,
    simTime: 0,
    muted: false,
    holds: { mouse: idleHold(), touch: idleHold() },
  };
}

// ---- Screen transitions -------------------------------------------------

/**
 * Return to the title screen (specs/ui.md).
 *
 * Every declared field goes back to its title-screen value except `titleIndex`,
 * `simTime` and `muted`, which keep theirs — and `menuIndex`,
 * which becomes `titleIndex`, so the title reopens on the entry that led away
 * from it. Exported so the surface's `reset` is this same transition rather than
 * a second copy of it.
 */
export function toTitle(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = state.titleIndex;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.receiver = "left";
  centerPaddles(state);
  for (const side of ["left", "right"] as const) {
    state.paddles[side].driven = false;
    state.paddles[side].drivenVy = 0;
  }
  state.ai.tracking = true;
  state.ai.movement = true;
  // The title screen's world is the whole world: a ball at home and both
  // obstacles upright (specs/state.md).
  state.ball = createBall();
  state.obstacleClock = 0;
  state.obstacleClockRunning = true;
  state.obstacles = fullField(0);
  state.holds.mouse = idleHold();
  state.holds.touch = idleHold();
}

/**
 * Start a match (specs/ui.md). The match opens on the pre-serve countdown, with
 * the first serve of the match always aimed at player one, so it opens
 * consistently.
 *
 * It arranges the ball that is on the field rather than putting one there: the
 * fields it sets are the ones specs/ui.md lists, and what the field CONTAINS is
 * `clearWorld` and `spawnBall`'s business. `titleIndex` keeps its value.
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
  if (state.ball !== null) restBall(state.ball);
  centerPaddles(state);
  // Every match opens with both obstacles upright at their base centers
  // (specs/playfield.md), so the clock starts over rather than carrying the
  // previous match's phase into this one.
  state.obstacleClock = 0;
  state.obstacleClockRunning = true;
  poseObstacles(state.obstacles, state.obstacleClock);
}

/** Park the ball and begin the pre-serve hold, aimed at `receiver`. */
function respawn(state: CaromState, receiver: Side): void {
  state.receiver = receiver;
  if (state.ball !== null) restBall(state.ball);
  state.screen = "countdown";
}

/**
 * Launch the ball toward the receiver at SERVE_SPEED and SERVE_ANGLE from
 * horizontal (specs/balls.md). The angle's magnitude is fixed; its SIGN is the
 * ball's own `serveSign`, drawn when it was parked and left as it is by the serve.
 */
function serve(state: CaromState, ball: BallState): void {
  const dir = state.receiver === "left" ? -1 : 1;
  ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
  ball.vy = ball.serveSign * SERVE_SPEED * Math.sin(SERVE_ANGLE);
  ball.holdTimer = 0;
  ball.held = false;
  ball.trail.length = 0;
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
 * Every edge read in Carom happens here, once, which is what the runtime's
 * consume-on-read edges ask for: two readers of the same action in one frame would
 * split one press between them. The screen is decided ONCE, at the top — so an
 * update reads the input the screen it began on reads, and a screen this update
 * reaches takes its first input on the next one (specs/ui.md).
 */
function handleInput(state: CaromState, api: UpdateApi): void {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title":
      // `back` is read on the title and does nothing there; reading it is what
      // stops it surfacing on a later frame.
      back(api);
      menuFrame(state, api, (index) => selectTitle(state, index));
      break;
    case "howto": {
      // `back` and `confirm` both leave. `back` is read first, and the single
      // menu item confirms to the same place.
      if (back(api)) {
        toTitle(state);
        break;
      }
      menuFrame(state, api, () => toTitle(state));
      break;
    }
    case "countdown":
    case "playing":
      // A match is live, so Escape means `pause`. `back` is not read on these
      // screens, which is why one Escape opens the pause menu and leaves it open.
      if (pause(api)) pauseMatch(state);
      break;
    case "paused": {
      // A menu is up, and both `pause` and `back` resume from it. Both are read
      // before the menu edges, and a frame carrying either does nothing else —
      // so one Escape, which raises both, resumes exactly once (specs/ui.md).
      const resumed = pause(api);
      const left = back(api);
      if (resumed || left) {
        resumeMatch(state);
        break;
      }
      menuFrame(state, api, (index) => selectPause(state, index));
      break;
    }
    case "matchover":
      if (back(api)) {
        toTitle(state);
        break;
      }
      menuFrame(state, api, (index) => selectMatchOver(state, index));
      break;
  }
}

/**
 * One frame of a menu: the keyboard's edges, then the pointer and the fingers.
 *
 * The ordering is the one specs/ui.md fixes. Up is applied before down and
 * movement before confirm, so a frame carrying an up edge and a down edge moves
 * up only and a frame carrying a movement edge and a confirm edge moves only.
 * The pointer is applied AFTER the keyboard, so a frame carrying both a keyboard
 * movement edge and a pointer selection ends on the item the pointer named — and
 * a keyboard confirm ends the frame, so a frame carrying both confirms the
 * keyboard's item alone.
 */
function menuFrame(
  state: CaromState,
  api: UpdateApi,
  onConfirm: (index: number) => void,
): void {
  const screen = state.screen;
  const count = menuItemCount(screen);
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
    return;
  }
  if (applyPointer(state, screen, api.input.pointers())) {
    onConfirm(state.menuIndex);
  }
}

/**
 * Apply this frame's pointer and touch samples to the menu, in arrival order.
 *
 * Returns whether a gesture confirmed. A confirm takes BOTH of its edges inside
 * one item's region — the press and its release for a mouse, the landing and the
 * lift for a contact — so an edge that falls outside every region, or a pair that
 * falls in two different ones, confirms nothing (specs/ui.md). At most one
 * confirm comes out of a frame, whatever arrived in it.
 */
function applyPointer(
  state: CaromState,
  screen: Screen,
  samples: readonly PointerSample[],
): boolean {
  let confirmed = false;
  for (const sample of samples) {
    const hit = menuItemAt(screen, sample.x, sample.y);
    const hold = state.holds[sample.kind];
    if (sample.phase === "move") {
      // A mouse that moves onto an item selects it; a contact that travels onto
      // one does the same, and a contact only moves while it is down.
      if (hit !== null) state.menuIndex = hit;
    } else if (sample.phase === "down") {
      if (hit !== null) state.menuIndex = hit;
      hold.screen = hit === null ? null : screen;
      hold.item = hit ?? -1;
    } else {
      if (hit !== null && hold.screen === screen && hold.item === hit) {
        state.menuIndex = hit;
        confirmed = true;
      }
      hold.screen = null;
      hold.item = -1;
    }
  }
  return confirmed;
}

function selectTitle(state: CaromState, index: number): void {
  // Confirming an item on the title menu remembers it, from the keyboard, from a
  // pointer, and from a touch contact alike (specs/ui.md).
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
 * Each side is decided on its own (specs/instrumentation.md): a driven paddle
 * follows that side's `drivenVy` through the real integrator and neither the
 * input actions nor the AI touch it, while the other side goes on playing
 * normally. Driving one side therefore leaves the other exactly as it was.
 */
function updatePaddles(state: CaromState, api: UpdateApi, dt: number): void {
  const live = state.screen === "playing";

  // Player one (left). Solo has no player two, so both sliders drive this paddle.
  const left = state.paddles.left;
  if (left.driven) {
    left.vy = left.drivenVy;
    integratePaddle(left, dt);
  } else {
    const axis = state.mode === "solo" ? soloAxis(api) : p1Axis(api);
    left.vy = axis * PADDLE_SPEED;
    integratePaddle(left, dt);
  }

  // The right paddle: the AI in Solo, a second human in Versus.
  const right = state.paddles.right;
  if (right.driven) {
    right.vy = right.drivenVy;
    integratePaddle(right, dt);
  } else if (state.mode === "solo") {
    updateAi(right, state.ball, state.ai, live, dt);
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
function checkGoals(state: CaromState, ball: BallState, api: UpdateApi): void {
  if (ball.x - BALL_R > FIELD_W) score(state, api, "left");
  else if (ball.x + BALL_R < 0) score(state, api, "right");
}

/**
 * Advance the simulation by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * simulation clock; the paused screen freezes the field entirely.
 */
function advance(state: CaromState, api: UpdateApi, dt: number): void {
  state.simTime += dt;

  if (state.screen !== "countdown" && state.screen !== "playing") return;

  updatePaddles(state, api, dt);

  // The ball takes its sub-steps against the pose the clock's value at the START
  // of the frame gives, so the clock is advanced after it and the obstacles are
  // re-posed from the new value at the end (specs/playfield.md).
  const ball = state.ball;
  if (ball !== null) {
    if (state.screen === "countdown") {
      // The ball waits at its home point; only its hold runs down. On the first
      // frame the subtraction leaves the timer at or below zero the ball is
      // served, on that same frame, and is not advanced on it.
      ball.holdTimer -= dt;
      if (ball.holdTimer <= 0) serve(state, ball);
      recordTrail(ball, state.simTime);
    } else {
      const events = step(
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
      recordTrail(ball, state.simTime);
      checkGoals(state, ball, api);
    }
  }

  if (state.obstacleClockRunning) state.obstacleClock += dt;
  // Reposed from the clock rather than integrated, so a posed clock and a match
  // that has run that long face the identical field.
  poseObstacles(state.obstacles, state.obstacleClock);
}

// ---- The game the runtime drives -----------------------------------------

export const game: Game<CaromState> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the four cues, build the complete initial state, and register the
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
   * The order matters. Edges are news for exactly one frame — the runtime discards
   * whatever was not consumed — so they are read first, at the top of the frame
   * they belong to, and the state they may have changed is the state the rest of
   * the frame advances.
   */
  update(state: CaromState, api: UpdateApi, dt: number): void {
    handleInput(state, api);
    advance(state, api, dt);
    // The runtime owns the mute bit; this is the game's readable copy of it, so the
    // HUD hint and `snapshot()` cannot drift from what the player actually hears.
    state.muted = api.audio.muted();
  },

  /** Runs once per frame, after `update`. Draws, and changes nothing. */
  render(state: CaromState, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
