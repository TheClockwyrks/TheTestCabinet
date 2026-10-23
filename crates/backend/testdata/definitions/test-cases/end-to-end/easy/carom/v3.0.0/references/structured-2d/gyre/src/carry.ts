// Carom — the state an incoming world is dressed from.
//
// Carom's six screens are split across two levels (`src/state.ts`), and moving
// between the groups is a LEVEL TRANSITION: the engine tears the world down and
// builds the incoming one fresh, so every figure on the game state and every
// body on the field is rebuilt with it (`engine/worlds.md`). But every way of
// crossing that line has its own rules about what survives —
//
//   * `setScreen` changes the screen alone: it "leaves the scores, the world,
//     and the menu indices as they are" (specs/instrumentation.md), even when
//     the screen it names is hosted by the other level.
//   * Starting a match zeroes the scores, the winner, the receiver, the
//     paddles, the ball, and the obstacle clock, and keeps everything else
//     (specs/ui.md).
//   * Returning to the title restores every declared field to its title value
//     except the five that are kept, and sets `menuIndex` from `titleIndex`.
//   * `reset` restores all of it.
//
// so what crosses is not fixed by the transition but by the act that requested
// it. A `CaromCarry` is that act's answer: the whole declared world-scoped
// state as plain data, held on the game instance — the one framework object
// that outlives a transition — for exactly as long as the transition is in
// flight, and written onto the new world by `CaromGame.worldOpened`.
//
// The four acts differ only in which carry they build, which is why each is one
// short function here rather than a special case somewhere in the transition.

import type { World } from "@clockwyrks/structured-2d";
import { FIELD_CX, FIELD_CY, HOLD_TIME, OBSTACLE_CENTERS } from "./constants";
import {
  ballOf,
  clearField,
  obstaclesOf,
  paddleOf,
  placeBall,
  placeObstacle,
} from "./field";
import { drawServeSign } from "./random";
import type { Side } from "./sim";
import type { CaromState, ResumeScreen, Screen } from "./state";
import type { TrailSample } from "./trail";

/** One paddle's declared figures, as plain data. */
export interface PaddleData {
  cy: number;
  vy: number;
  driven: boolean;
  drivenVy: number;
}

/** The ball's declared figures, as plain data. `null` means no ball. */
export interface BallData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  held: boolean;
  holdTimer: number;
  serveSign: 1 | -1;
  trail: readonly TrailSample[];
}

/** The whole world-scoped state, as plain data. */
export interface CaromCarry {
  screen: Screen;
  menuIndex: number;
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  winner: Side | null;
  receiver: Side;
  ai: { tracking: boolean; movement: boolean };
  obstacleClock: number;
  obstacleClockRunning: boolean;
  paddles: { left: PaddleData; right: PaddleData };
  ball: BallData | null;
  /** The indices of the obstacles on the field, in `OBSTACLE_CENTERS` order. */
  obstacles: readonly number[];
}

/** A paddle at rest in the middle of its side, under its own player. */
function centeredPaddle(): PaddleData {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/** The ball as `spawnBall` places it: home, held, with a full hold. */
export function parkedBallData(): BallData {
  return {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: 0,
    vy: 0,
    spin: 0,
    held: true,
    holdTimer: HOLD_TIME,
    serveSign: drawServeSign(),
    trail: [],
  };
}

/** Both obstacles, in `OBSTACLE_CENTERS` order. */
function allObstacles(): readonly number[] {
  return OBSTACLE_CENTERS.map((_, index) => index);
}

/**
 * The title-screen state specs/state.md tabulates, with `menuIndex` given —
 * `0` for a `reset`, and the remembered `titleIndex` for every return to the
 * title (specs/ui.md).
 */
export function titleCarry(menuIndex: number): CaromCarry {
  return {
    screen: "title",
    menuIndex,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    ai: { tracking: true, movement: true },
    obstacleClock: 0,
    obstacleClockRunning: true,
    paddles: { left: centeredPaddle(), right: centeredPaddle() },
    ball: parkedBallData(),
    obstacles: allObstacles(),
  };
}

/**
 * The live state, read off the open world — what `setScreen` carries when the
 * screen it names is hosted by the other level, so a screen change is a screen
 * change and nothing else.
 */
export function captureCarry(world: World, screen: Screen): CaromCarry {
  const state = world.state as CaromState;
  const ball = ballOf(world);
  return {
    screen,
    menuIndex: state.menuIndex,
    resumeScreen: state.resumeScreen,
    score: { p1: state.score.p1, p2: state.score.p2 },
    winner: state.winner,
    receiver: state.receiver,
    ai: { tracking: state.ai.tracking, movement: state.ai.movement },
    obstacleClock: state.obstacleClock,
    obstacleClockRunning: state.obstacleClockRunning,
    paddles: {
      left: capturePaddle(world, "left"),
      right: capturePaddle(world, "right"),
    },
    ball:
      ball === null
        ? null
        : {
            x: ball.transform.x,
            y: ball.transform.y,
            vx: ball.vx,
            vy: ball.vy,
            spin: ball.spin,
            held: ball.held,
            holdTimer: ball.holdTimer,
            serveSign: ball.serveSign,
            trail: ball.trail.slice(),
          },
    obstacles: obstaclesOf(world).map((obstacle) => obstacle.index),
  };
}

function capturePaddle(world: World, side: Side): PaddleData {
  const paddle = paddleOf(world, side);
  if (paddle === null) return centeredPaddle();
  return {
    cy: paddle.transform.y,
    vy: paddle.vy,
    driven: paddle.driven,
    drivenVy: paddle.drivenVy,
  };
}

/**
 * Everything specs/ui.md's "Starting a match" fixes, over the live state:
 * the countdown, a clean score, a first serve toward player one, both paddles
 * centered and still, a full hold at the ball's home point, and the obstacle
 * clock back at zero and running. The debug driver's hold on each paddle, the
 * AI's faculties, and which obstacles are on the field are not on that list,
 * so they carry across unchanged.
 */
export function matchStartCarry(world: World): CaromCarry {
  const live = captureCarry(world, "countdown");
  return {
    ...live,
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    obstacleClock: 0,
    obstacleClockRunning: true,
    paddles: {
      left: { ...live.paddles.left, cy: FIELD_CY, vy: 0 },
      right: { ...live.paddles.right, cy: FIELD_CY, vy: 0 },
    },
    ball: parkedBallData(),
  };
}

/**
 * Write a carry onto a world: the game state's figures, both paddles, and the
 * bodies on the field, placed exactly as `spawnBall` and `spawnObstacle` place
 * them.
 */
export function applyCarry(world: World, carry: CaromCarry): void {
  const state = world.state as CaromState;
  state.screen = carry.screen;
  state.menuIndex = carry.menuIndex;
  state.resumeScreen = carry.resumeScreen;
  state.score = { p1: carry.score.p1, p2: carry.score.p2 };
  state.winner = carry.winner;
  state.receiver = carry.receiver;
  state.ai = { tracking: carry.ai.tracking, movement: carry.ai.movement };
  state.obstacleClock = carry.obstacleClock;
  state.obstacleClockRunning = carry.obstacleClockRunning;
  state.pressedItem = null;

  for (const side of ["left", "right"] as const) {
    const paddle = paddleOf(world, side);
    if (paddle === null) continue;
    const data = carry.paddles[side];
    paddle.transform.y = data.cy;
    paddle.vy = data.vy;
    paddle.driven = data.driven;
    paddle.drivenVy = data.drivenVy;
  }

  // The field is emptied and rebuilt rather than reconciled, so the bodies land
  // in the order the simulation needs: the obstacles, then the ball last.
  clearField(world);
  for (const index of carry.obstacles) {
    placeObstacle(world, index, carry.obstacleClock);
  }
  const data = carry.ball;
  if (data === null) return;
  const ball = placeBall(world);
  ball.transform.x = data.x;
  ball.transform.y = data.y;
  ball.vx = data.vx;
  ball.vy = data.vy;
  ball.spin = data.spin;
  ball.held = data.held;
  ball.holdTimer = data.holdTimer;
  ball.serveSign = data.serveSign;
  ball.trail = data.trail.slice();
}
