// Carom — the debugging and automation surface, `window.__carom`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// THE SURFACE IS ATOMIC. Every operation is a READING or a POSE, and a pose sets
// ONE field, places or removes ONE entity, or moves the clock. There is no patch
// object, no lifecycle verb that arranges a scenario for the caller, and no
// operation that does two things at once — `reset` is the single exception, and
// it restores every declared field at once, which is how a caller gets back to a
// known start. Starting a match, staging a rally, or freezing the obstacles is
// therefore a SEQUENCE of these, composed by whoever is driving.
//
// That is the point of the split. These calls ARRANGE THE WORLD and never
// fabricate an outcome: they put the game into a situation, and the game's own
// `update` — the real collision, the real serve, the real AI — is what runs from
// there on the next frame. So a scenario driven from code behaves exactly like
// one played by hand.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Without them a scenario could only be driven by
// waiting, and a check that waits measures the machine it ran on. Everything else
// about driving a browser game stays absent: there is no `keyDown`, `keyUp` or
// `press` (the runtime's registered actions are driven by dispatching real key
// events at the page), no pointer pose (a real mouse and a real finger drive the
// menus), and no overlay drawing or toggle (the runtime draws the panel and owns
// the backtick key).

import { CAROM_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
import { ballSpeed, createBall } from "./entities";
import {
  toTitle,
  type CaromState,
  type Mode,
  type ResumeScreen,
  type Screen,
  type Side,
} from "./game";
import { menuItemRect, type MenuRect } from "./menu";
import { isObstacleIndex, placeObstacle, poseObstacles } from "./obstacles";

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
  /** Whether the loop is advancing the simulation from the wall clock. */
  autoStep(): boolean;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
  /** Set the audio bus's mute bit, the same bit the `mute` action toggles. */
  setMuted(muted: boolean): void;
}

/** One trail sample, as a snapshot reports it. */
export interface TrailSampleSnapshot {
  x: number;
  y: number;
  /** The simulation time the sample was recorded at, in seconds. */
  t: number;
}

/** The plain, JSON-serializable view of the ball a snapshot returns. */
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
  /** The ball's trail samples, oldest first. */
  trail: TrailSampleSnapshot[];
}

/** One obstacle's live pose, exactly as the oriented collision sees it. */
export interface ObstacleSnapshot {
  /** Its index in the order of OBSTACLE_CENTERS. */
  index: number;
  /** Live center x, in logical pixels. */
  cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  cy: number;
  /** The velocity the last frame integrated. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side, held across frames. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than the player or the AI. */
  driven: boolean;
}

/**
 * The whole declared state, as `specs/instrumentation.md` fixes it.
 *
 * Every field an operation of this surface sets appears here, so every operation
 * is verified by setting a value and reading it back.
 */
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
  seed: number;
  rngState: number;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  receiver: Side;
  /** The ball, or `null` while no ball is present. */
  ball: BallSnapshot | null;
  /** Every obstacle present, each entry under its own index. */
  obstacles: ObstacleSnapshot[];
  obstacleClock: number;
  obstacleClockRunning: boolean;
  /** False while the clock is scripted rather than run from the wall clock. */
  autoStep: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/** The surface, exactly as `specs/instrumentation.md` lists it. */
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

  /* The ball. This variant plays with one, so no operation takes an index. */
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

  /* Obstacles. */
  setObstacleClock(t: number): void;
  setObstacleClockRunning(running: boolean): void;

  /* Readings. */
  snapshot(): CaromSnapshot;
  menuItemRect(index: number): MenuRect | null;
}

/**
 * Restore every declared field of the state to its title-screen value.
 *
 * The game's own return to the title does most of it; a reset additionally starts
 * the simulation clock over, reseeds the generator, and puts both menu indices
 * back to `0` — the title-screen values `specs/state.md` gives them, which the
 * return to the title deliberately keeps instead.
 *
 * `muted` is untouched: muting is a player preference the runtime owns, and a
 * reset is not a reason to start making noise again. So is the auto-step setting,
 * which is the clock's rather than a value the game holds.
 */
function poseTitle(state: CaromState): void {
  // `toTitle` restores `menuIndex` FROM `titleIndex`, so zeroing the remembered
  // selection first is what puts both at their title-screen value.
  state.titleIndex = 0;
  toTitle(state);
  state.simTime = 0;
  state.seed = DEFAULT_SEED;
  state.rngState = DEFAULT_SEED;
}

/** Build the API over one live state object and the runtime driving it. */
export function createDebugApi(
  state: CaromState,
  clock: DebugClock,
): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    /* ---- The clock ------------------------------------------------------ */

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

    /* ---- The world ------------------------------------------------------ */

    /** Empty the field: every ball and every obstacle off it. The paddles stay. */
    clearWorld() {
      state.ball = null;
      state.obstacles = [];
    },

    /**
     * Place the ball at its home point, held, with a full `holdTimer`, zero
     * velocity, zero spin, and an empty trail — whether or not one was there.
     */
    spawnBall() {
      state.ball = createBall();
    },

    /** Place obstacle `index` in the pose the formulas give at the current clock. */
    spawnObstacle(index) {
      if (!isObstacleIndex(index)) {
        throw new RangeError(`Carom: no obstacle ${index}`);
      }
      placeObstacle(state.obstacles, index, state.obstacleClock);
    },

    /**
     * Return the game to its title-screen state: every declared field at once.
     *
     * It does not touch the clock. Whether the game is stepping itself is not a
     * declared field — `setAutoStep` is how that is said — and a driver that
     * resets mid-scenario means to re-pose the world, not to hand it back to real
     * time.
     */
    reset() {
      poseTitle(state);
    },

    /** Seed the game's random generator: `seed`, and the generator's start state. */
    setSeed(seed) {
      state.seed = seed;
      state.rngState = seed;
    },

    /* ---- Screens and menus ---------------------------------------------- */

    /**
     * Set the current screen, and nothing else. The scores, the world, and the
     * menu indices are left as they are, and the screen this names then behaves
     * exactly as `specs/ui.md` states for it.
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

    /* ---- Match state ---------------------------------------------------- */

    /**
     * Set both scores, as a precondition. The win and deuce rules still resolve
     * through real play, so drive a real point to end a match.
     */
    setScore(p1, p2) {
      state.score.p1 = p1;
      state.score.p2 = p2;
    },

    setWinner(side) {
      state.winner = side;
    },

    setReceiver(side) {
      state.receiver = side;
    },

    /* ---- Paddles -------------------------------------------------------- */

    setPaddleCy(side, cy) {
      state.paddles[side].cy = cy;
    },

    /**
     * Set that side's `drivenVy`, and leave its `vy` as it is.
     *
     * The two are separate fields: `drivenVy` is the velocity a DRIVEN paddle
     * moves at and it holds its value across frames whether or not the paddle is
     * driven, while `vy` is the velocity the last frame actually integrated. So a
     * `drivenVy` set while the paddle stands still reaches `vy` on the first
     * frame advanced with that side driven.
     */
    setPaddleVy(side, vy) {
      state.paddles[side].drivenVy = vy;
    },

    /**
     * Take that paddle from the player, or hand it back. The only pose that
     * changes a driven flag, and driving one side leaves the other as it was.
     */
    setPaddleDriven(side, driven) {
      state.paddles[side].driven = Boolean(driven);
    },

    /* ---- The ball ------------------------------------------------------- */
    //
    // Each sets its own field alone, and every one of them has no effect while
    // the ball is absent.

    setBallPosition(x, y) {
      const ball = state.ball;
      if (ball === null) return;
      ball.x = x;
      ball.y = y;
    },

    setBallVelocity(vx, vy) {
      const ball = state.ball;
      if (ball === null) return;
      ball.vx = vx;
      ball.vy = vy;
    },

    setBallSpin(spin) {
      if (state.ball !== null) state.ball.spin = spin;
    },

    setBallHeld(held) {
      if (state.ball !== null) state.ball.held = Boolean(held);
    },

    /**
     * Set the seconds remaining of the ball's hold. `0` ends it — the ball is
     * then served on the next advanced frame, through the game's own rule.
     */
    setBallHoldTimer(seconds) {
      if (state.ball !== null) state.ball.holdTimer = seconds;
    },

    /* ---- The AI opponent ------------------------------------------------ */

    /** Whether the AI senses the ball and chooses a target. */
    setAiTracking(enabled) {
      state.ai.tracking = Boolean(enabled);
    },

    /** Whether the AI's paddle travels toward that target. */
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

    /* ---- Obstacles ------------------------------------------------------ */

    /**
     * Set the obstacle clock, and nothing else.
     *
     * `t = 0` is upright at the base centers; a larger `t` sways and rotates them
     * exactly as normal play would at that moment. Both obstacles take the pose
     * that value gives them on the frame the clock is set, as on every other
     * frame, so a scenario reads the pose at exactly `t`.
     */
    setObstacleClock(t) {
      state.obstacleClock = t;
      poseObstacles(state.obstacles, state.obstacleClock);
    },

    /**
     * Whether the clock advances with the frame. While it does not, it keeps its
     * value across frames and both obstacles hold their poses.
     */
    setObstacleClockRunning(running) {
      state.obstacleClockRunning = Boolean(running);
    },

    /* ---- Readings ------------------------------------------------------- */

    /** A pure read. It never changes anything. */
    snapshot() {
      const ball = state.ball;
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
        seed: state.seed,
        rngState: state.rngState,
        paddles: {
          left: paddleView(state, "left"),
          right: paddleView(state, "right"),
        },
        ai: { tracking: state.ai.tracking, movement: state.ai.movement },
        receiver: state.receiver,
        ball:
          ball === null
            ? null
            : {
                x: ball.x,
                y: ball.y,
                vx: ball.vx,
                vy: ball.vy,
                speed: ballSpeed(ball),
                spin: ball.spin,
                held: ball.held,
                holdTimer: ball.holdTimer,
                trail: ball.trail.map((sample) => ({
                  x: sample.x,
                  y: sample.y,
                  t: sample.t,
                })),
              },
        obstacles: state.obstacles.map((obstacle) => ({
          index: obstacle.index,
          cx: obstacle.cx,
          cy: obstacle.cy,
          theta: obstacle.theta,
        })),
        obstacleClock: state.obstacleClock,
        obstacleClockRunning: state.obstacleClockRunning,
        autoStep: clock.autoStep(),
        simTime: state.simTime,
      };
    },

    /**
     * The hit region of item `index` on the menu the current screen shows, in
     * logical units, as the build itself laid it out.
     *
     * `null` on `countdown` and `playing`, which show no menu, and when `index`
     * names no item of the current menu.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
    },
  };
}

/** One paddle, flattened for a snapshot. */
function paddleView(state: CaromState, side: Side): PaddleSnapshot {
  const paddle = state.paddles[side];
  return {
    cy: paddle.cy,
    vy: paddle.vy,
    drivenVy: paddle.drivenVy,
    driven: paddle.driven,
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
