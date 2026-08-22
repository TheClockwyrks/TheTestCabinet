// Carom over its own runtime, in process.
//
// Every check here stands the real runtime up over an `@napi-rs/canvas` canvas
// and a `Surface` of its own, so the game runs with no browser and no document
// behind it, and steps it with `advance` — which makes a duration an exact number
// of frames of an exact length, and the arithmetic asserted below the arithmetic
// specs/ names. What is read back is the game's own state, the cues its update
// played, and the pixels its render produced.
//
// The runtime itself is checked in `src/runtime.test.ts`; this file is the game.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_MAX_ANGLE,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import {
  CAROM_HANDLE,
  createDebugApi,
  installDebugApi,
  type CaromDebugApi,
} from "./debug";
import { game, type CaromState } from "./game";
import { createRuntime, type Game, type Runtime } from "./runtime";
import type { Surface, Viewport } from "./viewport";

// ---- The harness --------------------------------------------------------

/** The frame length every check below counts in, unless it says otherwise. */
const TICK = 1 / 60;

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

interface Harness {
  readonly runtime: Runtime<CaromState>;
  readonly state: CaromState;
  readonly debug: CaromDebugApi;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: string[];
  /** Run `frames` frames of `TICK` seconds each. */
  run(frames: number): void;
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

/** The number of `TICK` frames that covers `seconds`. */
function frames(seconds: number): number {
  return Math.ceil(seconds * 60);
}

/** A 2D context that writes down every call and property set made through it. */
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

function createHarness(): Harness {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    getContext: () => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

  // The game, with the one call a check wants to overhear — which cue an event
  // played — written down on its way through. Everything else is untouched, so
  // what runs is the real update against the real runtime.
  const cues: string[] = [];
  const observed: Game<CaromState> = {
    initialize: (api) => game.initialize(api),
    update: (state, api, dt) =>
      game.update(
        state,
        {
          input: api.input,
          audio: {
            play: (cue) => {
              cues.push(cue);
              api.audio.play(cue);
            },
            setMuted: (muted) => api.audio.setMuted(muted),
            muted: () => api.audio.muted(),
          },
        },
        dt,
      ),
    render: (state, api) => game.render(state, api),
  };

  const runtime = createRuntime<CaromState>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game: observed,
    background: "#0b0e14",
    surface,
    // Node has no Web Audio. The bus stays silent; the cues above still record.
    audioContext: () => null,
  });

  const state = runtime.initialize();
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  return {
    runtime,
    state,
    debug: createDebugApi(state, runtime),
    ctx,
    calls,
    cues,
    run: (count) => runtime.advance(count * TICK, count),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    pixel: (x, y) => {
      const [dx, dy] = toDevice(runtime.viewport(), x, y);
      const { data } = ctx.getImageData(dx, dy, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => runtime.destroy(),
  };
}

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** Take the match to a live rally with the ball posed exactly as asked. */
function rally(
  h: Harness,
  mode: "solo" | "versus",
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): void {
  h.debug.startMatch(mode);
  h.debug.serve();
  h.run(1); // the launch, through the build's own serve
  h.debug.setBall(0, ball);
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

  it("accumulates simulation time from the deltas it is handed", () => {
    harness.run(30);
    expect(harness.runtime.frame().count).toBe(30);
    expect(harness.state.simTime).toBeCloseTo(0.5, 9);
  });
});

// ---- Menus --------------------------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", () => {
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.holdTimer).toBeCloseTo(HOLD_TIME - TICK, 9);
  });

  it("moves the selection with either side's slider", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("KeyW");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("starts a Versus match from the second item", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Space");
    harness.run(1);
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.screen).toBe("countdown");
  });

  it("opens and leaves the how-to-play screen", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("consumes a press exactly once", () => {
    harness.tap("ArrowDown");
    harness.run(10);
    expect(harness.state.menuIndex).toBe(1);
  });
});

// ---- Controls -----------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );

    harness.release("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("drives player one from either slider in Solo", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("ArrowDown");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("stands still when opposite sliders are held in Solo", () => {
    harness.tap("Enter");
    harness.run(1);

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    harness.run(30);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });

  it("gives the second slider its own paddle in Versus", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    harness.hold("ArrowDown");
    harness.run(frames(0.1));
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
  });
});

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", () => {
    harness.debug.startMatch("versus");
    harness.run(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.debug.snapshot().ball.held).toBe(true);

    harness.run(2);
    expect(harness.state.screen).toBe("playing");
    expect(harness.debug.snapshot().ball.held).toBe(false);
  });

  it("sends the first serve of a match toward player one", () => {
    harness.debug.startMatch("versus");
    harness.run(frames(HOLD_TIME) + 1);
    const { ball } = harness.debug.snapshot();
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("keeps the serve within 30deg of horizontal, and never flat", () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    harness.run(1);
    const { ball } = harness.debug.snapshot();
    expect(Math.abs(ball.vy)).toBeGreaterThan(0);
    expect(Math.abs(Math.atan2(ball.vy, Math.abs(ball.vx)))).toBeLessThan(
      SERVE_MAX_ANGLE,
    );
  });

  it("replays the same serve from the same seed", () => {
    const other = createHarness();
    try {
      for (const h of [harness, other]) {
        h.debug.reset({ seed: 4242 });
        h.debug.startMatch("versus");
        h.debug.serve();
        h.run(1);
      }
      expect(other.debug.snapshot().ball.vy).toBe(
        harness.debug.snapshot().ball.vy,
      );
    } finally {
      other.dispose();
    }
  });
});

// ---- Physics, through the runtime ---------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", () => {
    rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 200 });
    harness.cues.length = 0;

    harness.run(6);

    expect(harness.cues).toEqual([CUES.paddleHit]);
    const { ball } = harness.debug.snapshot();
    expect(ball.vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 units per second when it struck.
    expect(ball.spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball.spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", () => {
    rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.wallBounce]);
    expect(harness.debug.snapshot().ball.vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", () => {
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.obstacleBounce]);
    expect(harness.debug.snapshot().ball.vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", () => {
    // TRAIL_TIME is a window of TIME, so a finer step fills the same window with
    // more samples. Both harnesses cover the same third of a second.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 0 };
    rally(harness, "versus", pose);
    harness.run(20);
    const coarse = harness.state.trail.length;

    const fine = createHarness();
    try {
      rally(fine, "versus", pose);
      fine.runtime.advance(20 / 60, 80); // four times as finely
      expect(fine.state.trail.length).toBeGreaterThan(coarse);
    } finally {
      fine.dispose();
    }
  });
});

// ---- Scoring and the match ----------------------------------------------

describe("scoring", () => {
  it("gives the point to the far side and re-serves toward the receiver", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(4);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(harness.cues).toEqual([CUES.score]);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.receiver).toBe("right");

    harness.run(frames(HOLD_TIME) + 1);
    expect(harness.debug.snapshot().ball.vx).toBeGreaterThan(0);
  });

  it("gives the point to player two when the ball leaves the left edge", () => {
    rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    harness.run(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
    expect(harness.state.receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);

    harness.run(4);

    expect(harness.state.score.p1).toBe(WIN_SCORE);
    expect(harness.state.winner).toBe("left");
    expect(harness.state.screen).toBe("matchover");
  });

  it("plays on at deuce until someone leads by two", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 1);

    harness.run(4);

    expect(harness.state.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 1 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.screen).toBe("countdown");
  });

  it("offers a rematch from the match-over screen", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);

    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
  });
});

// ---- Pause and mute -----------------------------------------------------

describe("pause", () => {
  it("freezes the field and resumes where it left off", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.run(6);

    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");

    const frozen = harness.debug.snapshot();
    harness.run(60);
    expect(harness.debug.snapshot().ball.x).toBe(frozen.ball.x);

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("quits to the title from the pause menu", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    harness.run(1);

    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
  });
});

describe("mute", () => {
  it("toggles the runtime's mute bit from any screen and mirrors it", () => {
    harness.tap("KeyM");
    harness.run(1);
    expect(harness.state.muted).toBe(true);

    harness.tap("KeyM");
    harness.run(1);
    expect(harness.state.muted).toBe(false);
  });

  it("keeps playing cues, silently, while muted", () => {
    harness.tap("KeyM");
    harness.run(1);
    rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.wallBounce]);
    expect(harness.state.muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("window.__carom", () => {
  it("holds the paddles once a control operation has taken them", () => {
    harness.debug.startMatch("versus");
    harness.debug.setPaddle("left", { vy: 300 });
    expect(harness.state.driver.paddles).toBe(true);

    harness.hold("KeyW"); // ignored: the driver has the paddles
    harness.run(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
  });

  it("hands the paddles back on reset", () => {
    harness.debug.startMatch("versus");
    harness.debug.setPaddle("left", { vy: 300 });
    harness.debug.reset();
    expect(harness.state.driver.paddles).toBe(false);
    expect(harness.state.screen).toBe("title");

    harness.tap("Enter");
    harness.run(1);
    harness.hold("KeyW");
    harness.run(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("runs the real AI against a posed shot when handed its paddle back", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddle("right", { cy: 600, vy: 0 });
    harness.debug.setAiControl(true);

    harness.run(30);

    const { paddles } = harness.debug.snapshot();
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // still the driver's
  });

  it("refuses a ball index this variant does not have", () => {
    expect(() => harness.debug.setBall(1, { x: 0 })).toThrow(RangeError);
  });

  it("installs itself on the page and takes itself off again", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const original = globals["window"];
    globals["window"] = {};
    try {
      const remove = installDebugApi(harness.state, harness.runtime);
      const page = globals["window"] as Record<string, unknown>;
      const api = page[CAROM_HANDLE] as CaromDebugApi;
      expect(api.version).toBe(1);
      expect(api.snapshot().screen).toBe("title");
      remove();
      expect(page[CAROM_HANDLE]).toBeUndefined();
    } finally {
      globals["window"] = original;
    }
  });
});

// ---- The clock the surface owns -----------------------------------------

describe("the manual clock", () => {
  it("stops the game advancing itself, and advance moves it on instead", () => {
    harness.debug.setAutoStep(false);
    expect(harness.runtime.autoStep()).toBe(false);

    harness.debug.startMatch("versus");
    harness.debug.serve();
    const before = harness.debug.snapshot().simTime;

    harness.debug.advance(1, 60);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 1, 9);

    harness.debug.setAutoStep(true);
    expect(harness.runtime.autoStep()).toBe(true);
  });

  it("runs one frame by default", () => {
    harness.debug.setAutoStep(false);
    const before = harness.debug.snapshot().simTime;
    harness.debug.advance(0.25);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 0.25, 9);
    expect(harness.runtime.frame().count).toBe(1);
  });

  it("leaves the paddles with whoever had them: a clock is not a pose", () => {
    harness.tap("Enter"); // a real Solo match, played from the keyboard
    harness.debug.setAutoStep(false);
    harness.debug.advance(TICK);
    expect(harness.state.driver.paddles).toBe(false);

    harness.hold("KeyW");
    harness.debug.advance(0.1, 6);
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("reaches the same outcome however the second was divided into frames", () => {
    // specs/instrumentation.md: every rate is integrated against the frame's
    // delta, so advance(1, 1) and advance(1, 60) cover the same second of game
    // time and must agree beyond the drift a change in step size explains.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 120, spin: 300 };
    const coarse = createHarness();
    const fine = createHarness();
    try {
      for (const h of [coarse, fine]) {
        h.debug.setAutoStep(false);
        h.debug.reset({ seed: 7 });
        h.debug.startMatch("versus");
        h.debug.serve();
        h.debug.advance(TICK);
        h.debug.setBall(0, pose);
      }
      coarse.debug.advance(0.5, 1);
      fine.debug.advance(0.5, 60);

      const a = coarse.debug.snapshot().ball;
      const b = fine.debug.snapshot().ball;
      // A curving path is integrated, so "the same place" is the same place to
      // within the sub-step resolution rather than bit for bit.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(4);
      expect(a.spin).toBeCloseTo(b.spin, 6);
      expect(a.speed).toBeCloseTo(b.speed, 6);
    } finally {
      coarse.dispose();
      fine.dispose();
    }
  });
});

// ---- Drawing ------------------------------------------------------------

describe("rendering", () => {
  it("fills each paddle in its own color", () => {
    harness.debug.startMatch("versus");
    harness.run(1);

    expect(harness.pixel(P1_X0 + PADDLE_W / 2, FIELD_CY)).toEqual([
      58, 231, 196, 255,
    ]);
    expect(harness.pixel(FIELD_W - P1_X0 - PADDLE_W / 2, FIELD_CY)).toEqual([
      255, 92, 138, 255,
    ]);
  });

  it("draws the ball as one arc at its own position", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    harness.run(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].slice(0, 3)).toEqual([400, 300, BALL_R]);
    expect(harness.pixel(400, 300)).toEqual([242, 245, 247, 255]);
  });

  it("draws in logical coordinates whatever size the surface is", () => {
    harness.debug.startMatch("versus");
    harness.run(1);
    const view = harness.runtime.viewport();
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBe(1);
  });

  it("changes nothing about the state", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.run(1);
    const before = JSON.stringify(harness.debug.snapshot());
    game.render(harness.state, {
      ctx: harness.ctx as unknown as CanvasRenderingContext2D,
    });
    expect(JSON.stringify(harness.debug.snapshot())).toBe(before);
  });
});
