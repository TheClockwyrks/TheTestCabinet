// Carom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugSurface()` builds it, and the game instance's `initialize`
// returns it: the engine holds the returned value and hands it back unchanged
// as `engine.debug`, and that is the one way a caller reaches it. Nothing is
// installed on the page, it holds no state of its own, and it is inert during
// normal play: nothing below runs until something calls it.
//
// Every operation is a method acting on the LIVE game. A POSE takes only the
// arguments its heading names and returns nothing: it reads
// `game.engine.world` at the moment of the call and arranges it through the
// same systems play uses — it drives the game mode, patches the tagged actors,
// or opens the level a menu choice would open — and the frames that follow run
// the real collision, the real launches, and the real AI from there. A READING
// takes nothing and returns plain data read off the world at the call.
//
// ONE WRINKLE IS CROSSING A LEVEL TRANSITION. `startMatch` starts a match
// exactly as the menu does: `world.open` on the match level, which the engine
// performs on the next frame. A scenario typically follows it with more poses
// before advancing — `startMatch`, then `setPaddle` and `setBall`, then a few
// frames — so a pose made while that transition is pending is held and applied
// the moment the match's world has begun play (`CaromGame.worldOpened`), in
// call order, against the live actors of the world it was aimed at. From the
// caller's side the sequencing is unchanged: pose, advance, read.
//
// Everything about DRIVING A BROWSER GAME rather than about Carom belongs to
// the engine and is deliberately absent: there is no `step` (the engine's
// scripted clocks and `engine.advance` own time), no `keyDown` or `press` (the
// engine's registered actions are driven at its input seam), and no overlay
// drawing or toggle (the engine draws the panel and owns the backtick key).

import type { World } from "@test-cabinet/structured-2d";
import { ballAt, ballsOf } from "./ball";
import {
  BALL_COUNT,
  CAROM_DEBUG_VERSION,
  DEFAULT_SEED,
  FIELD_CY,
  LEVELS,
  TAGS,
} from "./constants";
import type { CaromGame } from "./game";
import { Paddle } from "./paddle";
import type { Side } from "./sim";
import {
  MatchState,
  screenOf,
  TitleState,
  type Mode,
  type Screen,
} from "./state";

/** The fields `setPaddle` may set. Anything omitted is left as it is. */
export interface PaddlePatch {
  /** Center y, in logical pixels. */
  cy?: number;
  /**
   * Vertical velocity in units per second. It is written to the paddle AND
   * held by the driver for that side, so it PERSISTS across frames and the
   * paddle is still moving when it strikes a ball, which is what drives the
   * spin mechanic.
   */
  vy?: number;
}

/** The fields `setBall` may set. Anything omitted is left as it is. */
export interface BallPatch {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

/** The plain, JSON-serializable view of one ball `snapshot()` returns. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity. Derived, never stored. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point for its own hold to elapse. */
  held: boolean;
}

export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  score: { p1: number; p2: number };
  winner: Side | null;
  /** The engine's own mute bit, read live from the audio bus. */
  muted: boolean;
  paddles: {
    left: { cy: number; vy: number };
    right: { cy: number; vy: number };
  };
  /** All three balls, in play order. */
  balls: BallSnapshot[];
  /** The frame clock's accumulated simulated time, in seconds. */
  simTime: number;
}

/**
 * The surface, as `specs/instrumentation.md` fixes it: a pose takes only its
 * own arguments and returns nothing, and the one reading returns what it read.
 */
export interface CaromDebug {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): CaromSnapshot;
  startMatch(mode: Mode): void;
  serve(): void;
  setScore(p1: number, p2: number): void;
  setPaddle(side: Side, patch?: PaddlePatch): void;
  setBall(index: number, patch?: BallPatch): void;
  setAiControl(enabled: boolean): void;
}

/** The side's tagged paddle actor, in whichever level is open. */
function paddleOf(world: World, side: Side): Paddle {
  const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
  const found = world.byTag(tag)[0];
  if (!(found instanceof Paddle)) {
    throw new Error(`Carom: no ${side} paddle carries the "${tag}" tag`);
  }
  return found;
}

/** Build the surface over the game instance. It holds no state of its own. */
export function createDebugSurface(game: CaromGame): CaromDebug {
  return {
    version: CAROM_DEBUG_VERSION,

    /**
     * The title screen, with the paddles handed back to the player and (in
     * Solo) the AI, and the game's randomness reseeded. `muted` is
     * deliberately untouched (the engine owns it), and so is `simTime`: the
     * frame clock belongs to the engine and runs whatever the screen.
     */
    reset(options) {
      game.reseed(options?.seed ?? DEFAULT_SEED);
      game.releaseControl();
      const wasOpening = game.cancelPendingMatch();
      const world = game.engine.world;
      if (world.state instanceof MatchState || wasOpening) {
        // Quitting to the menu, exactly as the pause and match-over menus do
        // it: the transition builds the title's world fresh.
        world.open(LEVELS.title);
        return;
      }
      // Already on the title level: pose it back to its opening state.
      if (world.state instanceof TitleState) {
        world.state.screen = "title";
        world.state.menuIndex = 0;
      }
      for (const side of ["left", "right"] as const) {
        const paddle = paddleOf(world, side);
        paddle.transform.y = FIELD_CY;
        paddle.vy = 0;
      }
      // Each ball parked on its own home point, not held, hold timer 0.
      for (const ball of ballsOf(world)) ball.park(0);
    },

    /** A pure reading of the running game. It changes nothing. */
    snapshot() {
      const engine = game.engine;
      const world = engine.world;
      const match = world.state instanceof MatchState ? world.state : null;
      const left = paddleOf(world, "left");
      const right = paddleOf(world, "right");
      return {
        version: CAROM_DEBUG_VERSION,
        screen: screenOf(world),
        mode: game.mode,
        score: {
          p1: match?.players[0]?.score ?? 0,
          p2: match?.players[1]?.score ?? 0,
        },
        winner: match?.winner ?? null,
        muted: world.audio.muted(),
        paddles: {
          left: { cy: left.transform.y, vy: left.vy },
          right: { cy: right.transform.y, vy: right.vy },
        },
        balls: ballsOf(world).map((ball) => ({
          x: ball.transform.x,
          y: ball.transform.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: Math.hypot(ball.vx, ball.vy),
          spin: ball.spin,
          held: ball.held,
        })),
        simTime: engine.frame().timeMs / 1000,
      };
    },

    /**
     * The opening of a real match, exactly as choosing it from the menu
     * would pose it: the match level opens fresh, on the countdown, with all
     * three balls waiting out a full hold on their own home points.
     */
    startMatch(mode) {
      game.takeControl();
      game.openMatch(mode);
    },

    /**
     * Every waiting ball's hold ended now instead of waited out: each such
     * ball's timer is set to `0`, a ball already in flight is left as it is,
     * and on any screen but the two live ones nothing is posed. The launch
     * itself is the game's own: on the next advanced frame each ball whose
     * timer has elapsed leaves at SERVE_SPEED along a fresh random angle
     * (src/ball.ts).
     */
    serve() {
      game.takeControl();
      game.poseMatch((state) => {
        if (state.screen !== "countdown" && state.screen !== "playing") return;
        for (const ball of ballsOf(state.world)) {
          if (ball.held) ball.holdTimer = 0;
        }
      });
    },

    /**
     * The two scores set directly, as a precondition. The win and deuce rules
     * still resolve through real play, so drive a real point to end a match.
     */
    setScore(p1, p2) {
      game.takeControl();
      game.poseMatch((state) => {
        const [one, two] = state.players;
        if (one !== undefined) one.score = p1;
        if (two !== undefined) two.score = p2;
      });
    },

    /**
     * A paddle posed or set moving. A `vy` set here is the driver's held
     * velocity rather than a one-frame nudge, so it persists until `reset`.
     */
    setPaddle(side, patch) {
      game.takeControl();
      if (patch?.vy !== undefined) game.driver.vy[side] = patch.vy;
      game.poseField((world) => {
        const paddle = paddleOf(world, side);
        if (patch?.cy !== undefined) paddle.transform.y = patch.cy;
        if (patch?.vy !== undefined) paddle.vy = patch.vy;
      });
    },

    /**
     * One of the three balls placed and aimed, `index` numbering them in play
     * order from 0. Posing a ball takes it into live play — `held` cleared
     * and its hold timer spent — so a scenario can drive one ball while
     * parking the other two out of the way. An index this variant does not
     * have is refused before anything is posed.
     */
    setBall(index, patch) {
      if (!Number.isInteger(index) || index < 0 || index >= BALL_COUNT) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has ${BALL_COUNT} ` +
            `balls, indices 0 to ${BALL_COUNT - 1}`,
        );
      }
      game.takeControl();
      game.poseField((world) => {
        const ball = ballAt(world, index);
        if (patch?.x !== undefined) ball.transform.x = patch.x;
        if (patch?.y !== undefined) ball.transform.y = patch.y;
        if (patch?.vx !== undefined) ball.vx = patch.vx;
        if (patch?.vy !== undefined) ball.vy = patch.vy;
        if (patch?.spin !== undefined) ball.spin = patch.spin;
        ball.release();
      });
    },

    /**
     * The AI-controlled (right) paddle handed back to the computer opponent
     * for the rest of the driven scenario, so advancing the game runs the
     * real AI against the posed balls while the left paddle and the balls
     * stay under the caller's control. Solo only; `false` is the default, and
     * `reset()` clears it.
     */
    setAiControl(enabled) {
      game.takeControl();
      game.driver.ai = Boolean(enabled);
    },
  };
}
