// Carom — the debugging and automation surface, `window.__carom`.
//
// specs/instrumentation.md specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. Each one sets a single field or one fixed pair,
// places or removes one entity, reads the state, or moves the clock. `reset` and
// `reconcile` are the exceptions, and both are lifecycle verbs rather than poses. There is no
// operation that starts a match, serves a ball, or hands a paddle to the AI —
// each of those is a SEQUENCE of the operations below, and a sequence belongs to
// whoever is driving the game rather than to the surface.
//
// A POSE ARRANGES THE WORLD AND NEVER FABRICATES AN OUTCOME. These calls put the
// game into a situation, and the game's own `update` — the real collision, the
// real serve, the real AI — is what runs from there on the next frame. So a
// scenario driven from code behaves exactly like one played by hand: ending a
// hold does not launch the ball, it lets the build's own rule launch it.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Without them a scenario could only be driven by
// waiting, and a check that waits measures the machine it ran on. Everything else
// about driving a browser game stays absent: there is no `keyDown`, `keyUp` or
// `press` (the runtime's registered actions are driven by dispatching real key
// events at the page), no pointer pose (a real mouse and a real finger are
// driven at the page too), and no overlay drawing or toggle (the runtime draws
// the panel and owns the backtick key).

import { CAROM_DEBUG_VERSION } from "./constants";
import { ballSpeed } from "./entities";
import { menuItemRect, type MenuRect } from "./menus";
import {
  clearWorld,
  createBall,
  isObstacleIndex,
  resetState,
  spawnObstacle,
  type BallState,
  type CaromState,
  type Mode,
  type ResumeScreen,
  type Screen,
  type Side,
  type TrailSample,
} from "./state";
import { drawServeSign } from "./random";

/** The `window` property the API is installed on. */
export const CAROM_HANDLE = "__carom";

/**
 * The runtime, as the surface reaches it: the clock and the mute bit.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
  /** Set the audio bus's mute bit, the same bit the `mute` action toggles. */
  setMuted(muted: boolean): void;
}

/** One ball, as a snapshot reports it. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point rather than flying. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The vertical sign the serve takes. */
  serveSign: 1 | -1;
  /** The ball's trail samples, oldest first. */
  trail: TrailSample[];
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  cy: number;
  /** The velocity the last frame integrated. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side. */
  drivenVy: number;
  driven: boolean;
}

/** One obstacle on the field, as a snapshot reports it. */
export interface ObstacleSnapshot {
  index: number;
  cx: number;
  cy: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  titleIndex: number;
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: Record<Side, PaddleSnapshot>;
  ai: { tracking: boolean; movement: boolean };
  receiver: Side;
  /** The ball, or null while no ball is on the field. */
  ball: BallSnapshot | null;
  /** Every obstacle present, at its fixed center. */
  obstacles: ObstacleSnapshot[];
  /** False while the clock is scripted rather than run from the wall clock. */
  autoStep: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

export interface CaromDebugApi {
  version: number;

  /* The clock. */
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  /* The world. */
  clearWorld(): void;
  spawnBall(): void;
  spawnObstacle(index: number): void;
  reset(): void;
  /** Bring every reported reading into agreement with the world as it stands. */
  reconcile(): void;

  /* Screens and menus. */
  setScreen(screen: Screen): void;
  setMode(mode: Mode): void;
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;
  setResumeScreen(screen: ResumeScreen): void;

  /* Match state. */
  setScore(p1: number, p2: number): void;
  setWinner(side: Side | null): void;
  setReceiver(side: Side): void;

  /* Paddles. */
  setPaddleCy(side: Side, cy: number): void;
  setPaddleVy(side: Side, vy: number): void;
  setPaddleDriven(side: Side, driven: boolean): void;

  /* The ball. This variant plays with one, so no operation takes an index. */
  setBallPosition(x: number, y: number): void;
  setBallVelocity(vx: number, vy: number): void;
  setBallSpin(spin: number): void;
  setBallHeld(held: boolean): void;
  setBallHoldTimer(seconds: number): void;
  setBallServeSign(sign: 1 | -1): void;
  drawBallServeSign(): void;

  /* The AI opponent: one operation per faculty. */
  setAiTracking(enabled: boolean): void;
  setAiMovement(enabled: boolean): void;

  /* Audio. */
  setMuted(muted: boolean): void;

  /* Readings. */
  snapshot(): CaromSnapshot;
  menuItemRect(index: number): MenuRect | null;
}

/** One paddle, projected into the shape a snapshot reports. */
function paddleView(state: CaromState, side: Side): PaddleSnapshot {
  const paddle = state.paddles[side];
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}

/** The ball, projected into the shape a snapshot reports, or null if it is off. */
function ballView(state: CaromState): BallSnapshot | null {
  const ball = state.ball;
  if (ball === null) return null;
  return {
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    speed: ballSpeed(ball),
    spin: ball.spin,
    held: ball.held,
    holdTimer: ball.holdTimer,
    serveSign: ball.serveSign,
    // Copied, so a reader holding a snapshot cannot write into the live trail.
    trail: ball.trail.map((sample) => ({ ...sample })),
  };
}

/** Build the API over one live state object and the runtime driving it. */
export function createDebugApi(
  state: CaromState,
  clock: DebugClock,
): CaromDebugApi {
  /**
   * The ball on the field, or a thrown error naming the operation that wanted it.
   *
   * An absent ball is no ball to pose. An operation that quietly did nothing
   * would leave a caller reading its own pose back off a field that never took
   * it, and every check driving that operation would grade a world it did not
   * arrange, so this fails where the caller can see it instead
   * (specs/instrumentation.md). `spawnBall` is how a field of one is posed.
   */
  const requireBall = (op: string): BallState => {
    if (state.ball === null) {
      throw new Error(
        `Carom: ${op} — no ball is on the field; spawnBall places one`,
      );
    }
    return state.ball;
  };

  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The clock ------------------------------------------------------

    /**
     * Take the game off real time, and give it back.
     *
     * `false` stops the frame loop advancing the simulation from the wall clock,
     * so the game changes only when `advance` says so; `true` returns it to
     * running itself, which is how a build starts and how it is played. Drawing
     * is unaffected either way: the loop keeps rendering, so the canvas shows the
     * state the most recent frame left.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — so
     * the game's own collision, serve and AI produce the result and the canvas
     * reflects it. Every rate in this game is integrated against the frame's
     * delta, so `advance(1, 1)` and `advance(1, 60)` cover the same second and
     * reach the same outcome, beyond the drift a change in step size explains.
     *
     * Advancing while the game is still stepping automatically ADDS to what the
     * wall clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      clock.advance(seconds, frames);
    },

    // ---- The world ------------------------------------------------------

    /** Take every ball and every obstacle off the field. The paddles stay. */
    clearWorld() {
      clearWorld(state);
    },

    /**
     * Place the ball at its home point, held, with a full hold timer, no motion,
     * no spin, and an empty trail. A ball already on the field is returned to
     * exactly that arrangement.
     */
    spawnBall() {
      state.ball = createBall();
    },

    /**
     * Place obstacle `index` at its fixed center.
     *
     * An index outside the two this field is built with names no obstacle, so
     * there is no state for the call to reach and it fails where the caller can
     * see it rather than passing quietly (specs/instrumentation.md).
     */
    spawnObstacle(index) {
      if (!isObstacleIndex(index)) {
        throw new RangeError(`Carom: no obstacle ${index}`);
      }
      spawnObstacle(state, index);
    },

    /**
     * Return the game to its title-screen state: every declared field at the
     * value specs/state.md gives it, with the world placed exactly as
     * `spawnBall` and `spawnObstacle` place it.
     *
     * The mute bit and the auto-step setting are left alone. A reset restores the
     * declared fields of the state, and neither of those is one of them: muting
     * is a player preference the runtime owns, and whether the game is stepping
     * itself is said with `setAutoStep`.
     */
    reset() {
      resetState(state);
    },

    /**
     * Bring every reported reading into agreement with the world as it stands,
     * without advancing anything.
     *
     * Every derived reading this build reports is worked out at the read: a
     * ball's `speed` is `ballSpeed(ball)` in `ballView`, and every other field
     * of the snapshot is the state's own. Nothing is held that a pose can leave
     * behind, so there is nothing here to rewrite. The operation is required of
     * every build, including one that keeps those readings as stored copies, and
     * an empty body is what it comes to in a build that keeps none — not an
     * omission. Turning it into a step would be wrong: a step moves the very
     * thing a pose has just placed.
     */
    reconcile() {},

    // ---- Screens and menus ----------------------------------------------

    /**
     * Show one of the six screens. The scores, the world and the menu indices are
     * left as they are, and the screen then behaves exactly as specs/ui.md states
     * for it.
     */
    setScreen(screen) {
      state.screen = screen;
    },

    setMode(mode) {
      state.mode = mode;
    },

    /** Highlight an item on whichever menu the current screen shows. */
    setMenuIndex(index) {
      state.menuIndex = index;
    },

    /** Set the title menu's remembered selection. */
    setTitleIndex(index) {
      state.titleIndex = index;
    },

    /** Set the screen a pause resumes to. */
    setResumeScreen(screen) {
      state.resumeScreen = screen;
    },

    // ---- Match state ----------------------------------------------------

    /**
     * Set both scores, as a precondition. The win and deuce rules still resolve
     * through real play, so a match ends when a real point is driven.
     */
    setScore(p1, p2) {
      state.score.p1 = p1;
      state.score.p2 = p2;
    },

    setWinner(side) {
      state.winner = side;
    },

    /** Aim the next serve at one side. */
    setReceiver(side) {
      state.receiver = side;
    },

    // ---- Paddles --------------------------------------------------------

    setPaddleCy(side, cy) {
      state.paddles[side].cy = cy;
    },

    /**
     * Set the velocity that side's paddle moves at while it is driven, and leave
     * its `vy` as it is.
     *
     * The two are separate fields: `drivenVy` is what was asked for and holds
     * across frames whether or not the paddle is driven, and `vy` is the velocity
     * the last frame actually integrated. So a `drivenVy` set while the paddle
     * stands still reaches `vy` on the first frame advanced with that side
     * driven.
     */
    setPaddleVy(side, vy) {
      state.paddles[side].drivenVy = vy;
    },

    /**
     * Take that paddle from whoever is moving it, or hand it back. The other side
     * is untouched, so a scenario can drive one paddle while the player or the AI
     * goes on playing the other.
     */
    setPaddleDriven(side, driven) {
      state.paddles[side].driven = Boolean(driven);
    },

    // ---- The ball -------------------------------------------------------
    //
    // Each sets its own field alone, and each reaches the value it is given
    // whatever the game would make of it: the screen, the hold, and where the
    // paddles are decide none of them. An absent ball is the one thing there is
    // nothing to set, and that fails loudly through `requireBall` rather than
    // passing quietly; posing a field of one is what `spawnBall` is for.

    setBallPosition(x, y) {
      const ball = requireBall("setBallPosition");
      ball.x = x;
      ball.y = y;
    },

    setBallVelocity(vx, vy) {
      const ball = requireBall("setBallVelocity");
      ball.vx = vx;
      ball.vy = vy;
    },

    setBallSpin(spin) {
      requireBall("setBallSpin").spin = spin;
    },

    setBallHeld(held) {
      requireBall("setBallHeld").held = Boolean(held);
    },

    /**
     * Set the seconds remaining of the ball's hold. `0` ends the hold, and the
     * ball is served on the next advanced frame through the game's own rule.
     */
    setBallHoldTimer(seconds) {
      requireBall("setBallHoldTimer").holdTimer = seconds;
    },

    /** The vertical sign the ball's serve takes, `1` or `-1`. */
    setBallServeSign(sign) {
      requireBall("setBallServeSign").serveSign = sign < 0 ? -1 : 1;
    },

    /** The one draw parking makes, made again on its own (specs/balls.md). */
    drawBallServeSign() {
      requireBall("drawBallServeSign").serveSign = drawServeSign();
    },

    // ---- The AI opponent ------------------------------------------------

    /** Whether the AI senses the ball and chooses a target. */
    setAiTracking(enabled) {
      state.ai.tracking = Boolean(enabled);
    },

    /** Whether the AI's paddle travels toward its target. */
    setAiMovement(enabled) {
      state.ai.movement = Boolean(enabled);
    },

    // ---- Audio ----------------------------------------------------------

    /**
     * Set the mute bit, the same bit the `mute` action toggles.
     *
     * The runtime owns the bit, so this sets it there; `state.muted` is the
     * game's readable copy and the next update refreshes it from the bus.
     */
    setMuted(muted) {
      clock.setMuted(Boolean(muted));
      state.muted = Boolean(muted);
    },

    // ---- Readings -------------------------------------------------------

    /** A pure read of the whole declared state. It never changes anything. */
    snapshot() {
      return {
        version: CAROM_DEBUG_VERSION,
        screen: state.screen,
        mode: state.mode,
        menuIndex: state.menuIndex,
        titleIndex: state.titleIndex,
        resumeScreen: state.resumeScreen,
        score: { p1: state.score.p1, p2: state.score.p2 },
        winner: state.winner,
        muted: state.muted,
        paddles: {
          left: paddleView(state, "left"),
          right: paddleView(state, "right"),
        },
        ai: { tracking: state.ai.tracking, movement: state.ai.movement },
        receiver: state.receiver,
        ball: ballView(state),
        obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
        autoStep: clock.autoStep(),
        simTime: state.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — this build's own layout, reported.
     *
     * Null on `countdown` and `playing`, which show no menu, and null when
     * `index` names no item of the menu on screen.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
    },
  };
}

/**
 * Install the API on `window.__carom` and return the function that removes it
 * again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: CaromState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[CAROM_HANDLE] = api;
  return () => {
    if (target[CAROM_HANDLE] === api) delete target[CAROM_HANDLE];
  };
}
