// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock` — which makes a duration a frame count and the arithmetic
// asserted here the arithmetic specs/ names. What is read back is the engine's
// own object model — the world, its tagged actors, its game state — the debug
// surface the game instance returned from `initialize`, the engine's events,
// and the pixels the pipeline produced.
//
// The surface is read off `engine.debug`, never built here, so these checks
// hold the same seam a scenario driven from outside holds: a pose is a method
// call that arranges the live world, a level transition lands on the next
// advanced frame, and a reading is `engine.debug.snapshot()`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  BALL_COLLIDE_DIST,
  BALL_HOMES,
  BALL_R,
  CUES,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  LEVELS,
  OBSTACLES,
  P1_X1,
  PADDLE_SPEED,
  SERVE_SPEED,
  SPEED_MULT,
  SPIN_FROM_PADDLE,
  TAGS,
  TRAIL_TIME,
  WIN_SCORE,
} from "./constants";
import { Ball, ballsOf } from "./ball";
import type { BallSnapshot, CaromDebug, CaromSnapshot } from "./debug";
import { BACKGROUND, game } from "./game";
import { Paddle } from "./paddle";
import { MatchState, TitleState } from "./state";
import { COLOR } from "./theme";

// ---- The harness --------------------------------------------------------

const FRAME_MS = 1000 / 60;

/** Frames at 60 Hz covering a duration in seconds. */
function frames(seconds: number): number {
  return Math.ceil(seconds * 60);
}

interface CuePlay {
  cue: string;
  t: number;
  gain: number;
}

interface Harness {
  readonly engine: Engine<CaromDebug>;
  readonly debug: CaromDebug;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
  snapshot(): CaromSnapshot;
  matchState(): MatchState;
  titleState(): TitleState;
  balls(): Ball[];
  ball(index: number): Ball;
  paddle(side: "left" | "right"): Paddle;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function toDevice(view: Viewport, x: number, y: number): [number, number] {
  return [
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
  ];
}

function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

interface HarnessOptions {
  clock?: Clock;
  /** Left out, the engine is created without a layout, as a broken page would. */
  layout?: string | null;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const layout = options.layout === undefined ? LAYOUT : options.layout;
  const engine = createEngine({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    ...(layout === null ? {} : { layout }),
    clock: options.clock ?? new ConstantClock(FRAME_MS),
    surface,
  });

  // Subscribed before any game code runs, so a failure during the game's own
  // initialization is visible rather than showing up later as wrong pixels.
  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", (play) => cues.push(play));

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  return {
    engine,
    // Read off the engine rather than built here: `initialize` returned the
    // surface, the engine holds it, and reaching it this way is what makes
    // that return load-bearing.
    debug: engine.debug,
    ctx,
    cues,
    assetFailures,
    snapshot: () => engine.debug.snapshot(),
    matchState: () => {
      const state = engine.world.state;
      if (!(state instanceof MatchState)) throw new Error("no match is open");
      return state;
    },
    titleState: () => {
      const state = engine.world.state;
      if (!(state instanceof TitleState)) throw new Error("no title is open");
      return state;
    },
    balls: () => ballsOf(engine.world),
    ball: (index) => {
      const found = ballsOf(engine.world)[index];
      if (found === undefined) throw new Error(`no tagged ball ${index}`);
      return found;
    },
    paddle: (side) => {
      const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
      const found = engine.world.byTag(tag)[0];
      if (!(found instanceof Paddle))
        throw new Error(`no tagged ${side} paddle`);
      return found;
    },
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    pixel: (x, y) => {
      const [dx, dy] = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(dx, dy, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => engine.destroy(),
  };
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/**
 * Take the match to its opening countdown. `startMatch` opens the match level
 * as the menu would; the next advanced frame performs the transition.
 */
async function countdown(h: Harness, mode: "solo" | "versus"): Promise<void> {
  h.debug.startMatch(mode);
  await h.engine.advance(1);
}

/**
 * Where a scenario parks the two balls it is not driving.
 *
 * Motionless, clear of both paddles, both obstacles, and each other, and well
 * inside the field so neither drifts over a goal edge and scores mid-scenario.
 */
const IDLE = [
  { x: 150, y: 60, vx: 0, vy: 0, spin: 0 },
  { x: 1130, y: 60, vx: 0, vy: 0, spin: 0 },
];

/**
 * Take the match to a live rally with ball 0 posed exactly as asked, and the
 * other two parked out of the way so the scenario is about the one ball.
 */
async function rally(
  h: Harness,
  mode: "solo" | "versus",
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): Promise<void> {
  h.debug.startMatch(mode);
  h.debug.serve();
  // Frame one performs the transition and lands the expired holds; frame two
  // runs the build's own launches and leaves the rally live.
  await h.engine.advance(2);
  h.debug.setBall(0, ball);
  h.debug.setBall(1, IDLE[0]);
  h.debug.setBall(2, IDLE[1]);
}

/** The one ball a `rally` scenario is driving. */
function driven(h: Harness): BallSnapshot {
  return h.snapshot().balls[0];
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens the title level with the court posed behind the menu", () => {
    const { engine } = harness;
    expect(engine.world.level).toBe(LEVELS.title);
    expect(harness.titleState().screen).toBe("title");
    expect(harness.titleState().menuIndex).toBe(0);

    // The tagged field bodies are in place (specs/state.md), the balls in
    // play order.
    expect(engine.world.byTag(TAGS.paddleLeft)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.paddleRight)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.ball)).toHaveLength(BALL_HOMES.length);
    expect(engine.world.byTag(TAGS.obstacle)).toHaveLength(OBSTACLES.length);

    const snapshot = harness.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    expect(snapshot.muted).toBe(false);
    expect(snapshot.paddles.left).toEqual({ cy: FIELD_CY, vy: 0 });
    expect(snapshot.paddles.right).toEqual({ cy: FIELD_CY, vy: 0 });
    expect(snapshot.balls).toEqual(
      BALL_HOMES.map((home) => ({
        x: home.x,
        y: home.y,
        vx: 0,
        vy: 0,
        speed: 0,
        spin: 0,
        held: false,
      })),
    );
  });

  it("loads no assets, so nothing can fail to arrive", async () => {
    await harness.engine.advance(30);
    expect(harness.assetFailures).toEqual([]);
  });

  it("runs frames off the clock it was given", async () => {
    await harness.engine.advance(60);
    expect(harness.engine.frame().count).toBe(60);
    expect(harness.engine.frame().timeMs).toBeCloseTo(1000, 6);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 6);
  });

  it("refuses to start without the layout it registers against", async () => {
    const h = await createHarness({ layout: null }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(h).toBeInstanceOf(Error);
    expect(String(h)).toContain(LAYOUT);
  });
});

// ---- The menus ----------------------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.match);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    // One human seat and the AI's: the bot is a controller like any other.
    expect(harness.engine.world.players()).toHaveLength(1);
    expect(harness.engine.world.controllers()).toHaveLength(2);
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.titleState().menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.titleState().menuIndex).toBe(0);

    // Wraps both ways.
    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.titleState().menuIndex).toBe(2);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.titleState().menuIndex).toBe(0);
  });

  it("starts a Versus match from the second item", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Space");
    await harness.engine.advance(1);

    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().screen).toBe("countdown");
    // Two human seats, one paddle each.
    expect(harness.engine.world.players()).toHaveLength(2);
  });

  it("opens and leaves the how-to-play screen", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.titleState().menuIndex).toBe(0);
  });
});

// ---- The paddles --------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    await countdown(harness, "versus");
    // The menu confirm took the match through the debug surface, so hand the
    // paddles back to the keyboard first.
    harness.matchState().game.releaseControl();

    // 0.2 s: far enough to measure, short of the clamp at PADDLE_MAX_CY.
    harness.hold("KeyS");
    await harness.engine.advance(12);
    harness.release("KeyS");

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("drives player one from either slider in Solo", async () => {
    await countdown(harness, "solo");
    harness.matchState().game.releaseControl();

    harness.hold("ArrowDown");
    await harness.engine.advance(12);
    harness.release("ArrowDown");

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("stands still when opposite sliders are held in Solo", async () => {
    await countdown(harness, "solo");
    harness.matchState().game.releaseControl();

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    await countdown(harness, "versus");
    harness.matchState().game.releaseControl();

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY - PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
  });
});

// ---- Launching ----------------------------------------------------------

describe("launching", () => {
  it("holds all three for HOLD_TIME and then launches them together", async () => {
    await countdown(harness, "versus");
    expect(harness.snapshot().balls.map((b) => b.held)).toEqual([
      true,
      true,
      true,
    ]);

    // Just short of the hold: still parked.
    await harness.engine.advance(frames(HOLD_TIME) - 2);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().balls.every((b) => b.speed === 0)).toBe(true);

    await harness.engine.advance(3);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.balls.map((b) => b.held)).toEqual([false, false, false]);
    expect(snapshot.balls.every((b) => b.speed > 0)).toBe(true);
  });

  it("starts each ball on its own home point", async () => {
    await countdown(harness, "versus");
    harness.snapshot().balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
    });
  });

  it("launches every ball at exactly SERVE_SPEED", async () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    await harness.engine.advance(2);

    for (const ball of harness.snapshot().balls) {
      // Read on the launch frame, before flight has curved or slowed anything.
      expect(ball.speed).toBeCloseTo(SERVE_SPEED, 3);
    }
  });

  it("draws a fresh angle for every launch, over the whole circle", async () => {
    const quadrants = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      harness.debug.reset({ seed });
      await harness.engine.advance(1);
      harness.debug.startMatch("versus");
      harness.debug.serve();
      await harness.engine.advance(2);
      for (const ball of harness.snapshot().balls) {
        const angle = Math.atan2(ball.vy, ball.vx) + Math.PI;
        quadrants.add(Math.floor(angle / (Math.PI / 2)) % 4);
      }
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("replays the same three launches from the same seed", async () => {
    const first = await launchedBalls(4242);
    const second = await launchedBalls(4242);
    const other = await launchedBalls(7);
    expect(first).toEqual(second);
    // The seed genuinely feeds the draws: another seed launches differently.
    expect(first).not.toEqual(other);
  });

  async function launchedBalls(seed: number): Promise<BallSnapshot[]> {
    const h = await createHarness();
    try {
      h.debug.reset({ seed });
      h.debug.startMatch("versus");
      h.debug.serve();
      await h.engine.advance(2);
      return h.snapshot().balls;
    } finally {
      h.dispose();
    }
  }
});

// ---- The rally ----------------------------------------------------------

describe("the rally", () => {
  it("returns a ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", {
      x: P1_X1 + BALL_R + 40,
      y: FIELD_CY,
      vx: -400,
      vy: 0,
    });
    harness.cues.length = 0;
    await harness.engine.advance(10);

    const ball = driven(harness);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.speed).toBeCloseTo(400 * SPEED_MULT, 3);
    expect(played(harness)).toContain(CUES.paddleHit);
  });

  it("imparts spin from a moving paddle and curves the flight", async () => {
    await rally(harness, "versus", {
      x: P1_X1 + BALL_R + 40,
      y: FIELD_CY,
      vx: -400,
      vy: 0,
    });
    // The paddle swings downward as it strikes; the posed velocity persists
    // because the driver holds it (specs/instrumentation.md).
    harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 300 });
    await harness.engine.advance(10);

    const ball = driven(harness);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.spin).toBeGreaterThan(0);
    expect(ball.spin).toBeLessThanOrEqual(300 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", async () => {
    await rally(harness, "versus", { x: 400, y: 40, vx: 60, vy: -600 });
    harness.cues.length = 0;
    await harness.engine.advance(10);

    const ball = driven(harness);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.speed).toBeCloseTo(Math.hypot(60, 600), 3);
    expect(played(harness)).toContain(CUES.wallBounce);
  });

  it("bounces off an obstacle and plays the obstacle cue", async () => {
    const [obstacle] = OBSTACLES;
    await rally(harness, "versus", {
      x: obstacle.x0 - BALL_R - 30,
      y: (obstacle.y0 + obstacle.y1) / 2,
      vx: 300,
      vy: 0,
    });
    harness.cues.length = 0;
    await harness.engine.advance(15);

    const ball = driven(harness);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(300, 3);
    expect(played(harness)).toContain(CUES.obstacleBounce);
  });

  it("records a trail per ball that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(40);

    const trail = harness.ball(0).trail;
    expect(trail.length).toBeGreaterThan(2);
    const now = harness.engine.frame().timeMs / 1000;
    for (const sample of trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME + 1e-9);
    }
    // The parked balls' own trails collapse to nothing within the window.
    expect(
      harness.ball(1).trail.every((sample) => sample.x === IDLE[0].x),
    ).toBe(true);
  });

  it("reaches the same place however the second was divided into frames", async () => {
    const even = await flightUnder(new ConstantClock(1000 / 60));
    const uneven = await flightUnder(new SequenceClock([8, 33, 12, 21]));
    expect(Math.hypot(even.x - uneven.x, even.y - uneven.y)).toBeLessThan(1.5);
  });

  async function flightUnder(clock: Clock): Promise<{ x: number; y: number }> {
    const h = await createHarness({ clock });
    try {
      h.debug.reset({ seed: 5 });
      await rally(h, "versus", {
        x: 400,
        y: 200,
        vx: 320,
        vy: 90,
        spin: 250,
      });
      // Drive to one simulated duration, not to a frame count.
      const until = h.engine.frame().timeMs + 500;
      while (h.engine.frame().timeMs < until) await h.engine.advance(1);
      const ball = h.snapshot().balls[0];
      // The two runs stop within a frame of the same simulated time; walk the
      // faster one's remainder off analytically for a fair comparison.
      const over = (h.engine.frame().timeMs - until) / 1000;
      return { x: ball.x - ball.vx * over, y: ball.y - ball.vy * over };
    } finally {
      h.dispose();
    }
  }
});

// ---- Scoring ------------------------------------------------------------

describe("scoring", () => {
  it("gives the point to player one and respawns only the crossed ball", async () => {
    await rally(harness, "versus", {
      x: FIELD_W - 60,
      y: 120,
      vx: 700,
      vy: 0,
    });
    harness.cues.length = 0;
    await harness.engine.advance(15);

    const snapshot = harness.snapshot();
    expect(snapshot.score).toEqual({ p1: 1, p2: 0 });
    // The field keeps running: only the crossed ball goes home for its own
    // hold, and the screen never leaves `playing`.
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.balls[0].held).toBe(true);
    expect(snapshot.balls[0].x).toBe(BALL_HOMES[0].x);
    expect(snapshot.balls[0].y).toBe(BALL_HOMES[0].y);
    expect(snapshot.balls[1].held).toBe(false);
    expect(snapshot.balls[2].held).toBe(false);
    expect(played(harness)).toContain(CUES.score);
  });

  it("gives the point to player two when a ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 60, y: 120, vx: -700, vy: 0 });
    await harness.engine.advance(15);
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 1 });
  });

  it("relaunches the scored ball after its own hold, mid-rally", async () => {
    await rally(harness, "versus", {
      x: FIELD_W - 60,
      y: 120,
      vx: 700,
      vy: 0,
    });
    await harness.engine.advance(15);
    expect(harness.snapshot().balls[0].held).toBe(true);

    await harness.engine.advance(frames(HOLD_TIME) + 2);
    const relaunched = harness.snapshot().balls[0];
    expect(relaunched.held).toBe(false);
    expect(relaunched.speed).toBeGreaterThan(0);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", {
      x: FIELD_W - 60,
      y: 120,
      vx: 700,
      vy: 0,
    });
    harness.debug.setScore(WIN_SCORE - 1, 0);
    await harness.engine.advance(15);

    const snapshot = harness.snapshot();
    expect(snapshot.score).toEqual({ p1: WIN_SCORE, p2: 0 });
    expect(snapshot.screen).toBe("matchover");
    expect(snapshot.winner).toBe("left");
    expect(harness.engine.world.state.phase).toBe("over");
    // Every ball is left where it is (specs/balls.md): the winning ball is
    // beyond the goal edge, not respawned.
    expect(snapshot.balls[0].x).toBeGreaterThan(FIELD_W);
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", {
      x: FIELD_W - 60,
      y: 120,
      vx: 700,
      vy: 0,
    });
    harness.debug.setScore(10, 10);
    await harness.engine.advance(15);

    const snapshot = harness.snapshot();
    expect(snapshot.score).toEqual({ p1: 11, p2: 10 });
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.winner).toBeNull();
  });

  it("offers a rematch from the match-over screen", async () => {
    await wonMatch(harness);
    harness.tap("Enter"); // PLAY AGAIN
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("versus");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    expect(snapshot.balls.map((b) => b.held)).toEqual([true, true, true]);
  });

  it("returns to the title from the match-over screen on Escape", async () => {
    await wonMatch(harness);
    harness.tap("Escape");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
    // Every match figure is back at its title-screen value, the mode's Solo.
    expect(harness.snapshot().mode).toBe("solo");
  });

  /** Drive a real match to its end: 11-0 through the right goal. */
  async function wonMatch(h: Harness): Promise<void> {
    await rally(h, "versus", { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 });
    h.debug.setScore(WIN_SCORE - 1, 0);
    await h.engine.advance(15);
    expect(h.snapshot().screen).toBe("matchover");
    // The menus read the keyboard; the driver's hold covers the paddles only.
  }
});

// ---- Pause --------------------------------------------------------------

describe("pause", () => {
  it("freezes the field and resumes where it left off", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(5);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");

    const frozen = harness.snapshot();
    await harness.engine.advance(30);
    const still = harness.snapshot();
    expect(still.balls).toEqual(frozen.balls);
    expect(still.paddles).toEqual(frozen.paddles);
    // The frame clock is the engine's and runs on (specs/instrumentation.md).
    expect(still.simTime).toBeGreaterThan(frozen.simTime);

    // Escape on a menu is `back`, which resumes.
    harness.tap("Escape");
    await harness.engine.advance(10);
    const resumed = harness.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.balls[0].x).not.toBe(frozen.balls[0].x);
  });

  it("quits to the title from the pause menu", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("KeyP");
    await harness.engine.advance(1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.matchState().menuIndex).toBe(2); // QUIT TO MENU
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("keeps every hold where the pause left it", async () => {
    await countdown(harness, "versus");
    await harness.engine.advance(6);
    const before = harness.balls().map((ball) => ball.holdTimer);

    harness.tap("Escape"); // a live match: Escape pauses
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    await harness.engine.advance(30);
    const during = harness.balls().map((ball) => ball.holdTimer);
    during.forEach((timer, index) => {
      expect(timer).toBeCloseTo(before[index], 6);
    });

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
  });
});

// ---- Mute ---------------------------------------------------------------

describe("mute", () => {
  it("toggles the engine's mute bit from any screen and mirrors it", async () => {
    expect(harness.snapshot().muted).toBe(false);
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.engine.world.audio.muted()).toBe(true);
    expect(harness.snapshot().muted).toBe(true);

    await countdown(harness, "versus");
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.snapshot().muted).toBe(false);
  });

  it("keeps playing cues silently while muted", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    await rally(harness, "versus", { x: 400, y: 40, vx: 60, vy: -600 });
    harness.cues.length = 0;
    await harness.engine.advance(10);

    const wall = harness.cues.filter((play) => play.cue === CUES.wallBounce);
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.every((play) => play.gain === 0)).toBe(true);
    // The mute bit survives into the match world: the bus is the engine's.
    expect(harness.snapshot().muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  it("lands poses made while the match is still opening", async () => {
    // The typical scenario (specs/instrumentation.md): startMatch, then the
    // poses, then a handful of frames — with no advance in between.
    harness.debug.startMatch("versus");
    harness.debug.setScore(2, 3);
    harness.debug.setPaddle("left", { cy: 200 });
    harness.debug.setBall(0, { x: 500, y: 300 });
    harness.debug.serve();
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.match);
    const snapshot = harness.snapshot();
    expect(snapshot.score).toEqual({ p1: 2, p2: 3 });
    expect(snapshot.paddles.left.cy).toBe(200);
    expect(snapshot.balls[0]).toMatchObject({ x: 500, y: 300, held: false });
    // `serve` spent the waiting balls' holds; the posed ball's was spent by
    // the pose itself.
    expect(harness.balls().map((ball) => ball.holdTimer)).toEqual([0, 0, 0]);

    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("leaves a flying ball alone when serve ends the waiting holds", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(15);
    // Score with ball 0 so it goes home for its own hold.
    harness.debug.setBall(0, { x: FIELD_W - 20, y: 120, vx: 700, vy: 0 });
    await harness.engine.advance(3);
    expect(harness.snapshot().balls[0].held).toBe(true);
    const inFlight = harness.snapshot().balls[1];

    harness.debug.serve();
    await harness.engine.advance(1);
    // The waiting ball launched; the flying one kept its motion.
    expect(harness.snapshot().balls[0].held).toBe(false);
    expect(harness.snapshot().balls[1].vx).toBeCloseTo(inFlight.vx, 6);
  });

  it("holds the paddles once a control operation has taken them", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 100, vy: 0 });
    harness.debug.setPaddle("left", { cy: 300, vy: 200 });

    // Input is ignored while the driver holds.
    harness.hold("KeyW");
    await harness.engine.advance(30);
    harness.release("KeyW");

    const { left } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(300 + 200 * 0.5, 3);
    expect(left.vy).toBeCloseTo(200, 6);
  });

  it("hands the paddles back on reset", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 100, vy: 0 });
    harness.debug.setPaddle("left", { cy: 300, vy: 200 });
    await harness.engine.advance(5);

    harness.debug.reset();
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    const title = harness.snapshot();
    expect(title.screen).toBe("title");
    expect(title.score).toEqual({ p1: 0, p2: 0 });
    expect(title.paddles.left).toEqual({ cy: FIELD_CY, vy: 0 });
    // Every ball back on its own home, parked and unheld.
    title.balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
      expect(ball.speed).toBe(0);
      expect(ball.held).toBe(false);
    });

    // The keyboard works again: the hold was released. The match is started
    // from the MENU this time, so no pose re-takes the paddles.
    harness.tap("Enter");
    await harness.engine.advance(1);
    harness.matchState();
    harness.hold("KeyS");
    await harness.engine.advance(12);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("does not reset the frame clock: simTime is the engine's", async () => {
    await harness.engine.advance(60);
    harness.debug.reset();
    await harness.engine.advance(1);
    expect(harness.snapshot().simTime).toBeGreaterThan(1);
  });

  it("runs the real AI against a posed shot when handed its paddle back", async () => {
    await rally(harness, "solo", { x: 900, y: 600, vx: 300, vy: 0 });
    harness.debug.setAiControl(true);
    await harness.engine.advance(20);

    const { right, left } = harness.snapshot().paddles;
    expect(right.cy).toBeGreaterThan(FIELD_CY + 60); // chasing the low ball
    expect(left.cy).toBeCloseTo(FIELD_CY, 3); // still the driver's, at rest
  });

  it("returns the AI paddle home and stops within AI_HOME_DEADZONE", async () => {
    await rally(harness, "solo", { x: 900, y: 650, vx: 300, vy: 0 });
    harness.debug.setAiControl(true);
    await harness.engine.advance(40);
    expect(harness.snapshot().paddles.right.cy).toBeGreaterThan(500);

    // The ball leaves; no other ball threatens; the AI eases home.
    harness.debug.setBall(0, { x: 400, y: 650, vx: -300, vy: 0 });
    await harness.engine.advance(120);
    const settled = harness.snapshot().paddles.right.cy;
    expect(Math.abs(settled - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  });

  it("refuses a ball index this variant does not have", async () => {
    await countdown(harness, "versus");
    expect(() => harness.debug.setBall(3, { x: 100 })).toThrow(RangeError);
    expect(() => harness.debug.setBall(-1, { x: 100 })).toThrow(RangeError);
    // Nothing was posed by the refusals.
    expect(harness.snapshot().balls.map((b) => b.held)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("changes nothing when snapshot is read repeatedly", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(5);
    const first = harness.snapshot();
    const second = harness.snapshot();
    expect(second).toEqual(first);
    expect(harness.engine.frame().count).toBe(harness.engine.frame().count);
  });
});

// ---- Three independent balls --------------------------------------------

describe("three independent balls", () => {
  it("keeps the other two running while one respawns", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setBall(1, { x: 300, y: 300, vx: 300, vy: 0 });

    await harness.engine.advance(4);

    // Ball 0 scored and went home; ball 1 never paused.
    const snapshot = harness.snapshot();
    expect(snapshot.balls[0].held).toBe(true);
    expect(snapshot.balls[1].held).toBe(false);
    expect(snapshot.balls[1].x).toBeGreaterThan(300);
  });

  it("runs each ball's hold on its own clock", async () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    await harness.engine.advance(2);
    // Send ball 0 home mid-rally by scoring with it; the others stay away.
    harness.debug.setBall(0, { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setBall(1, IDLE[0]);
    harness.debug.setBall(2, IDLE[1]);
    await harness.engine.advance(4);

    const holds = harness.balls().map((ball) => ball.holdTimer);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[1]).toBe(0);
    expect(holds[2]).toBe(0);
  });

  it("bounces two balls off each other without changing either's spin", async () => {
    await rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    harness.debug.setBall(1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });

    await harness.engine.advance(30);

    const [a, b] = harness.snapshot().balls;
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.spin).toBe(0);
    expect(b.spin).toBe(0);
  });

  it("plays the ball cue once for the pair, not once for each ball", async () => {
    await rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    harness.debug.setBall(1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(30);

    // A collision is one event between two balls (specs/ui.md), so the whole
    // of this scenario is one cue. Playing it from a loop over the balls
    // would sound the same contact twice, once for each side of it.
    expect(played(harness)).toEqual([CUES.ballBounce]);
  });

  it("bounces a moving ball off one waiting at its home point", async () => {
    harness.debug.startMatch("versus");
    // Ball 1 is still waiting on the field center; drive ball 0 into it.
    harness.debug.setBall(0, {
      x: BALL_HOMES[1].x - 120,
      y: BALL_HOMES[1].y,
      vx: 400,
      vy: 0,
    });
    await harness.engine.advance(30);

    const [moving, waiting] = harness.snapshot().balls;
    expect(moving.vx).toBeLessThan(0);
    expect(waiting.held).toBe(true);
    expect(waiting.x).toBe(BALL_HOMES[1].x);
    expect(waiting.y).toBe(BALL_HOMES[1].y);
  });

  it("never lets two balls occupy the same place", async () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    await harness.engine.advance(600);

    const balls = harness.snapshot().balls;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        if (balls[i].held || balls[j].held) continue;
        const gap = Math.hypot(
          balls[j].x - balls[i].x,
          balls[j].y - balls[i].y,
        );
        expect(gap).toBeGreaterThan(BALL_COLLIDE_DIST - 1);
      }
    }
  });

  it("defends the ball arriving at its goal soonest in Solo", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    // A second ball threatens the same goal, but from much further away.
    harness.debug.setBall(1, { x: 200, y: 620, vx: 400, vy: 0 });
    harness.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
    harness.debug.setAiControl(true);

    await harness.engine.advance(20);

    // It tracks the near ball at y 180, not the far one at y 620.
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });
});

// ---- Rendering ----------------------------------------------------------

describe("rendering", () => {
  it("fills each body in its own color at its own position", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(harness.pixel(P1_X1 - 8, snapshot.paddles.left.cy)).toEqual(
      rgba(COLOR.p1),
    );
    // Every ball is drawn where it is: the driven one and a parked one.
    expect(harness.pixel(400, 200)).toEqual(rgba(COLOR.ball));
    expect(harness.pixel(IDLE[0].x, IDLE[0].y)).toEqual(rgba(COLOR.ball));
    const [a] = OBSTACLES;
    expect(harness.pixel((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2)).toEqual(
      rgba(COLOR.obstacle),
    );
  });

  it("draws the letterboxed field over the background color", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    await harness.engine.advance(1);
    // An empty corner of the field is the cleared background.
    expect(harness.pixel(180, 620)).toEqual(rgba(BACKGROUND));
  });

  it("honors the renderer's wireframe switch", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    // Sit still past TRAIL_TIME first, so the posed ball's stale launch trail
    // collapses and the sampled pixel holds the ball's own body alone.
    await harness.engine.advance(frames(TRAIL_TIME) + 2);
    harness.engine.renderer.setMode("wireframe");
    await harness.engine.advance(1);

    expect(harness.engine.renderer.mode()).toBe("wireframe");
    // Outlines alone: the ball's interior is no longer filled.
    expect(harness.pixel(400, 200)).toEqual(rgba(BACKGROUND));
  });
});
