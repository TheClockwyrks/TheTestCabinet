// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` — which
// makes a duration a frame count and the arithmetic asserted here the arithmetic
// specs/ names. What is read back is the game's own state, the engine's events,
// and the pixels the render produced.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BALL_R,
  COLOR,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_MAX_ANGLE,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import { createDebugApi, type CaromDebugApi } from "./debug";
import { game, type CaromState } from "./game";

// ---- The harness --------------------------------------------------------

const FRAME_MS = 1000 / 60;

/** One frame at 60 Hz, as a count for a duration in seconds. */
function frames(seconds: number): number {
  return Math.ceil(seconds * 60);
}

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

interface CuePlay {
  cue: string;
  t: number;
  gain: number;
}

interface Harness {
  readonly engine: Engine<CaromState>;
  readonly state: CaromState;
  readonly debug: CaromDebugApi;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
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

function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

function toDevice(view: Viewport, x: number, y: number): [number, number] {
  return [
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
  ];
}

async function createHarness(clock?: Clock): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => recorded,
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
  const engine = createEngine<CaromState>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: COLOR.bg,
    layout: LAYOUT,
    clock: clock ?? new ConstantClock(FRAME_MS),
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

  const state = await engine.initialize();
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  return {
    engine,
    state,
    debug: createDebugApi(state),
    ctx,
    calls,
    cues,
    assetFailures,
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

/** Take the match to a live rally with the ball posed exactly as asked. */
async function rally(
  h: Harness,
  mode: "solo" | "versus",
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): Promise<void> {
  h.debug.startMatch(mode);
  h.debug.serve();
  await h.engine.advance(1); // the launch, through the build's own serve
  h.debug.setBall(0, ball);
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every field of the state present", () => {
    const { state } = harness;
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.holdTimer).toBe(0);
    expect(state.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
    });
    expect(state.trail).toEqual([]);
    expect(state.driver).toEqual({
      paddles: false,
      ai: false,
      vy: { left: 0, right: 0 },
    });
  });

  it("loads no assets, so nothing can fail to arrive", async () => {
    await harness.engine.advance(10);
    expect(harness.assetFailures).toEqual([]);
  });

  it("runs frames off the clock it was given", async () => {
    await harness.engine.advance(30);
    expect(harness.engine.frame().count).toBe(30);
    expect(harness.engine.frame().timeMs).toBeCloseTo(500, 6);
    expect(harness.state.simTime).toBeCloseTo(0.5, 9);
  });
});

describe("the action registration", () => {
  /** An engine over a throwaway canvas, built with whatever layout is named. */
  function engineWithLayout(layout?: string): Engine<CaromState> {
    const canvas = createCanvas(FIELD_W, FIELD_H);
    const ctx = canvas.getContext("2d");
    const element = Object.assign(canvas, {
      style: {} as CSSStyleDeclaration,
      getContext: () => ctx,
    }) as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    return createEngine<CaromState>({
      canvas: element,
      width: FIELD_W,
      height: FIELD_H,
      game,
      layout,
      clock: new ConstantClock(FRAME_MS),
      surface: {
        cssWidth: () => FIELD_W,
        cssHeight: () => FIELD_H,
        dpr: () => 1,
        events: () => events,
      },
    });
  }

  it("refuses to start without the layout it registers against", async () => {
    const engine = engineWithLayout();
    await expect(engine.initialize()).rejects.toThrow(LAYOUT);
    engine.destroy();
  });

  it("refuses a layout whose vocabulary is not Carom's", async () => {
    const engine = engineWithLayout("single-vertical");
    await expect(engine.initialize()).rejects.toThrow(/single-vertical/);
    engine.destroy();
  });
});

// ---- Menus --------------------------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.holdTimer).toBeCloseTo(HOLD_TIME - 1 / 60, 9);
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("starts a Versus match from the second item", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Space");
    await harness.engine.advance(1);
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.screen).toBe("countdown");
  });

  it("opens and leaves the how-to-play screen", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("consumes a press exactly once", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(10);
    expect(harness.state.menuIndex).toBe(1);
  });
});

// ---- Controls -----------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );

    harness.release("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("drives player one from either slider in Solo", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("ArrowDown");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("stands still when opposite sliders are held in Solo", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(30);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("ArrowDown");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });
});

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", async () => {
    harness.debug.startMatch("versus");
    await harness.engine.advance(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.debug.snapshot().ball.held).toBe(true);

    await harness.engine.advance(2);
    expect(harness.state.screen).toBe("playing");
    expect(harness.debug.snapshot().ball.held).toBe(false);
  });

  it("sends the first serve of a match toward player one", async () => {
    harness.debug.startMatch("versus");
    await harness.engine.advance(frames(HOLD_TIME) + 1);
    const { ball } = harness.debug.snapshot();
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("keeps the serve within 30deg of horizontal, and never flat", async () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    await harness.engine.advance(1);
    const { ball } = harness.debug.snapshot();
    expect(Math.abs(ball.vy)).toBeGreaterThan(0);
    // The deviation from horizontal, whichever way the serve is travelling.
    expect(Math.abs(Math.atan2(ball.vy, Math.abs(ball.vx)))).toBeLessThan(
      SERVE_MAX_ANGLE,
    );
  });

  it("replays the same serve from the same seed", async () => {
    const other = await createHarness();
    try {
      for (const h of [harness, other]) {
        h.debug.reset({ seed: 4242 });
        h.debug.startMatch("versus");
        h.debug.serve();
        await h.engine.advance(1);
      }
      expect(other.debug.snapshot().ball.vy).toBe(
        harness.debug.snapshot().ball.vy,
      );
    } finally {
      other.dispose();
    }
  });
});

// ---- Physics, through the engine ----------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 200 });
    harness.cues.length = 0;

    await harness.engine.advance(6);

    expect(played(harness)).toEqual([CUES.paddleHit]);
    const { ball } = harness.debug.snapshot();
    expect(ball.vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 px/s when it struck.
    expect(ball.spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball.spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", async () => {
    await rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.wallBounce]);
    expect(harness.debug.snapshot().ball.vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.obstacleBounce]);
    expect(harness.debug.snapshot().ball.vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(60);
    const slow = harness.state.trail.length;

    const fast = await createHarness(new ConstantClock(1000 / 240));
    try {
      await rally(fast, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
      await fast.engine.advance(240);
      expect(fast.state.trail.length).toBeGreaterThan(slow);
    } finally {
      fast.dispose();
    }
  });

  it("reaches the same place however the second was divided into frames", async () => {
    const fast = await createHarness(new ConstantClock(1000 / 240));
    try {
      const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 120, spin: 300 };
      await rally(harness, "versus", pose);
      await rally(fast, "versus", pose);

      await harness.engine.advance(30); // 0.5 s at 60 Hz
      await fast.engine.advance(120); // 0.5 s at 240 Hz

      const slowBall = harness.debug.snapshot().ball;
      const fastBall = fast.debug.snapshot().ball;
      // A curving path is integrated, so "the same place" is the same place to
      // within the sub-step resolution rather than bit for bit.
      const drift = Math.hypot(
        fastBall.x - slowBall.x,
        fastBall.y - slowBall.y,
      );
      expect(drift).toBeLessThan(1);
      expect(fastBall.spin).toBeCloseTo(slowBall.spin, 6);
      expect(fastBall.speed).toBeCloseTo(slowBall.speed, 3);
    } finally {
      fast.dispose();
    }
  });
});

// ---- Scoring and the match ----------------------------------------------

describe("scoring", () => {
  it("gives the point to the far side and re-serves toward the receiver", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(4);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(played(harness)).toEqual([CUES.score]);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.receiver).toBe("right");

    await harness.engine.advance(frames(HOLD_TIME) + 1);
    expect(harness.debug.snapshot().ball.vx).toBeGreaterThan(0);
  });

  it("gives the point to player two when the ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    await harness.engine.advance(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
    expect(harness.state.receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);

    await harness.engine.advance(4);

    expect(harness.state.score.p1).toBe(WIN_SCORE);
    expect(harness.state.winner).toBe("left");
    expect(harness.state.screen).toBe("matchover");
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 1);

    await harness.engine.advance(4);

    expect(harness.state.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 1 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.screen).toBe("countdown");
  });

  it("offers a rematch from the match-over screen", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    await harness.engine.advance(4);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
  });
});

// ---- Pause and mute -----------------------------------------------------

describe("pause", () => {
  it("freezes the field and resumes where it left off", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(6);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    const frozen = harness.debug.snapshot();
    await harness.engine.advance(60);
    expect(harness.debug.snapshot().ball.x).toBe(frozen.ball.x);

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("quits to the title from the pause menu", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("title");
  });
});

describe("mute", () => {
  it("toggles the engine's mute bit from any screen and mirrors it", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.state.muted).toBe(true);

    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.state.muted).toBe(false);
  });

  it("keeps playing cues silently while muted", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    await rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.wallBounce]);
    expect(harness.cues[0].gain).toBe(0);
  });
});

// ---- The debug surface --------------------------------------------------

describe("window.__carom", () => {
  it("holds the paddles once a control operation has taken them", async () => {
    harness.debug.startMatch("versus");
    harness.debug.setPaddle("left", { vy: 300 });
    expect(harness.state.driver.paddles).toBe(true);

    harness.hold("KeyW"); // ignored: the driver has the paddles
    await harness.engine.advance(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
  });

  it("hands the paddles back on reset", async () => {
    harness.debug.startMatch("versus");
    harness.debug.setPaddle("left", { vy: 300 });
    harness.debug.reset();
    expect(harness.state.driver.paddles).toBe(false);
    expect(harness.state.screen).toBe("title");

    harness.tap("Enter");
    await harness.engine.advance(1);
    harness.hold("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("runs the real AI against a posed shot when handed its paddle back", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddle("right", { cy: 600, vy: 0 });
    harness.debug.setAiControl(true);

    await harness.engine.advance(30);

    const { paddles } = harness.debug.snapshot();
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // still the driver's
  });

  it("refuses a ball index this variant does not have", () => {
    expect(() => harness.debug.setBall(1, { x: 0 })).toThrow(RangeError);
  });
});

// ---- Drawing ------------------------------------------------------------

describe("rendering", () => {
  it("fills each paddle in its own color", async () => {
    harness.debug.startMatch("versus");
    await harness.engine.advance(1);

    expect(harness.pixel(P1_X0 + PADDLE_W / 2, FIELD_CY)).toEqual([
      58, 231, 196, 255,
    ]);
    expect(harness.pixel(FIELD_W - P1_X0 - PADDLE_W / 2, FIELD_CY)).toEqual([
      255, 92, 138, 255,
    ]);
  });

  it("draws the ball as one arc at its own position", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].slice(0, 3)).toEqual([400, 300, BALL_R]);
    expect(harness.pixel(400, 300)).toEqual([242, 245, 247, 255]);
  });

  it("draws in logical coordinates whatever size the surface is", async () => {
    harness.debug.startMatch("versus");
    await harness.engine.advance(1);
    const view = harness.engine.viewport();
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBe(1);
  });

  it("changes nothing about the state", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    await harness.engine.advance(1);
    const before = JSON.stringify(harness.debug.snapshot());
    game.render(harness.state, {
      ctx: harness.ctx as unknown as CanvasRenderingContext2D,
      frame: () => harness.engine.frame(),
      viewport: () => harness.engine.viewport(),
    });
    expect(JSON.stringify(harness.debug.snapshot())).toBe(before);
  });
});
