// Carom — the field's bodies, and the arrangement of them that outlives a
// level.
//
// Everything the world holds that specs/state.md calls state is reached from
// here: the two paddles, which are always present, and the balls and obstacles,
// which are PRESENCE state — `clearWorld` takes them off the field and
// `spawnBall` and `spawnObstacle` put them back (specs/instrumentation.md).
//
// Both are read back BY INDEX rather than by spawn order. A cleared field
// respawned one ball at a time arrives in whatever order the caller asked for,
// and play order is the ball's own `index`, so sorting on it is what keeps
// `snapshot().balls` and every index-taking operation talking about the same
// ball however the field was assembled.
//
// The `Arrangement` at the bottom is the whole of that field plus the screen
// figures around it, captured as plain data. It is what lets a screen pose
// that has to cross a LEVEL boundary — the title level hosts `title` and
// `howto`, the match level the other four — leave the scores, the world, and
// the menu indices exactly as it found them (specs/instrumentation.md): the
// outgoing world is captured as it stands, and the incoming one is posed back
// into it once the engine has built it.

import type { World } from "@clockwyrks/structured-2d";
import { Ball } from "./ball";
import {
  BALL_COUNT,
  BALL_HOMES,
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  TAGS,
} from "./constants";
import { Paddle } from "./paddle";
import { drawLaunchAngle } from "./random";
import { Obstacle } from "./scenery";
import type { Side } from "./sim";
import { stateOf, type ResumeScreen, type Screen } from "./state";
import type { TrailSample } from "./trail";

/* ---- Reading the field ---------------------------------------------------- */

/** The side's tagged paddle actor, in whichever level is open. */
export function paddleOf(world: World, side: Side): Paddle {
  const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
  const found = world.byTag(tag)[0];
  if (!(found instanceof Paddle)) {
    throw new Error(`Carom: no ${side} paddle carries the "${tag}" tag`);
  }
  return found;
}

/** Every ball on the field, in play order. */
export function ballsOf(world: World): Ball[] {
  const balls: Ball[] = [];
  for (const actor of world.byTag(TAGS.ball)) {
    if (!(actor instanceof Ball)) {
      throw new Error(`Carom: a non-ball actor carries the "${TAGS.ball}" tag`);
    }
    balls.push(actor);
  }
  return balls.sort((a, b) => a.index - b.index);
}

/** Ball `index`, or `null` when it is not on the field. */
export function ballAt(world: World, index: number): Ball | null {
  return ballsOf(world).find((ball) => ball.index === index) ?? null;
}

/** Every obstacle on the field, in the order of `OBSTACLE_CENTERS`. */
export function obstaclesOf(world: World): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const actor of world.byTag(TAGS.obstacle)) {
    if (!(actor instanceof Obstacle)) {
      throw new Error(
        `Carom: a non-obstacle actor carries the "${TAGS.obstacle}" tag`,
      );
    }
    obstacles.push(actor);
  }
  return obstacles.sort((a, b) => a.index - b.index);
}

/* ---- Changing what is on the field ---------------------------------------- */

/** Whether `index` names one of this variant's balls. */
export function isBallIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < BALL_COUNT;
}

/** Whether `index` names one of the field's obstacles. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/** Take every ball and every obstacle off the field. The paddles stay. */
export function clearField(world: World): void {
  for (const ball of ballsOf(world)) ball.destroy();
  for (const obstacle of obstaclesOf(world)) obstacle.destroy();
}

/**
 * Place ball `index` at its home point, held, with a full hold timer, zero
 * velocity, zero spin, and an empty trail. A ball already on the field is
 * returned to that same arrangement rather than duplicated.
 */
export function spawnBall(world: World, index: number, hold = HOLD_TIME): Ball {
  const existing = ballAt(world, index);
  if (existing !== null) {
    existing.park(hold);
    return existing;
  }
  const home = BALL_HOMES[index];
  return world.spawn(Ball, {
    transform: { x: home.x, y: home.y },
    tags: [TAGS.ball],
    configure: (ball: Ball) => {
      ball.index = index;
      ball.park(hold);
    },
  });
}

/** Place obstacle `index` at `OBSTACLE_CENTERS[index]`. */
export function spawnObstacle(world: World, index: number): Obstacle {
  const existing = obstaclesOf(world).find((o) => o.index === index);
  const centre = OBSTACLE_CENTERS[index];
  if (existing !== undefined) {
    existing.transform.x = centre.x;
    existing.transform.y = centre.y;
    return existing;
  }
  return world.spawn(Obstacle, {
    transform: { x: centre.x, y: centre.y },
    tags: [TAGS.obstacle],
    configure: (obstacle: Obstacle) => {
      obstacle.index = index;
    },
  });
}

/** Every ball and every obstacle, freshly placed: the field a match opens on. */
export function buildStandardField(world: World): void {
  clearField(world);
  for (let index = 0; index < BALL_COUNT; index += 1) {
    spawnBall(world, index);
  }
  for (let index = 0; index < OBSTACLE_CENTERS.length; index += 1) {
    spawnObstacle(world, index);
  }
}

/* ---- The arrangement that crosses a level --------------------------------- */

/** One ball's whole declared state, as plain data. */
export interface BallArrangement {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  held: boolean;
  holdTimer: number;
  launchAngle: number;
  trail: readonly TrailSample[];
}

/** One paddle's arrangement. Its driver's hold lives on the game instance. */
export interface PaddleArrangement {
  cy: number;
  vy: number;
}

/** Everything a world holds that specs/state.md declares, as plain data. */
export interface Arrangement {
  screen: Screen;
  menuIndex: number;
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  winner: Side | null;
  paddles: { left: PaddleArrangement; right: PaddleArrangement };
  balls: BallArrangement[];
  obstacles: number[];
}

/** The open world's arrangement, read off it as it stands. */
export function captureArrangement(world: World): Arrangement {
  const state = stateOf(world);
  const paddle = (side: Side): PaddleArrangement => {
    const actor = paddleOf(world, side);
    return { cy: actor.transform.y, vy: actor.vy };
  };
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    resumeScreen: state.resumeScreen,
    score: { ...state.score },
    winner: state.winner,
    paddles: { left: paddle("left"), right: paddle("right") },
    balls: ballsOf(world).map((ball) => ({
      index: ball.index,
      x: ball.transform.x,
      y: ball.transform.y,
      vx: ball.vx,
      vy: ball.vy,
      spin: ball.spin,
      held: ball.held,
      holdTimer: ball.holdTimer,
      launchAngle: ball.launchAngle,
      trail: ball.trail,
    })),
    obstacles: obstaclesOf(world).map((obstacle) => obstacle.index),
  };
}

/** Pose a world into `arrangement`, whichever level built it. */
export function applyArrangement(world: World, arrangement: Arrangement): void {
  const state = stateOf(world);
  state.screen = arrangement.screen;
  state.menuIndex = arrangement.menuIndex;
  state.resumeScreen = arrangement.resumeScreen;
  state.score = { ...arrangement.score };
  state.winner = arrangement.winner;

  for (const side of ["left", "right"] as const) {
    const actor = paddleOf(world, side);
    actor.transform.y = arrangement.paddles[side].cy;
    actor.vy = arrangement.paddles[side].vy;
  }

  clearField(world);
  for (const ball of arrangement.balls) {
    const actor = spawnBall(world, ball.index);
    actor.transform.x = ball.x;
    actor.transform.y = ball.y;
    actor.vx = ball.vx;
    actor.vy = ball.vy;
    actor.spin = ball.spin;
    actor.held = ball.held;
    actor.holdTimer = ball.holdTimer;
    actor.launchAngle = ball.launchAngle;
    actor.trail = ball.trail;
  }
  for (const index of arrangement.obstacles) spawnObstacle(world, index);
}

/**
 * The title screen's arrangement (specs/state.md, "The state at the title
 * screen"), with `menuIndex` the caller's: `0` for a reset, and the remembered
 * `titleIndex` for every path back from a match (specs/ui.md).
 */
export function titleArrangement(menuIndex: number): Arrangement {
  return {
    screen: "title",
    menuIndex,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: { left: { cy: FIELD_CY, vy: 0 }, right: { cy: FIELD_CY, vy: 0 } },
    balls: BALL_HOMES.map((home, index) => ({
      index,
      x: home.x,
      y: home.y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: drawLaunchAngle(),
      trail: [],
    })),
    obstacles: OBSTACLE_CENTERS.map((_centre, index) => index),
  };
}
