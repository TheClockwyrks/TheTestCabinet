// Carom (Gyre) — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugSurface()` builds it and the game instance's `initialize` returns
// it: the engine holds the returned value and hands it back unchanged as
// `engine.debug`, and that is the one way a caller reaches it. Nothing is
// installed on the page, it holds no state of its own, and it is inert during
// normal play — nothing below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. A pose takes only the arguments its heading names,
// returns nothing, and sets ONE field, places or removes ONE entity, or clears
// the field; a reading takes only its own arguments and returns plain data read
// off the world at the instant of the call. There is no operation that takes a
// partial object and merges it, and none that arranges several unrelated things
// at once. `reset` is the sole exception, and it is a lifecycle verb rather than
// a pose: it restores every declared field at once, which is how a caller gets
// back to a known start.
//
// EVERY POSE ARRANGES THE LIVE WORLD through the same systems play uses. It
// reads `game.engine.world` at the moment of the call — the instance holds the
// engine and `engine.world` follows every transition, so nothing here caches a
// world — and writes onto the world's game state and its tagged actors. The
// frames that follow then run the real collisions, the real serve, and the real
// AI from there, so a scenario driven from code behaves exactly like one played
// by hand.
//
// FOUR POSES CHANGE THE SCREEN, and two of the four may cross a level: Carom's
// six screens are split across two levels (`src/state.ts`), and the engine
// honors a transition as the frame ends. Those go through the game instance
// (`src/game.ts`), which builds the carry saying what survives
// (`src/carry.ts`), and a caller advances one frame after such a pose before it
// poses, presses a key, or reads further.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to
// the engine and is deliberately absent: there is no step (the engine's
// scripted clocks and `engine.advance` own time), no key press (the engine's
// registered actions are driven at its input seam), and no overlay drawing or
// toggle (the engine draws the panel and owns the backtick key).

import type { World } from "@clockwyrks/structured-2d";
import { CAROM_DEBUG_VERSION } from "./constants";
import {
  ballOf,
  clearField,
  isObstacleIndex,
  obstaclesOf,
  paddleOf,
  placeBall,
  placeObstacle,
  poseObstacles,
} from "./field";
import type { CaromGame } from "./game";
import { menuItemRect, type MenuRect } from "./menus";
import type { Side } from "./sim";
import {
  caromState,
  type CaromState,
  type Mode,
  type ResumeScreen,
  type Screen,
} from "./state";
import { drawServeSign } from "./random";

export type { MenuRect } from "./menus";

/** One sample of the ball's trail: where it was, and when. */
export interface TrailSampleSnapshot {
  x: number;
  y: number;
  /** The simulation time the sample was recorded at, in seconds. */
  t: number;
}

/** The ball, as a snapshot reports it. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. Derived, never stored. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point rather than flying. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The vertical sign the serve takes. */
  serveSign: 1 | -1;
  /** The ball's trail samples, oldest first. */
  trail: TrailSampleSnapshot[];
}

/** One obstacle's live pose, exactly as the oriented collision sees it. */
export interface ObstacleSnapshot {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  /** Live center x, in logical units. */
  cx: number;
  /** Live center y, in logical units: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  /** Center y, in logical units. */
  cy: number;
  /** The velocity the last frame integrated, in units per second. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side, held across frames. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than the player or AI. */
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
  /** The engine's own mute bit, read live off the audio bus. */
  muted: boolean;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  receiver: Side;
  /** The ball, or null while no ball is present. */
  ball: BallSnapshot | null;
  /** Every obstacle present, each under its own index. */
  obstacles: ObstacleSnapshot[];
  obstacleClock: number;
  obstacleClockRunning: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface, as `specs/instrumentation.md` fixes it: a pose takes only its
 * own arguments and returns nothing, and a reading returns what it read.
 */
export interface CaromDebug {
  version: number;

  /* The world. */
  clearWorld(): void;
  spawnBall(): void;
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
  setReceiver(side: Side): void;

  /* Paddles. */
  setPaddleCy(side: Side, cy: number): void;
  setPaddleVy(side: Side, vy: number): void;
  setPaddleDriven(side: Side, driven: boolean): void;

  /* The ball. */
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

  /* The obstacle clock. */
  setObstacleClock(t: number): void;
  setObstacleClockRunning(running: boolean): void;

  /* Readings. */
  snapshot(): CaromSnapshot;
  menuItemRect(index: number): MenuRect | null;
}

/** Build the surface over the game instance. It holds no state of its own. */
export function createDebugSurface(game: CaromGame): CaromDebug {
  const world = (): World => game.engine.world;
  const state = (): CaromState => caromState(world());

  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The world ------------------------------------------------------

    /** Every ball and every obstacle removed. The paddles stay. */
    clearWorld() {
      clearField(world());
    },

    /** The ball at its home point, held, with a full hold and no trail. */
    spawnBall() {
      placeBall(world());
    },

    /** Obstacle `index`, in the pose the current obstacle clock gives it. */
    spawnObstacle(index) {
      if (!isObstacleIndex(index)) return;
      placeObstacle(world(), index, state().obstacleClock);
    },

    /**
     * The whole game back to its title-screen state. The mute bit is the
     * engine's and is left alone, so `muted` is unchanged.
     */
    reset() {
      game.reset();
    },

    // ---- Screens and menus ----------------------------------------------

    setScreen(screen) {
      game.setScreen(screen);
    },

    setMode(mode) {
      game.mode = mode;
    },

    setMenuIndex(index) {
      state().menuIndex = index;
    },

    setTitleIndex(index) {
      game.titleIndex = index;
    },

    setResumeScreen(screen) {
      state().resumeScreen = screen;
    },

    // ---- Match state ----------------------------------------------------

    /** Both scores: a fixed pair, not a patch. */
    setScore(p1, p2) {
      state().score = { p1, p2 };
    },

    setWinner(side) {
      state().winner = side;
    },

    setReceiver(side) {
      state().receiver = side;
    },

    // ---- Paddles --------------------------------------------------------

    setPaddleCy(side, cy) {
      const paddle = paddleOf(world(), side);
      if (paddle !== null) paddle.transform.y = cy;
    },

    /**
     * That side's `drivenVy`, and nothing else: `vy` stays the integrated
     * value the last frame produced, and reaches `drivenVy` on the first frame
     * advanced with the side driven (specs/instrumentation.md).
     */
    setPaddleVy(side, vy) {
      const paddle = paddleOf(world(), side);
      if (paddle !== null) paddle.drivenVy = vy;
    },

    /** One side taken from its player, or handed back. The other is untouched. */
    setPaddleDriven(side, driven) {
      const paddle = paddleOf(world(), side);
      if (paddle !== null) paddle.driven = driven;
    },

    // ---- The ball -------------------------------------------------------
    //
    // Each sets its own field alone, and each does nothing while the ball is
    // absent — which is what makes an absent ball genuinely absent rather than
    // a hidden one still holding figures.

    setBallPosition(x, y) {
      const ball = ballOf(world());
      if (ball === null) return;
      ball.transform.x = x;
      ball.transform.y = y;
    },

    setBallVelocity(vx, vy) {
      const ball = ballOf(world());
      if (ball === null) return;
      ball.vx = vx;
      ball.vy = vy;
    },

    setBallSpin(spin) {
      const ball = ballOf(world());
      if (ball !== null) ball.spin = spin;
    },

    setBallHeld(held) {
      const ball = ballOf(world());
      if (ball !== null) ball.held = held;
    },

    /**
     * The seconds left of the hold. `0` ends it, and the game's own rule serves
     * the ball on the next advanced frame (specs/balls.md).
     */
    setBallHoldTimer(seconds) {
      const ball = ballOf(world());
      if (ball !== null) ball.holdTimer = seconds;
    },

    /** The vertical sign the ball's serve takes, `1` or `-1`. */
    setBallServeSign(sign) {
      const ball = ballOf(world());
      if (ball !== null) ball.serveSign = sign < 0 ? -1 : 1;
    },

    /** The one draw parking makes, made again on its own (specs/balls.md). */
    drawBallServeSign() {
      const ball = ballOf(world());
      if (ball !== null) ball.serveSign = drawServeSign();
    },

    // ---- The AI opponent -------------------------------------------------

    setAiTracking(enabled) {
      state().ai.tracking = enabled;
    },

    setAiMovement(enabled) {
      state().ai.movement = enabled;
    },

    // ---- Audio -----------------------------------------------------------

    /** The mute bit set on the runtime's bus, which `muted` reports back. */
    setMuted(muted) {
      world().audio.setMuted(muted);
    },

    // ---- The obstacle clock ---------------------------------------------

    /**
     * The clock set, and both obstacles reposed at once from it — so the pose
     * is live from this call: the next advanced frame's flight resolves against
     * it and a snapshot reads it back.
     */
    setObstacleClock(t) {
      const open = world();
      caromState(open).obstacleClock = t;
      poseObstacles(open, t);
    },

    /** Whether the clock advances with the frame. */
    setObstacleClockRunning(running) {
      state().obstacleClockRunning = running;
    },

    // ---- Readings -------------------------------------------------------

    /** A pure reading of the running game. It changes nothing. */
    snapshot() {
      const open = world();
      const live = caromState(open);
      const ball = ballOf(open);
      return {
        version: CAROM_DEBUG_VERSION,
        screen: live.screen,
        mode: game.mode,
        menuIndex: live.menuIndex,
        titleIndex: game.titleIndex,
        resumeScreen: live.resumeScreen,
        score: { p1: live.score.p1, p2: live.score.p2 },
        winner: live.winner,
        muted: open.audio.muted(),
        paddles: {
          left: paddleSnapshot(open, "left"),
          right: paddleSnapshot(open, "right"),
        },
        ai: { tracking: live.ai.tracking, movement: live.ai.movement },
        receiver: live.receiver,
        ball:
          ball === null
            ? null
            : {
                x: ball.transform.x,
                y: ball.transform.y,
                vx: ball.vx,
                vy: ball.vy,
                speed: Math.hypot(ball.vx, ball.vy),
                spin: ball.spin,
                held: ball.held,
                holdTimer: ball.holdTimer,
                serveSign: ball.serveSign,
                trail: ball.trail.map((sample) => ({
                  x: sample.x,
                  y: sample.y,
                  t: sample.t,
                })),
              },
        obstacles: obstaclesOf(open).map((obstacle) => ({
          index: obstacle.index,
          ...obstacle.pose(),
        })),
        obstacleClock: live.obstacleClock,
        obstacleClockRunning: live.obstacleClockRunning,
        simTime: game.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — the build's own layout, reported, so a caller driving the
     * menus with a mouse or a finger aims where the game listens
     * (`src/menus.ts`).
     */
    menuItemRect(index) {
      return menuItemRect(state().screen, index);
    },
  };
}

function paddleSnapshot(world: World, side: Side): PaddleSnapshot {
  const paddle = paddleOf(world, side);
  if (paddle === null) {
    return { cy: 0, vy: 0, drivenVy: 0, driven: false };
  }
  return {
    cy: paddle.transform.y,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
  };
}
