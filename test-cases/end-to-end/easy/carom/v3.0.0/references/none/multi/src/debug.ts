// Carom (Multi-ball) — the debugging and automation surface, `window.__carom`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// THE SURFACE IS ATOMIC. Every operation is a READING or a POSE, and a pose sets
// ONE field, places or removes ONE entity, or moves the clock — there is no patch
// object anywhere in it, and no compound verb: no `startMatch`, no `serve`, no
// `setAiControl`. Starting a match, staging a rally and reaching a screen are
// SEQUENCES of these operations, and they belong to whoever is driving the game
// rather than here. `reset` is the one exception, and it is a lifecycle verb
// rather than a pose: it restores every declared field at once, which is how a
// scenario gets back to a known start.
//
// That is the point of the split. These calls ARRANGE THE WORLD and never
// fabricate an outcome: they put the game into a situation, and the game's own
// `update` — the real collision, the real launch, the real AI — is what runs from
// there on the next frame. So a scenario driven from code behaves exactly like
// one played by hand.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Without them a scenario could only be driven by
// waiting, and a check that waits measures the machine it ran on. Everything else
// about driving a browser game stays absent: there is no `keyDown`, `keyUp` or
// `press` (the runtime's registered actions are driven by dispatching real key
// events at the page), no pointer pose (a real mouse and a real finger reach the
// page's own listeners), and no overlay drawing or toggle (the runtime draws the
// panel and owns the backtick key).

import { CAROM_DEBUG_VERSION, HOLD_TIME } from "./constants";
import { resetGame } from "./game";
import type {
  CaromState,
  Mode,
  ResumeScreen,
  Screen,
  Side,
  TrailSample,
} from "./game";
import { ballSpeed, findBall, spawnBall, spawnObstacle } from "./entities";
import { menuItemRect, type MenuItemRect } from "./menu";
import { drawLaunchAngle } from "./random";

/** The `window` property the surface is installed on. */
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

/** One ball, as `snapshot()` reports it. */
export interface BallSnapshot {
  /** This ball's place in play order. */
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point for its own hold to elapse. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The angle, in radians, this ball\'s next launch leaves along. */
  launchAngle: number;
  /** That ball's trail samples, oldest first. */
  trail: TrailSample[];
}

/** One obstacle, as `snapshot()` reports it. */
export interface ObstacleSnapshot {
  index: number;
  cx: number;
  cy: number;
}

/** One paddle, as `snapshot()` reports it. */
export interface PaddleSnapshot {
  cy: number;
  /** The velocity the last frame integrated. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side. */
  drivenVy: number;
  driven: boolean;
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
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  /** Every ball present, in play order. */
  balls: BallSnapshot[];
  /** Every obstacle present, at its fixed center. */
  obstacles: ObstacleSnapshot[];
  /** False while the clock is scripted rather than run from the wall clock. */
  autoStep: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/** Every operation `specs/instrumentation.md` puts on `window.__carom`. */
export interface CaromDebugApi {
  version: number;

  /* The clock. */
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  /* The world. */
  clearWorld(): void;
  spawnBall(index: number): void;
  spawnObstacle(index: number): void;
  reset(): void;

  /* Screens and menus. */
  setScreen(screen: Screen): void;
  setMode(mode: Mode): void;
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;
  setResumeScreen(screen: ResumeScreen): void;

  /* Match state. */
  setScore(p1: number, p2: number): void;
  setWinner(side: Side | null): void;

  /* Paddles. */
  setPaddleCy(side: Side, cy: number): void;
  setPaddleVy(side: Side, vy: number): void;
  setPaddleDriven(side: Side, driven: boolean): void;

  /* Balls, each naming the ball it acts on. */
  setBallPosition(index: number, x: number, y: number): void;
  setBallVelocity(index: number, vx: number, vy: number): void;
  setBallSpin(index: number, spin: number): void;
  setBallHeld(index: number, held: boolean): void;
  setBallHoldTimer(index: number, seconds: number): void;
  setBallLaunchAngle(index: number, angle: number): void;
  drawBallLaunchAngle(index: number): void;

  /* The AI opponent: one operation per faculty. */
  setAiTracking(enabled: boolean): void;
  setAiMovement(enabled: boolean): void;

  /* Audio. */
  setMuted(muted: boolean): void;

  /* Readings. */
  snapshot(): CaromSnapshot;
  menuItemRect(index: number): MenuItemRect | null;
}

/** One paddle, as the snapshot reports it. */
function paddleView(paddle: {
  cy: number;
  vy: number;
  drivenVy: number;
  driven: boolean;
}): PaddleSnapshot {
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: CaromState,
  clock: DebugClock,
): CaromDebugApi {
  /**
   * The present ball under `index`, or `null`.
   *
   * An operation naming an absent ball has NO EFFECT
   * (specs/instrumentation.md) — it is not an error, because a scenario that
   * cleared the field and spawned one ball back is entitled to address the
   * others without knowing they went.
   */
  const ball = (index: number) => findBall(state.balls, index);

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
     *
     * It does not touch the paddles. Who is driving them is a separate question
     * from who is driving the clock, and a scenario that takes the game off real
     * time to watch the KEYBOARD move a paddle is exactly what the control checks
     * are.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — so
     * the game's own collision, launch and AI produce the result and the canvas
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

    /**
     * Empty the field: every ball and every obstacle comes off it, and the
     * paddles stay, because a paddle is furniture the game always has.
     */
    clearWorld() {
      state.balls.length = 0;
      state.obstacles.length = 0;
    },

    /**
     * Place ball `index` at its home point, held, with a full hold timer, zero
     * velocity, zero spin, and an empty trail. A ball already present is returned
     * to exactly that arrangement.
     */
    spawnBall(index) {
      spawnBall(state.balls, index, HOLD_TIME);
    },

    /** Place obstacle `index` at `OBSTACLE_CENTERS[index]`. */
    spawnObstacle(index) {
      spawnObstacle(state.obstacles, index);
    },

    /**
     * Return the game to its title-screen state, with the world placed exactly as
     * `spawnBall` and `spawnObstacle` place it.
     *
     * It leaves the mute bit and the auto-step setting alone. Muting is a player
     * preference the runtime owns, and whether the game is stepping itself is not
     * a declared field: `setAutoStep` is how that is said, and a driver that
     * resets mid-scenario means to re-pose the world, not to hand it back to real
     * time.
     */
    reset() {
      resetGame(state);
    },

    // ---- Screens and menus ----------------------------------------------

    /**
     * Set the current screen. The scores, the world and the menu indices are left
     * exactly as they are, and the screen this sets then behaves exactly as
     * `specs/ui.md` states for that screen.
     */
    setScreen(screen) {
      state.screen = screen;
    },

    setMode(mode) {
      state.mode = mode;
    },

    setMenuIndex(index) {
      state.menuIndex = index;
    },

    setTitleIndex(index) {
      state.titleIndex = index;
    },

    setResumeScreen(screen) {
      state.resumeScreen = screen;
    },

    // ---- Match state ----------------------------------------------------

    /**
     * Set both scores: one fixed pair, not a patch. The win rule still resolves
     * through real play, so a match ends when a real point is driven.
     */
    setScore(p1, p2) {
      state.score.p1 = p1;
      state.score.p2 = p2;
    },

    setWinner(side) {
      state.winner = side;
    },

    // ---- Paddles --------------------------------------------------------

    setPaddleCy(side, cy) {
      state.paddles[side].cy = cy;
    },

    /**
     * Set that paddle's `drivenVy` — the velocity it moves at while it is driven
     * — and leave its `vy` as it is.
     *
     * The two are separate fields on purpose. `drivenVy` holds across frames
     * whether or not the paddle is driven, so a velocity set while the paddle
     * stands still reaches `vy` on the first frame advanced with that side
     * driven; `vy` is the integrated velocity for the frame, whoever moved the
     * paddle, and it is what the spin mechanic reads at contact.
     */
    setPaddleVy(side, vy) {
      state.paddles[side].drivenVy = vy;
    },

    /**
     * Take that paddle from the player, or hand it back. The only pose that
     * changes whether a paddle is driven, and it leaves the other side as it was.
     */
    setPaddleDriven(side, driven) {
      state.paddles[side].driven = Boolean(driven);
    },

    // ---- Balls ----------------------------------------------------------

    setBallPosition(index, x, y) {
      const target = ball(index);
      if (target === null) return;
      target.x = x;
      target.y = y;
    },

    setBallVelocity(index, vx, vy) {
      const target = ball(index);
      if (target === null) return;
      target.vx = vx;
      target.vy = vy;
    },

    setBallSpin(index, spin) {
      const target = ball(index);
      if (target === null) return;
      target.spin = spin;
    },

    setBallHeld(index, held) {
      const target = ball(index);
      if (target === null) return;
      target.held = Boolean(held);
    },

    /**
     * Set the seconds remaining of that ball's hold. Setting it to `0` ends the
     * hold, and the ball launches on the next advanced frame through the game's
     * own rule — the launch is the game's, not this call's.
     */
    setBallHoldTimer(index, seconds) {
      const target = ball(index);
      if (target === null) return;
      target.holdTimer = seconds;
    },

    /** The angle ball `index`'s next launch leaves along, in radians. */
    setBallLaunchAngle(index, angle) {
      const target = ball(index);
      if (target === null) return;
      target.launchAngle = angle;
    },

    /** The one draw parking makes, made again on its own (specs/balls.md). */
    drawBallLaunchAngle(index) {
      const target = ball(index);
      if (target === null) return;
      target.launchAngle = drawLaunchAngle();
    },

    // ---- The AI opponent ------------------------------------------------

    setAiTracking(enabled) {
      state.ai.tracking = Boolean(enabled);
    },

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
          left: paddleView(state.paddles.left),
          right: paddleView(state.paddles.right),
        },
        ai: { tracking: state.ai.tracking, movement: state.ai.movement },
        balls: state.balls.map((present) => ({
          index: present.index,
          x: present.x,
          y: present.y,
          vx: present.vx,
          vy: present.vy,
          speed: ballSpeed(present),
          spin: present.spin,
          held: present.held,
          holdTimer: present.holdTimer,
          launchAngle: present.launchAngle,
          trail: present.trail.map((sample) => ({ ...sample })),
        })),
        obstacles: state.obstacles.map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.cx,
          cy: obstacle.cy,
        })),
        autoStep: clock.autoStep(),
        simTime: state.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — this build's own layout, reported.
     *
     * `null` on `countdown` and `playing`, which show no menu, and `null` when
     * `index` names no item of the menu the current screen does show.
     */
    menuItemRect(index) {
      const rect = menuItemRect(state.screen, index);
      return rect === null ? null : { ...rect };
    },
  };
}

/**
 * Install the surface on `window.__carom` and return the function that removes it
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
