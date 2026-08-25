// Carom (Gyre) — the debugging and automation surface.
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
// the real collision, the real serve, and the real AI from there. A READING
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
import { Ball } from "./ball";
import {
  CAROM_DEBUG_VERSION,
  DEFAULT_SEED,
  FIELD_CY,
  LEVELS,
  TAGS,
} from "./constants";
import type { CaromGame } from "./game";
import { Paddle } from "./paddle";
import { Obstacle } from "./scenery";
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
   * paddle is still moving when it strikes the ball, which is what drives the
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

/** The plain, JSON-serializable view of the ball `snapshot()` returns. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity. Derived, never stored. */
  speed: number;
  spin: number;
  /** True while the ball is parked for its pre-serve countdown. */
  held: boolean;
}

/** One obstacle's live pose, exactly as the oriented collision sees it. */
export interface ObstacleSnapshot {
  /** Live center x, in logical pixels. */
  cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
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
  ball: BallSnapshot;
  /**
   * Both obstacles' live poses, in the order of OBSTACLE_CENTERS, read
   * straight off the tagged actors' transforms — the same values the oriented
   * collision resolves against.
   */
  obstacles: ObstacleSnapshot[];
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
  setObstacleClock(t: number): void;
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

/** The one ball in play, in whichever level is open. */
function ballOf(world: World): Ball {
  const found = world.byTag(TAGS.ball)[0];
  if (!(found instanceof Ball)) {
    throw new Error(`Carom: no ball carries the "${TAGS.ball}" tag`);
  }
  return found;
}

/** The two obstacles, in spawn (A then B) order, in whichever level is open. */
function obstaclesOf(world: World): Obstacle[] {
  return world
    .byTag(TAGS.obstacle)
    .filter((actor): actor is Obstacle => actor instanceof Obstacle);
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
      ballOf(world).park();
    },

    /** A pure reading of the running game. It changes nothing. */
    snapshot() {
      const engine = game.engine;
      const world = engine.world;
      const match = world.state instanceof MatchState ? world.state : null;
      const left = paddleOf(world, "left");
      const right = paddleOf(world, "right");
      const ball = ballOf(world);
      const held = (match?.holdTimer ?? 0) > 0;
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
        ball: {
          x: ball.transform.x,
          y: ball.transform.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: Math.hypot(ball.vx, ball.vy),
          spin: ball.spin,
          held,
        },
        obstacles: obstaclesOf(world).map((obstacle) => obstacle.pose()),
        simTime: engine.frame().timeMs / 1000,
      };
    },

    /**
     * The opening of a real match, exactly as choosing it from the menu
     * would pose it: the match level opens fresh, on the pre-serve countdown
     * with the first serve aimed at player one.
     */
    startMatch(mode) {
      game.takeControl();
      game.openMatch(mode);
    },

    /**
     * The countdown expired now, so the ball launches on the next frame
     * instead of waiting the hold out. On a live rally it re-serves: the ball
     * is re-parked and handed back to a countdown that has already elapsed,
     * so a re-serve and a first serve behave identically. The launch itself
     * is the game's own (src/match-mode.ts).
     */
    serve() {
      game.takeControl();
      game.poseMatch((state) => {
        if (state.screen === "playing") {
          ballOf(state.world).park();
          state.screen = "countdown";
        } else if (state.screen !== "countdown") {
          return;
        }
        state.holdTimer = 0;
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
     * The ball placed and aimed. `index` is `0`, selecting the single ball in
     * play.
     */
    setBall(index, patch) {
      if (index !== 0) {
        throw new RangeError(
          `Carom: setBall index ${index} — this variant has one ball, index 0`,
        );
      }
      game.takeControl();
      game.poseField((world) => {
        const ball = ballOf(world);
        if (patch?.x !== undefined) ball.transform.x = patch.x;
        if (patch?.y !== undefined) ball.transform.y = patch.y;
        if (patch?.vx !== undefined) ball.vx = patch.vx;
        if (patch?.vy !== undefined) ball.vy = patch.vy;
        if (patch?.spin !== undefined) ball.spin = patch.spin;
      });
    },

    /**
     * The AI-controlled (right) paddle handed back to the computer opponent
     * for the rest of the driven scenario, so advancing the game runs the
     * real AI against the posed ball while the left paddle and the ball stay
     * under the caller's control. Solo only; `false` is the default, and
     * `reset()` clears it.
     */
    setAiControl(enabled) {
      game.takeControl();
      game.driver.ai = Boolean(enabled);
    },

    /**
     * The obstacles posed by setting the obstacle clock to `t` and holding
     * them there. `t = 0` is upright at the base centers; a larger `t` sways
     * and rotates them exactly as normal play would at that moment
     * (src/obstacles.ts). It is a control operation, so it takes the paddles —
     * and while the driver's hold lasts, obstacle A leaves the clock alone
     * rather than winding it with the frame (src/scenery.ts), which is what
     * "holding them there" is. The actors are reposed at once, so the pose is
     * live from this call: the next advanced frame's flight resolves against
     * it, and a snapshot reads it back. A match's pose alone: like every
     * match pose, it is held across a pending `startMatch` transition and
     * dropped on the menus. `reset()` returns to normal, moving obstacles.
     */
    setObstacleClock(t) {
      game.takeControl();
      game.poseMatch((state) => {
        state.obstacleClock = t;
        for (const obstacle of obstaclesOf(state.world)) obstacle.poseAt(t);
      });
    },
  };
}
