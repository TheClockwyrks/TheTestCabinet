// Carom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugSurface()` builds it, and the game instance's `initialize`
// returns it: the engine holds the returned value and hands it back unchanged
// as `engine.debug`, and that is the one way a caller reaches it. Nothing is
// installed on the page, it holds no state of its own, and it is inert during
// normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS ATOMIC. Each one sets ONE field or one fixed pair of
// fields, places or removes ONE entity, or reads the state. There is no
// operation that takes a partial object and merges it, and none that arranges
// several unrelated things at once — a scenario is a SEQUENCE of these, which
// is what lets a check pose exactly the part of the world its requirement
// concerns and leave the rest playing normally. `reset` is the sole exception,
// and it is a lifecycle verb rather than a pose: it restores every declared
// field at once, which is how a check gets back to a known start.
//
// Every operation is a method acting on the LIVE game. A POSE takes only the
// arguments its heading names and returns nothing: it reads
// `game.engine.world` at the moment of the call and arranges it through the
// same systems play uses — it sets a field of the game state, moves a tagged
// actor, or spawns and destroys one — and the frames that follow run the real
// collision, the real serve, and the real AI from there. A READING takes only
// its own arguments and returns plain data read off the world at the call.
//
// NOTHING HERE CROSSES A LEVEL TRANSITION, and that is deliberate. All six
// screens are hosted by whichever world is open (`src/carom-mode.ts`), so
// `setScreen` really does set one field and leave the scores, the world, and
// the menu indices as they were, and `reset` really does land at the call
// rather than at the end of the next frame. A caller that advances a frame
// before reading — the discipline the specification allows for — gets the same
// answer either way.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to
// the engine and is deliberately absent: there is no `step` (the engine's
// scripted clocks and `engine.advance` own time), no `keyDown` or `press` (the
// engine's registered actions are driven at its input seam), and no overlay
// drawing or toggle (the engine draws the panel and owns the backtick key).

import type { World } from "@test-cabinet/structured-2d";
import { Ball, ballOf, spawnBallActor } from "./ball";
import { CaromMode } from "./carom-mode";
import {
  CAROM_DEBUG_VERSION,
  DEFAULT_SEED,
  OBSTACLE_CENTERS,
} from "./constants";
import type { CaromGame } from "./game";
import { menuItemRect as rectOf, type MenuRect } from "./menu";
import { paddleOf } from "./paddle";
import { obstaclesOf, spawnObstacleActor } from "./scenery";
import type { Side } from "./sim";
import {
  caromState,
  type CaromState,
  type Mode,
  type ResumeScreen,
  type Screen,
} from "./state";
import type { TrailSample } from "./trail";

/** One sample of the ball's trail, as a snapshot reports it. */
export interface TrailPoint {
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
  /** The ball's trail samples, oldest first. */
  trail: TrailPoint[];
}

/** One obstacle present on the field, at its fixed center. */
export interface ObstacleSnapshot {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  cx: number;
  cy: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  /** Center y, in logical units. */
  cy: number;
  /** The velocity the last frame integrated, in units per second. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side, held across frames. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than the player or the AI. */
  driven: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation of this surface sets appears here, so every
 * operation is verified by setting a value and reading it back. Five figures
 * are read rather than posed: `version`, the ball's `speed`, a paddle's `vy`,
 * `muted`, and `simTime`.
 */
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
  /** Whether the mute toggle is currently on. */
  muted: boolean;
  /** The seed the generator was last seeded from. */
  seed: number;
  /** That generator's current state, as a single number. */
  rngState: number;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  /** The AI's two faculties, each gated on its own. */
  ai: { tracking: boolean; movement: boolean };
  /** The side the next serve travels toward. */
  receiver: Side;
  /** The ball, or `null` while no ball is present. */
  ball: BallSnapshot | null;
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
  spawnBall(): void;
  spawnObstacle(index: number): void;
  reset(): void;
  setSeed(seed: number): void;

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

  /* The AI opponent: one operation per faculty. */
  setAiTracking(enabled: boolean): void;
  setAiMovement(enabled: boolean): void;

  /* Audio. */
  setMuted(muted: boolean): void;

  /* Readings. */
  snapshot(): CaromSnapshot;
  menuItemRect(index: number): MenuRect | null;
}

/** The mode governing the open world. */
function modeOf(world: World): CaromMode {
  const mode = world.mode;
  if (!(mode instanceof CaromMode)) {
    throw new Error(`Carom: the "${world.level}" level runs no Carom mode`);
  }
  return mode;
}

/** The trail as plain data the caller owns. */
function trailOf(trail: readonly TrailSample[]): TrailPoint[] {
  return trail.map((sample) => ({ x: sample.x, y: sample.y, t: sample.t }));
}

/** The ball, as the snapshot reports it, or `null` while none is present. */
function ballSnapshot(ball: Ball | null): BallSnapshot | null {
  if (ball === null) return null;
  return {
    x: ball.transform.x,
    y: ball.transform.y,
    vx: ball.vx,
    vy: ball.vy,
    speed: Math.hypot(ball.vx, ball.vy),
    spin: ball.spin,
    held: ball.held,
    holdTimer: ball.holdTimer,
    trail: trailOf(ball.trail),
  };
}

/** Build the surface over the game instance. It holds no state of its own. */
export function createDebugSurface(game: CaromGame): CaromDebug {
  const world = (): World => game.engine.world;
  const state = (): CaromState => caromState(world());
  /** A pose on the ball has no effect while the ball is absent. */
  const withBall = (pose: (ball: Ball) => void): void => {
    const ball = ballOf(world());
    if (ball !== null) pose(ball);
  };

  return {
    version: CAROM_DEBUG_VERSION,

    // ---- The world -------------------------------------------------------

    /**
     * The field emptied of every ball and every obstacle. The paddles stay:
     * they are furniture the game always has, and a check that must keep one
     * out of the way takes it with `setPaddleDriven` instead.
     */
    clearWorld() {
      modeOf(world()).clearWorld();
    },

    /** The ball at its home point, held, with a full hold and no trail. */
    spawnBall() {
      const present = ballOf(world());
      if (present !== null) {
        present.home();
        return;
      }
      spawnBallActor(world());
    },

    /** Obstacle `index` at `OBSTACLE_CENTERS[index]`. */
    spawnObstacle(index) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= OBSTACLE_CENTERS.length
      ) {
        throw new RangeError(
          `Carom: obstacle index ${index} — this field has ` +
            `${OBSTACLE_CENTERS.length}, indexed from 0`,
        );
      }
      spawnObstacleActor(world(), index);
    },

    /**
     * The game returned to its title-screen state: every declared field at the
     * value specs/state.md gives it, with the world placed exactly as
     * `spawnBall` and `spawnObstacle` place it. The mute bit is deliberately
     * untouched — it is the runtime's, and specs/instrumentation.md exempts it.
     */
    reset() {
      const open = world();
      const mode = modeOf(open);
      const current = caromState(open);

      game.titleIndex = 0;
      game.simTime = 0;
      game.setSeed(DEFAULT_SEED);
      game.ai.tracking = true;
      game.ai.movement = true;
      for (const side of ["left", "right"] as const) {
        game.driven[side] = false;
        game.drivenVy[side] = 0;
      }

      current.screen = "title";
      current.mode = "solo";
      current.menuIndex = 0;
      current.resumeScreen = "playing";
      current.winner = null;
      current.receiver = "left";
      for (const player of current.players) player.score = 0;

      mode.setMode("solo");
      mode.forgetPresses();
      mode.centerPaddles();
      mode.standardWorld();
      mode.setPhase("playing");
    },

    /** The generator seeded: `seed` is the value given, `rngState` its start. */
    setSeed(seed) {
      game.setSeed(seed);
    },

    // ---- Screens and menus ----------------------------------------------

    setScreen(screen) {
      state().screen = screen;
    },

    setMode(mode) {
      modeOf(world()).setMode(mode);
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

    // ---- Match state -----------------------------------------------------

    /**
     * The two scores set directly, as a precondition. The win and deuce rules
     * still resolve through real play, so drive a real point to end a match.
     */
    setScore(p1, p2) {
      const [one, two] = state().players;
      if (one !== undefined) one.score = p1;
      if (two !== undefined) two.score = p2;
    },

    setWinner(side) {
      state().winner = side;
    },

    setReceiver(side) {
      state().receiver = side;
    },

    // ---- Paddles ---------------------------------------------------------

    setPaddleCy(side, cy) {
      paddleOf(world(), side).transform.y = cy;
    },

    /**
     * The velocity a driven paddle moves at. It is `drivenVy` alone: the
     * paddle's own `vy` is the integrated figure the next frame produces, so a
     * velocity set here reaches `vy` only through a frame advanced with that
     * side driven.
     */
    setPaddleVy(side, vy) {
      game.drivenVy[side] = vy;
    },

    /** That paddle taken from the player and the AI, or handed back. */
    setPaddleDriven(side, driven) {
      game.driven[side] = driven;
    },

    // ---- The ball --------------------------------------------------------

    setBallPosition(x, y) {
      withBall((ball) => {
        ball.transform.x = x;
        ball.transform.y = y;
      });
    },

    setBallVelocity(vx, vy) {
      withBall((ball) => {
        ball.vx = vx;
        ball.vy = vy;
      });
    },

    setBallSpin(spin) {
      withBall((ball) => {
        ball.spin = spin;
      });
    },

    setBallHeld(held) {
      withBall((ball) => {
        ball.held = held;
      });
    },

    /**
     * The seconds remaining of the ball's hold. Setting it to `0` ends the
     * hold, and the game's own rule serves the ball on the next advanced
     * countdown frame (specs/balls.md) — which is what serving IS, and why the
     * surface carries no `serve`.
     */
    setBallHoldTimer(seconds) {
      withBall((ball) => {
        ball.holdTimer = seconds;
      });
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
      world().audio.setMuted(muted);
    },

    // ---- Readings --------------------------------------------------------

    /** A pure reading of the running game. It changes nothing. */
    snapshot() {
      const open = world();
      const current = caromState(open);
      const left = paddleOf(open, "left");
      const right = paddleOf(open, "right");
      const [p1, p2] = current.players;
      return {
        version: CAROM_DEBUG_VERSION,
        screen: current.screen,
        mode: current.mode,
        menuIndex: current.menuIndex,
        titleIndex: game.titleIndex,
        resumeScreen: current.resumeScreen,
        score: { p1: p1?.score ?? 0, p2: p2?.score ?? 0 },
        winner: current.winner,
        muted: open.audio.muted(),
        seed: game.seed,
        rngState: game.rngState,
        paddles: {
          left: {
            cy: left.transform.y,
            vy: left.vy,
            drivenVy: game.drivenVy.left,
            driven: game.driven.left,
          },
          right: {
            cy: right.transform.y,
            vy: right.vy,
            drivenVy: game.drivenVy.right,
            driven: game.driven.right,
          },
        },
        ai: { tracking: game.ai.tracking, movement: game.ai.movement },
        receiver: current.receiver,
        ball: ballSnapshot(ballOf(open)),
        obstacles: obstaclesOf(open).map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.transform.x,
          cy: obstacle.transform.y,
        })),
        simTime: game.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units — the build's own layout, reported so a caller can drive a
     * pointer at it. `null` on `countdown` and `playing`, which show no menu,
     * and for an index that names no item of the current menu.
     */
    menuItemRect(index) {
      return rectOf(state().screen, index);
    },
  };
}
