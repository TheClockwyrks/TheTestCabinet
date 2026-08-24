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
  BALL_COLLIDE_DIST,
  BALL_COUNT,
  BALL_HOMES,
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
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import {
  CAROM_HANDLE,
  createDebugApi,
  installDebugApi,
  type CaromDebugApi,
  type CaromSnapshot,
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
function rally(
  h: Harness,
  mode: "solo" | "versus",
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): void {
  h.debug.startMatch(mode);
  h.debug.serve();
  h.run(1); // the launch, through the build's own code
  h.debug.setBall(0, ball);
  h.debug.setBall(1, IDLE[0]);
  h.debug.setBall(2, IDLE[1]);
}

/** The one ball a `rally` scenario is driving. */
function driven(h: Harness): CaromSnapshot["balls"][number] {
  return h.debug.snapshot().balls[0];
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
    expect(state.balls).toHaveLength(BALL_COUNT);
    state.balls.forEach((ball, index) => {
      expect(ball).toEqual({
        x: BALL_HOMES[index].x,
        y: BALL_HOMES[index].y,
        vx: 0,
        vy: 0,
        spin: 0,
        held: false,
        holdTimer: 0,
        trail: [],
      });
    });
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
    for (const ball of harness.state.balls) {
      expect(ball.holdTimer).toBeCloseTo(HOLD_TIME - TICK, 9);
    }
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

    // Both ups against one down is still "up held, down held": `down - up` is 0.
    harness.hold("ArrowUp");
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

// ---- Launching ----------------------------------------------------------

describe("launching", () => {
  it("holds all three for HOLD_TIME and then launches them together", () => {
    harness.debug.startMatch("versus");
    harness.run(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.debug.snapshot().balls.map((b) => b.held)).toEqual([
      true,
      true,
      true,
    ]);

    harness.run(2);
    expect(harness.state.screen).toBe("playing");
    expect(harness.debug.snapshot().balls.map((b) => b.held)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("starts each ball on its own home point", () => {
    harness.debug.startMatch("versus");
    harness.run(1);
    harness.debug.snapshot().balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
    });
  });

  it("launches every ball at SERVE_SPEED", () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    harness.run(1);
    for (const ball of harness.debug.snapshot().balls) {
      expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
    }
  });

  it("draws a fresh angle for every launch, over the whole circle", () => {
    const quadrants = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      harness.debug.reset({ seed });
      harness.debug.startMatch("versus");
      harness.debug.serve();
      harness.run(1);
      for (const ball of harness.debug.snapshot().balls) {
        const angle = Math.atan2(ball.vy, ball.vx) + Math.PI;
        quadrants.add(Math.floor(angle / (Math.PI / 2)) % 4);
      }
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("replays the same three launches from the same seed", () => {
    const other = createHarness();
    try {
      for (const h of [harness, other]) {
        h.debug.reset({ seed: 4242 });
        h.debug.startMatch("versus");
        h.debug.serve();
        h.run(1);
      }
      expect(other.debug.snapshot().balls).toEqual(
        harness.debug.snapshot().balls,
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
    const ball = driven(harness);
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
    expect(driven(harness).vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", () => {
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.obstacleBounce]);
    expect(driven(harness).vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", () => {
    // TRAIL_TIME is a window of TIME, so a finer step fills the same window with
    // more samples. Both harnesses cover the same third of a second.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 0 };
    rally(harness, "versus", pose);
    harness.run(20);
    const coarse = harness.state.balls[0].trail.length;

    const fine = createHarness();
    try {
      rally(fine, "versus", pose);
      fine.runtime.advance(20 / 60, 80); // four times as finely
      expect(fine.state.balls[0].trail.length).toBeGreaterThan(coarse);
    } finally {
      fine.dispose();
    }
  });
});

// ---- Scoring and the match ----------------------------------------------

describe("scoring", () => {
  it("gives the point to the far side and sends only that ball home", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(4);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(harness.cues).toEqual([CUES.score]);
    // The field never freezes for a respawn: the match stays live.
    expect(harness.state.screen).toBe("playing");

    const scored = driven(harness);
    expect(scored.held).toBe(true);
    expect(scored.x).toBe(BALL_HOMES[0].x);
    expect(scored.y).toBe(BALL_HOMES[0].y);

    harness.run(frames(HOLD_TIME) + 1);
    expect(driven(harness).held).toBe(false);
    expect(driven(harness).speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("gives the point to player two when a ball leaves the left edge", () => {
    rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    harness.run(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
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
    expect(harness.state.screen).toBe("playing");
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

  it("returns to the title from the match-over screen on Escape", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);
    expect(harness.state.screen).toBe("matchover");

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
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
    expect(harness.debug.snapshot().balls).toEqual(frozen.balls);

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
    expect(() => harness.debug.setBall(BALL_COUNT, { x: 0 })).toThrow(
      RangeError,
    );
    expect(() => harness.debug.setBall(-1, { x: 0 })).toThrow(RangeError);
  });

  it("takes a posed ball into live play", () => {
    harness.debug.startMatch("versus");
    harness.debug.setBall(2, { x: 400, y: 300, vx: 200, vy: 0 });
    expect(harness.debug.snapshot().balls[2].held).toBe(false);

    harness.run(6);
    expect(harness.debug.snapshot().balls[2].x).toBeGreaterThan(400);
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

      const a = driven(coarse);
      const b = driven(fine);
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

  it("draws every ball as its own arc at its own position", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    harness.run(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(BALL_COUNT);
    expect(arcs.map((args) => args.slice(0, 3))).toEqual([
      [400, 300, BALL_R],
      [IDLE[0].x, IDLE[0].y, BALL_R],
      [IDLE[1].x, IDLE[1].y, BALL_R],
    ]);
    expect(harness.pixel(400, 300)).toEqual([242, 245, 247, 255]);
    expect(harness.pixel(IDLE[0].x, IDLE[0].y)).toEqual([242, 245, 247, 255]);
  });

  it("draws each score as its own number, player one's left of center", () => {
    harness.debug.startMatch("versus");
    harness.debug.setScore(7, 9);
    harness.calls.length = 0;
    harness.run(1);

    const texts = callsTo(harness.calls, "fillText");
    const p1 = texts.find((args) => args[0] === "7");
    const p2 = texts.find((args) => args[0] === "9");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1?.[1]).toBeLessThan(FIELD_CX);
    expect(p2?.[1]).toBeGreaterThan(FIELD_CX);
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

// ---- The three balls ----------------------------------------------------

describe("three independent balls", () => {
  it("keeps the other two running while one respawns", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setBall(1, { x: 300, y: 300, vx: 300, vy: 0 });

    harness.run(4);

    // Ball 0 scored and went home; ball 1 never paused.
    expect(harness.debug.snapshot().balls[0].held).toBe(true);
    expect(harness.debug.snapshot().balls[1].held).toBe(false);
    expect(harness.debug.snapshot().balls[1].x).toBeGreaterThan(300);
  });

  it("runs each ball's hold on its own clock", () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    harness.run(1);
    // Send ball 0 home mid-rally by scoring with it; the others stay in flight.
    harness.debug.setBall(0, { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.run(4);

    const holds = harness.state.balls.map((ball) => ball.holdTimer);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[1]).toBe(0);
    expect(holds[2]).toBe(0);
  });

  it("bounces two balls off each other without changing either's spin", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    harness.debug.setBall(1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });

    harness.run(30);

    const [a, b] = harness.debug.snapshot().balls;
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.spin).toBe(0);
    expect(b.spin).toBe(0);
  });

  it("plays the ball cue when two balls bounce off each other", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    harness.debug.setBall(1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    harness.run(30);

    expect(harness.cues).toContain(CUES.ballBounce);
  });

  it("plays the ball cue once for the pair, not once for each ball", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    harness.debug.setBall(1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    harness.run(30);

    // A collision is one event between two balls (specs/ui.md), so the whole of
    // this scenario is one cue. Playing it from a loop over the balls would sound
    // the same contact twice, once for each side of it.
    expect(harness.cues).toEqual([CUES.ballBounce]);
  });

  it("bounces a moving ball off one waiting at its home point", () => {
    harness.debug.startMatch("versus");
    // Ball 1 is still waiting on the field center; drive ball 0 into it.
    harness.debug.setBall(0, {
      x: BALL_HOMES[1].x - 120,
      y: BALL_HOMES[1].y,
      vx: 400,
      vy: 0,
    });

    harness.run(30);

    const [moving, waiting] = harness.debug.snapshot().balls;
    expect(moving.vx).toBeLessThan(0);
    expect(waiting.held).toBe(true);
    expect(waiting.x).toBe(BALL_HOMES[1].x);
    expect(waiting.y).toBe(BALL_HOMES[1].y);
  });

  it("never lets two balls occupy the same place", () => {
    harness.debug.startMatch("versus");
    harness.debug.serve();
    harness.run(600);

    const balls = harness.debug.snapshot().balls;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const gap = Math.hypot(
          balls[j].x - balls[i].x,
          balls[j].y - balls[i].y,
        );
        expect(gap).toBeGreaterThan(BALL_COLLIDE_DIST - 1);
      }
    }
  });

  it("defends the ball arriving at its goal soonest in Solo", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    // A second ball threatens the same goal, but from much further away.
    harness.debug.setBall(1, { x: 200, y: 620, vx: 400, vy: 0 });
    harness.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
    harness.debug.setAiControl(true);

    harness.run(20);

    // It tracks the near ball at y 180, not the far one at y 620.
    expect(harness.debug.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });
});
