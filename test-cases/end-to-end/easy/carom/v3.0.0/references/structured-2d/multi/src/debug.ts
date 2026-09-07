// Carom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugSurface()` builds it, and the game instance's `initialize`
// returns it: the engine holds the returned value and hands it back unchanged
// as `engine.debug`, and that is the one way a caller reaches it. Nothing is
// installed on the page, it holds no state of its own, and it is inert during
// normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. A POSE takes only the arguments its heading names,
// returns nothing, and sets ONE field, places or removes ONE entity, or clears
// the field — it reads `game.engine.world` at the moment of the call and
// arranges it through the same systems play uses, and the frames that follow
// run the real collisions, the real launches, and the real AI from there. A
// READING takes only its own arguments and returns plain data read off the
// world at the instant of the call. `reset` is the one exception, and it is a
// lifecycle verb rather than a pose: it restores every declared field at once,
// which is how a caller gets back to a known start.
//
// Nothing here knows about level transitions. `setScreen` sets the screen and
// hands the instance the job of making sure the level that hosts it is the one
// that will be open (`followScreen`, src/game.ts), which is also what carries
// the world across when that level has to change. From a caller's side the
// discipline is the one specs/instrumentation.md states: pose, advance one
// frame, then pose or read again.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to
// the engine and is deliberately absent: there is no `step` (the engine's
// scripted clocks and `engine.advance` own time), no `keyDown` or `press` (the
// engine's registered actions and pointer are driven at its input seam), and no
// overlay drawing or toggle (the engine draws the panel and owns the backtick
// key).

import type { World } from "@clockwyrks/structured-2d";
import { CAROM_DEBUG_VERSION } from "./constants";
import {
  ballAt,
  ballsOf,
  clearField,
  isBallIndex,
  isObstacleIndex,
  obstaclesOf,
  paddleOf,
  spawnBall as spawnBallOn,
  spawnObstacle as spawnObstacleOn,
} from "./field";
import type { CaromGame } from "./game";
import { menuItemRect as rectOfItem, type MenuRect } from "./menus";
import type { Side } from "./sim";
import {
  screenOf,
  stateOf,
  type Mode,
  type ResumeScreen,
  type Screen,
} from "./state";
import type { TrailSample } from "./trail";
import { drawLaunchAngle } from "./random";

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

/** One ball, as a snapshot reports it. */
export interface BallSnapshot {
  /** This ball's index in play order. */
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity. Derived, never stored. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point for its own hold to elapse. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** The angle, in radians, this ball's next launch leaves along. */
  launchAngle: number;
  /** That ball's trail samples, oldest first. */
  trail: TrailSample[];
}

/** One obstacle, as a snapshot reports it. */
export interface ObstacleSnapshot {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  cx: number;
  cy: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The highlighted item on whichever menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection. */
  titleIndex: number;
  /** The screen a pause resumes to. */
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  /** The winning side once the match is over. */
  winner: Side | null;
  /** The engine's own mute bit, read live from the audio bus. */
  muted: boolean;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  /** The AI's two faculties, each gated on its own. */
  ai: { tracking: boolean; movement: boolean };
  /** Every ball present, in play order. */
  balls: BallSnapshot[];
  /** Every obstacle present, each entry under its own index. */
  obstacles: ObstacleSnapshot[];
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

  /* Balls: `index` first, in play order from 0 to BALL_COUNT - 1. */
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
  menuItemRect(index: number): MenuRect | null;
}

/** Build the surface over the game instance. It holds no state of its own. */
export function createDebugSurface(game: CaromGame): CaromDebug {
  /** The world every operation acts on: the one open at the call. */
  const open = (): World => game.engine.world;

  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The world -------------------------------------------------------

    /** Every ball and every obstacle off the field. The paddles stay. */
    clearWorld() {
      clearField(open());
    },

    /**
     * Ball `index` at its home point, held, with a full hold timer, zero
     * velocity, zero spin, and an empty trail. A ball already there is
     * returned to that arrangement; an index this variant does not have is
     * left alone.
     */
    spawnBall(index) {
      if (!isBallIndex(index)) return;
      spawnBallOn(open(), index);
    },

    /** Obstacle `index` at `OBSTACLE_CENTERS[index]`. */
    spawnObstacle(index) {
      if (!isObstacleIndex(index)) return;
      spawnObstacleOn(open(), index);
    },

    /**
     * The title-screen state, whole (specs/state.md). The mute bit is
     * deliberately untouched: it is the runtime's, and `reset` leaves it alone.
     */
    reset() {
      game.simTime = 0;
      game.titleIndex = 0;
      game.goToTitle(0);
    },

    // ---- Screens and menus -----------------------------------------------

    setScreen(screen) {
      stateOf(open()).screen = screen;
      game.followScreen(screen);
    },

    setMode(mode) {
      game.mode = mode;
    },

    setMenuIndex(index) {
      stateOf(open()).menuIndex = index;
    },

    setTitleIndex(index) {
      game.titleIndex = index;
    },

    setResumeScreen(screen) {
      stateOf(open()).resumeScreen = screen;
    },

    // ---- Match state -----------------------------------------------------

    /**
     * Both scores, as a precondition. The win and deuce rules still resolve
     * through real play, so drive a real point to end a match.
     */
    setScore(p1, p2) {
      stateOf(open()).score = { p1, p2 };
    },

    setWinner(side) {
      stateOf(open()).winner = side;
    },

    // ---- Paddles ---------------------------------------------------------

    setPaddleCy(side, cy) {
      paddleOf(open(), side).transform.y = cy;
    },

    /**
     * That side's `drivenVy`, the velocity it travels at while driven. The
     * paddle's own `vy` is left as it is: it is the integrated figure the next
     * frame produces, not the one written here.
     */
    setPaddleVy(side, vy) {
      game.driver[side].drivenVy = vy;
    },

    /** That side alone taken from the player and the AI, or handed back. */
    setPaddleDriven(side, driven) {
      game.driver[side].driven = driven;
    },

    // ---- Balls -----------------------------------------------------------

    setBallPosition(index, x, y) {
      const ball = ballAt(open(), index);
      if (ball === null) return;
      ball.transform.x = x;
      ball.transform.y = y;
    },

    setBallVelocity(index, vx, vy) {
      const ball = ballAt(open(), index);
      if (ball === null) return;
      ball.vx = vx;
      ball.vy = vy;
    },

    setBallSpin(index, spin) {
      const ball = ballAt(open(), index);
      if (ball !== null) ball.spin = spin;
    },

    setBallHeld(index, held) {
      const ball = ballAt(open(), index);
      if (ball !== null) ball.held = held;
    },

    /**
     * The seconds remaining of that ball's hold. `0` ends it: the game's own
     * rule launches the ball on the next advanced frame (specs/balls.md).
     */
    setBallHoldTimer(index, seconds) {
      const ball = ballAt(open(), index);
      if (ball !== null) ball.holdTimer = seconds;
    },

    /** The angle ball `index`'s next launch leaves along, in radians. */
    setBallLaunchAngle(index, angle) {
      const ball = ballAt(open(), index);
      if (ball !== null) ball.launchAngle = angle;
    },

    /** The one draw parking makes, made again on its own (specs/balls.md). */
    drawBallLaunchAngle(index) {
      const ball = ballAt(open(), index);
      if (ball !== null) ball.launchAngle = drawLaunchAngle();
    },

    // ---- The AI opponent -------------------------------------------------

    setAiTracking(enabled) {
      game.ai.tracking = enabled;
    },

    setAiMovement(enabled) {
      game.ai.movement = enabled;
    },

    // ---- Audio -----------------------------------------------------------

    /** The mute bit set on the runtime's bus, which `muted` reports back. */
    setMuted(muted) {
      open().audio.setMuted(muted);
    },

    // ---- Readings --------------------------------------------------------

    /** A pure reading of the running game. It changes nothing. */
    snapshot() {
      const world = open();
      const state = stateOf(world);
      const paddle = (side: Side): PaddleSnapshot => {
        const actor = paddleOf(world, side);
        return {
          cy: actor.transform.y,
          vy: actor.vy,
          drivenVy: game.driver[side].drivenVy,
          driven: game.driver[side].driven,
        };
      };
      return {
        version: CAROM_DEBUG_VERSION,
        screen: state.screen,
        mode: game.mode,
        menuIndex: state.menuIndex,
        titleIndex: game.titleIndex,
        resumeScreen: state.resumeScreen,
        score: { ...state.score },
        winner: state.winner,
        muted: world.audio.muted(),
        paddles: { left: paddle("left"), right: paddle("right") },
        ai: { tracking: game.ai.tracking, movement: game.ai.movement },
        balls: ballsOf(world).map((ball) => ({
          index: ball.index,
          x: ball.transform.x,
          y: ball.transform.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: Math.hypot(ball.vx, ball.vy),
          spin: ball.spin,
          held: ball.held,
          holdTimer: ball.holdTimer,
          launchAngle: ball.launchAngle,
          trail: ball.trail.map((sample) => ({ ...sample })),
        })),
        obstacles: obstaclesOf(world).map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.transform.x,
          cy: obstacle.transform.y,
        })),
        simTime: game.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — the build's own layout (src/menus.ts), reported.
     */
    menuItemRect(index) {
      return rectOfItem(screenOf(open()), index);
    },
  };
}
