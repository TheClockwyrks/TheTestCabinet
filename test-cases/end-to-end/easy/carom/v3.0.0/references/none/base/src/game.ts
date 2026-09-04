// Carom — the game: the per-frame update, the state machine, and the binding of
// the three functions the runtime drives.
//
// A `Game<S>` is three functions and a state type. `initialize` runs once, when
// the runtime is initialized, and returns the state (`src/state.ts` declares it).
// `update` and `render` then run once each per frame — `update` first, with the
// frame's delta time in SECONDS, then `render`. The state is the only channel
// between them.
//
// There is no fixed timestep here and no accumulator. Every rate in
// `src/constants.ts` is per second and every one of them is multiplied by `dt`,
// which is what makes the simulation depend on how much TIME has passed rather
// than on how many frames have gone by: the same second of play reaches the same
// state whether it arrived as one long step, as a hundred short ones, or as an
// uneven mixture. That is the property specs/balls.md requires and the property
// the debug surface in `src/debug.ts` leans on.
//
// ONE FRAME IS INPUT, THEN THE WORLD. Input is read first, for the screen the
// frame OPENED on, and the screen that read may have reached takes its first
// input on the following frame (specs/ui.md). Then the simulation advances
// whatever that screen advances.

import {
  BALL_R,
  CUES,
  FIELD_W,
  OBSTACLES,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
  type Rect,
} from "./constants";
import { defineCues } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import { integratePaddle } from "./entities";
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
import { highlightedItem, itemAt, menuOf, type Menu } from "./menus";
import { step } from "./physics";
import type { PointerPoint } from "./pointer";
import { renderGame } from "./render";
import { nextSign } from "./rng";
import {
  createInitialState,
  parkBall,
  returnToTitle,
  startMatch,
  type BallState,
  type CaromState,
  type PaddleState,
  type Side,
} from "./state";
import { recordTrail } from "./trail";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";

// ---- Screen transitions -------------------------------------------------

/**
 * Launch the ball toward the receiver at SERVE_SPEED (specs/balls.md).
 *
 * The vertical component is small and fixed in magnitude — SERVE_ANGLE — so the
 * volley is never perfectly flat, and its SIGN is the one draw this game makes
 * from its seeded generator. The ball is not advanced on the frame it is served:
 * this sets the velocity, and the next frame flies it.
 */
function serve(state: CaromState, ball: BallState): void {
  const dir = state.receiver === "left" ? -1 : 1;
  ball.holdTimer = 0;
  ball.held = false;
  ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
  ball.vy = nextSign(state) * SERVE_SPEED * Math.sin(SERVE_ANGLE);
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

// ---- Menus --------------------------------------------------------------

/**
 * Act on the item confirmed on the menu the current screen shows, whichever input
 * confirmed it (specs/ui.md gives the keyboard, the pointer and a finger the same
 * effect).
 *
 * Confirming on the title also remembers the item, which is what every later
 * return to the title puts the selection back on.
 */
function confirmItem(state: CaromState, index: number): void {
  switch (state.screen) {
    case "title":
      state.titleIndex = index;
      if (index === 0) startMatch(state, "solo");
      else if (index === 1) startMatch(state, "versus");
      else {
        state.screen = "howto";
        state.menuIndex = 0;
      }
      break;
    case "howto":
      returnToTitle(state);
      break;
    case "paused":
      if (index === 0) resumeMatch(state);
      else if (index === 1) startMatch(state, state.mode);
      else returnToTitle(state);
      break;
    case "matchover":
      if (index === 0) startMatch(state, state.mode);
      else returnToTitle(state);
      break;
    case "countdown":
    case "playing":
      break;
  }
}

/**
 * Read one menu's keyboard edges and act on the first that applies.
 *
 * All three are read before any is acted on, so exactly one press moves the
 * selection or accepts it and nothing is left armed for a later frame. The order
 * is the one specs/ui.md fixes: up before down, and movement before confirm.
 *
 * The item moved from and confirmed is the one the menu is DRAWING as selected,
 * so what a player sees highlighted is what a confirm takes, whatever the debug
 * surface has set the selection to.
 */
function menuKeys(state: CaromState, api: UpdateApi, menu: Menu): void {
  const count = menu.items.length;
  const current = highlightedItem(menu, state.menuIndex);
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);
  if (up) state.menuIndex = (current + count - 1) % count;
  else if (down) state.menuIndex = (current + 1) % count;
  else if (accepted) confirmItem(state, current);
}

/**
 * Apply this frame's pointer and touch input to the menu on screen.
 *
 * Read once per frame and applied AFTER the keyboard edges (specs/ui.md), so a
 * frame carrying both a keyboard movement edge and a pointer selection ends on
 * the item the pointer named.
 *
 * A move onto an item selects it, and so does a press landing on one — which is
 * what makes a finger, which never hovers, select the item it lands on. A confirm
 * takes BOTH its edges inside one item's region: a press and a release in
 * different regions, or either of them outside every region, confirms nothing.
 */
function menuPointer(state: CaromState, api: UpdateApi, menu: Menu): void {
  const frame = api.pointer.frame();

  const select = (at: PointerPoint): void => {
    const index = itemAt(menu, at.x, at.y);
    if (index !== null) state.menuIndex = index;
  };
  if (frame.moved !== null) select(frame.moved);
  if (frame.pressed !== null) select(frame.pressed);

  const released = frame.released;
  if (released === null) return;
  const from = itemAt(menu, released.from.x, released.from.y);
  const to = itemAt(menu, released.to.x, released.to.y);
  if (from === null || from !== to) return;
  state.menuIndex = to;
  confirmItem(state, to);
}

// ---- Input (once per frame) ---------------------------------------------

/**
 * Read this frame's input and act on it.
 *
 * Every edge Carom reads is read here, once, which is what the runtime's
 * consume-on-read edges ask for: two readers of the same action in one frame
 * would split one press between them.
 *
 * `Escape` raises `pause` and `back` together, and each screen reads only the one
 * it has a use for (specs/ui.md): during a match that is `pause`, so one press
 * opens the pause menu and leaves it open, and on the pause menu both mean
 * "resume", so one press resumes once.
 */
function handleInput(state: CaromState, api: UpdateApi): void {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  const opened = state.screen;
  const menu = menuOf(opened);
  switch (opened) {
    case "title":
      if (menu !== null) menuKeys(state, api, menu);
      break;
    case "howto": {
      // The one item is confirmed by `confirm` and by `back` alike, and both are
      // read so neither is left armed.
      const accepted = confirm(api);
      const left = back(api);
      if (accepted || left) confirmItem(state, 0);
      break;
    }
    case "countdown":
    case "playing":
      if (pause(api)) pauseMatch(state);
      break;
    case "paused": {
      // Read before the menu's own edges, and either one resumes and does
      // nothing else. Both are read so neither is left armed.
      const paused = pause(api);
      const left = back(api);
      if (paused || left) resumeMatch(state);
      else if (menu !== null) menuKeys(state, api, menu);
      break;
    }
    case "matchover":
      if (back(api)) returnToTitle(state);
      else if (menu !== null) menuKeys(state, api, menu);
      break;
  }

  // A frame whose keys left the screen has already had its confirm: the pointer
  // is applied to the menu that was on the field, and that menu is gone. The
  // press in progress goes with it, so a gesture cannot span two screens.
  if (state.screen !== opened) {
    api.pointer.forget();
    return;
  }
  if (menu !== null) menuPointer(state, api, menu);
}

// ---- Simulation ---------------------------------------------------------

/** The obstacles on the field, as the rectangles collision resolves against. */
function obstacleRects(state: CaromState): Rect[] {
  return state.obstacles.map((obstacle) => OBSTACLES[obstacle.index]);
}

/** Move one paddle at a velocity, through the integration and clamp. */
function movePaddle(paddle: PaddleState, vy: number, dt: number): void {
  paddle.vy = vy;
  integratePaddle(paddle, dt);
}

/**
 * Move both paddles for this frame.
 *
 * Each side is asked separately who is moving it, because the debug surface takes
 * one side at a time (specs/instrumentation.md): a driven paddle follows that
 * side's `drivenVy` and neither the input actions nor the AI touch it, while the
 * other side goes on playing normally.
 */
function updatePaddles(state: CaromState, api: UpdateApi, dt: number): void {
  const solo = state.mode === "solo";
  const live = state.screen === "playing";
  const { left, right } = state.paddles;

  // Player one (left). Solo has no player two, so both sliders drive this paddle.
  if (left.driven) {
    movePaddle(left, left.drivenVy, dt);
  } else {
    const axis = solo ? soloAxis(api) : p1Axis(api);
    movePaddle(left, axis * PADDLE_SPEED, dt);
  }

  // The right paddle: the AI in Solo, a second human in Versus.
  if (right.driven) {
    movePaddle(right, right.drivenVy, dt);
  } else if (solo) {
    updateAi(right, state.ball, state.ai, live, dt);
  } else {
    movePaddle(right, p2Axis(api) * PADDLE_SPEED, dt);
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
  ball: BallState,
  scorer: Side,
): void {
  if (scorer === "left") state.score.p1 += 1;
  else state.score.p2 += 1;
  api.audio.play(CUES.score);

  const winner = checkWin(state);
  if (winner) {
    state.winner = winner;
    state.screen = "matchover";
    state.menuIndex = 0;
    // The ball is left where it is: the match is over, and nothing serves again.
    return;
  }
  // The next serve travels toward the player who was just scored on.
  state.receiver = scorer === "left" ? "right" : "left";
  parkBall(ball);
  state.screen = "countdown";
}

/** A point is scored the moment the ball has fully passed a goal edge. */
function checkGoals(state: CaromState, api: UpdateApi, ball: BallState): void {
  if (ball.x - BALL_R > FIELD_W) score(state, api, ball, "left");
  else if (ball.x + BALL_R < 0) score(state, api, ball, "right");
}

/**
 * Advance the simulation by `dt` seconds of elapsed time.
 *
 * `dt` is whatever the frame took — it is never assumed to be any particular
 * value, and nothing here counts frames. A menu screen advances nothing but the
 * clock; the paused screen freezes the field entirely. A field with no ball on it
 * has nothing to advance, nothing to draw, and nothing to score.
 */
function advance(state: CaromState, api: UpdateApi, dt: number): void {
  state.simTime += dt;

  const opened = state.screen;
  const live = opened === "countdown" || opened === "playing";
  if (live) updatePaddles(state, api, dt);

  const ball = state.ball;
  if (!live || ball === null) return;

  if (opened === "countdown") {
    // The hold is the one thing that serves the ball, and it runs while the ball
    // waits (specs/balls.md).
    if (ball.held) {
      ball.holdTimer -= dt;
      if (ball.holdTimer <= 0) serve(state, ball);
    }
  } else {
    const events = step(
      ball,
      state.paddles.left,
      state.paddles.right,
      obstacleRects(state),
      dt,
    );
    // One cue per event that actually happened. A frame long enough to contain
    // two different kinds of bounce plays both, because each is its own event and
    // each has its own cue (specs/audio.md).
    if (events.paddle) api.audio.play(CUES.paddleHit);
    if (events.wall) api.audio.play(CUES.wallBounce);
    if (events.obstacle) api.audio.play(CUES.obstacleBounce);
  }

  recordTrail(ball, state.simTime);
  if (opened === "playing") checkGoals(state, api, ball);
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
