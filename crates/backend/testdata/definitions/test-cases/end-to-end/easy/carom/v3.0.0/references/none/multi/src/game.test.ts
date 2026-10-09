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
  MATCHOVER_ITEMS,
  OBSTACLE_CENTERS,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  PAUSE_ITEMS,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  TITLE_ITEMS,
  WIN_SCORE,
} from "./constants";
import {
  CAROM_HANDLE,
  createDebugApi,
  installDebugApi,
  type CaromDebugApi,
  type CaromSnapshot,
} from "./debug";
import { game, type CaromState, type Mode, type Side } from "./game";
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
  /** Move the mouse to a logical point. No frame runs; `run` does that. */
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
  touchStart(x: number, y: number): void;
  touchMove(x: number, y: number): void;
  touchEnd(x: number, y: number): void;
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

/** A `PointerEvent`-shaped event: the runtime reads `clientX/Y` and the type. */
class PointerEventLike extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType = "mouse";

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/** A `TouchEvent`-shaped event: the runtime reads the first changed contact. */
class TouchEventLike extends Event {
  readonly changedTouches: readonly { clientX: number; clientY: number }[];

  constructor(
    type: "touchstart" | "touchmove" | "touchend",
    points: readonly { clientX: number; clientY: number }[],
  ) {
    super(type);
    this.changedTouches = points;
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
    // The canvas fills the page and the fit is 1:1, so a logical point and a
    // client point are the same number here.
    origin: () => ({ x: 0, y: 0 }),
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
          pointer: api.pointer,
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
    pointerMove: (x, y) =>
      events.dispatchEvent(new PointerEventLike("pointermove", x, y)),
    pointerDown: (x, y) =>
      events.dispatchEvent(new PointerEventLike("pointerdown", x, y)),
    pointerUp: (x, y) =>
      events.dispatchEvent(new PointerEventLike("pointerup", x, y)),
    touchStart: (x, y) =>
      events.dispatchEvent(
        new TouchEventLike("touchstart", [{ clientX: x, clientY: y }]),
      ),
    touchMove: (x, y) =>
      events.dispatchEvent(
        new TouchEventLike("touchmove", [{ clientX: x, clientY: y }]),
      ),
    touchEnd: (x, y) =>
      events.dispatchEvent(
        new TouchEventLike("touchend", [{ clientX: x, clientY: y }]),
      ),
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

/* -------------------------------------------------------------------------- */
/* Sequences over the atomic surface                                          */
/* -------------------------------------------------------------------------- */
//
// Every operation `specs/instrumentation.md` puts on the surface sets ONE field,
// places or removes ONE entity, or moves the clock, so reaching a screen or
// staging a rally is a SEQUENCE of them. The sequences live here, once, so no
// check below spells one out.

/** Where a scenario puts a ball, and how fast. Anything omitted is zero. */
interface BallPose {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

/**
 * Open a match on its pre-serve countdown through the surface alone.
 *
 * `reset` puts every declared field at its title value — which is, field for
 * field, what `specs/ui.md` says starting a match sets — so a match opens in two
 * more operations: the mode, and the screen. Neither paddle is taken from the
 * player.
 */
function openMatch(h: Harness, mode: Mode): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setScreen("countdown");
}

/**
 * End every present ball's hold.
 *
 * Setting a hold timer to `0` does not itself launch the ball: the build launches
 * it on the next frame whose subtraction leaves the timer at or below zero,
 * through its own rule (specs/balls.md).
 */
function endHolds(h: Harness): void {
  for (const ball of h.debug.snapshot().balls) {
    h.debug.setBallHoldTimer(ball.index, 0);
  }
}

/**
 * Put one ball into flight at a posed place and aim: five atomic operations, in
 * the order that leaves nothing for the next frame to undo.
 *
 * The hold is ended FIRST, because a held ball sits parked at its home point with
 * zero velocity and a position posed while it is still held is one the game is
 * entitled to overwrite on the frame after.
 */
function place(h: Harness, index: number, pose: BallPose): void {
  h.debug.setBallHeld(index, false);
  h.debug.setBallHoldTimer(index, 0);
  h.debug.setBallPosition(index, pose.x, pose.y);
  h.debug.setBallVelocity(index, pose.vx ?? 0, pose.vy ?? 0);
  h.debug.setBallSpin(index, pose.spin ?? 0);
}

/** Take one paddle from the player, put it somewhere, and give it a velocity. */
function drive(
  h: Harness,
  side: Side,
  pose: { cy?: number; vy?: number } = {},
): void {
  if (pose.cy !== undefined) h.debug.setPaddleCy(side, pose.cy);
  h.debug.setPaddleVy(side, pose.vy ?? 0);
  h.debug.setPaddleDriven(side, true);
}

/**
 * Take the match to a live rally with ball 0 posed exactly as asked, and the
 * other two parked out of the way so the scenario is about the one ball.
 */
function rally(h: Harness, mode: Mode, ball: BallPose): void {
  openMatch(h, mode);
  endHolds(h);
  h.run(1); // the launch, through the build's own code
  place(h, 0, ball);
  place(h, 1, IDLE[0]);
  place(h, 2, IDLE[1]);
}

/** The one ball a `rally` scenario is driving. */
function driven(h: Harness): CaromSnapshot["balls"][number] {
  return h.debug.snapshot().balls[0];
}

/** The middle of item `index`'s hit region on the current screen's menu. */
function itemCenter(h: Harness, index: number): { x: number; y: number } {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) throw new Error(`no hit region for item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every field of the state present", () => {
    const { state } = harness;
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(0);
    expect(state.titleIndex).toBe(0);
    expect(state.resumeScreen).toBe("playing");
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.ai).toEqual({ tracking: true, movement: true });
    expect(state.simTime).toBe(0);

    for (const side of ["left", "right"] as const) {
      expect(state.paddles[side]).toEqual({
        cy: FIELD_CY,
        vy: 0,
        drivenVy: 0,
        driven: false,
      });
    }

    // Every ball is present, held at its own home with a full timer
    // (specs/state.md).
    expect(state.balls).toHaveLength(BALL_COUNT);
    state.balls.forEach((ball, index) => {
      expect(ball).toEqual({
        index,
        x: BALL_HOMES[index].x,
        y: BALL_HOMES[index].y,
        vx: 0,
        vy: 0,
        spin: 0,
        held: true,
        holdTimer: HOLD_TIME,
        launchAngle: expect.any(Number),
        trail: [],
      });
    });

    // Both obstacles are present, at their fixed centers.
    expect(state.obstacles).toEqual(
      OBSTACLE_CENTERS.map((center, index) => ({
        index,
        cx: center.x,
        cy: center.y,
      })),
    );
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
    openMatch(harness, "versus");
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
    openMatch(harness, "versus");
    harness.run(1);
    harness.debug.snapshot().balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
    });
  });

  it("launches every ball at SERVE_SPEED", () => {
    openMatch(harness, "versus");
    endHolds(harness);
    harness.run(1);
    for (const ball of harness.debug.snapshot().balls) {
      expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
    }
  });

  it("draws a fresh angle over the whole circle whenever a ball is parked", () => {
    openMatch(harness, "versus");
    const quadrants = new Set<number>();
    for (let i = 0; i < 200 && quadrants.size < 4; i++) {
      harness.debug.spawnBall(0);
      const angle = harness.debug.snapshot().balls[0].launchAngle;
      quadrants.add(Math.floor(angle / (Math.PI / 2)) % 4);
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("launches each ball along the angle it holds, and leaves it as it is", () => {
    openMatch(harness, "versus");
    const angles = [0.4, 2.0, 4.5];
    angles.forEach((angle, index) => {
      harness.debug.setBallLaunchAngle(index, angle);
    });
    endHolds(harness);
    harness.run(1);
    const balls = harness.debug.snapshot().balls;
    angles.forEach((angle, index) => {
      expect(balls[index].launchAngle).toBe(angle);
      const flown = Math.atan2(balls[index].vy, balls[index].vx);
      expect(Math.cos(flown - angle)).toBeCloseTo(1, 3);
    });
  });
});

// ---- Physics, through the runtime ---------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", () => {
    rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    drive(harness, "left", { cy: FIELD_CY, vy: 200 });
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
  it("takes one paddle from the player and leaves the other alone", () => {
    openMatch(harness, "versus");
    drive(harness, "left", { vy: 300 });
    expect(harness.debug.snapshot().paddles.left.driven).toBe(true);
    expect(harness.debug.snapshot().paddles.right.driven).toBe(false);

    harness.hold("KeyW"); // ignored: the surface has this paddle
    harness.hold("ArrowDown"); // and the other one is still the player's
    harness.run(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("keeps drivenVy and vy as two separate fields", () => {
    openMatch(harness, "versus");
    // A velocity set while the paddle is still the player's is remembered and
    // does not move it (specs/instrumentation.md).
    harness.debug.setPaddleVy("left", 300);
    harness.run(frames(0.1));
    expect(harness.debug.snapshot().paddles.left.drivenVy).toBe(300);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);

    // It reaches `vy` on the first frame advanced with that side driven.
    harness.debug.setPaddleDriven("left", true);
    harness.run(1);
    expect(harness.debug.snapshot().paddles.left.vy).toBe(300);
  });

  it("hands the paddles back on reset", () => {
    openMatch(harness, "versus");
    drive(harness, "left", { vy: 300 });
    harness.debug.reset();
    expect(harness.debug.snapshot().paddles.left.driven).toBe(false);
    expect(harness.debug.snapshot().paddles.left.drivenVy).toBe(0);
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

  it("runs the real AI on the paddle it has not taken", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    // The left paddle is the scenario's; the right one is left with the AI.
    drive(harness, "left", { cy: FIELD_CY, vy: 0 });
    harness.debug.setPaddleCy("right", 600);

    harness.run(30);

    const { paddles } = harness.debug.snapshot();
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // still the surface's
  });

  // A ball that is not there is no ball to pose. A surface that quietly did
  // nothing would let a caller read its own pose back off a field that never
  // took it, so every one of these fails where the caller can see it.
  it("fails loudly from an operation naming a ball that is not there", () => {
    openMatch(harness, "versus");
    harness.debug.clearWorld();
    // Every one of the five, against a field with no balls on it at all.
    expect(() => harness.debug.setBallPosition(0, 10, 10)).toThrow();
    expect(() => harness.debug.setBallVelocity(0, 10, 10)).toThrow();
    expect(() => harness.debug.setBallSpin(0, 10)).toThrow();
    expect(() => harness.debug.setBallHeld(0, false)).toThrow();
    expect(() => harness.debug.setBallHoldTimer(0, 10)).toThrow();
    expect(harness.debug.snapshot().balls).toEqual([]);

    // And an index this variant simply does not have.
    expect(() => harness.debug.spawnBall(BALL_COUNT)).toThrow();
    expect(() => harness.debug.spawnBall(-1)).toThrow();
    expect(harness.debug.snapshot().balls).toEqual([]);
  });

  // `reconcile` is required of every build. This one works every derived
  // reading out at the read, so the call has nothing to rewrite — which is
  // exactly what these two assert: the readings agree with the pose, and
  // nothing moved.
  it("re-derives a reading from a posed velocity", () => {
    openMatch(harness, "versus");
    harness.debug.setBallVelocity(0, 30, 40);
    harness.debug.reconcile();
    expect(harness.debug.snapshot().balls[0].speed).toBeCloseTo(50, 10);
  });

  it("advances nothing", () => {
    openMatch(harness, "versus");
    place(harness, 0, { x: 400, y: 300, vx: 250, vy: -120 });
    harness.debug.setPaddleCy("left", 240);
    harness.debug.setBallHoldTimer(1, 0.4);

    const before = harness.debug.snapshot();
    harness.debug.reconcile();
    const once = harness.debug.snapshot();
    harness.debug.reconcile();
    const twice = harness.debug.snapshot();

    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });

  it("takes a posed ball into live play", () => {
    openMatch(harness, "versus");
    place(harness, 2, { x: 400, y: 300, vx: 200, vy: 0 });
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

    openMatch(harness, "versus");
    endHolds(harness);
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
    expect(harness.debug.snapshot().paddles.left.driven).toBe(false);

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
        openMatch(h, "versus");
        h.debug.setBallLaunchAngle(0, 0.7);
        h.debug.setBallLaunchAngle(1, 2.1);
        h.debug.setBallLaunchAngle(2, 4.4);
        endHolds(h);
        h.debug.advance(TICK);
        place(h, 0, pose);
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
    openMatch(harness, "versus");
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
    openMatch(harness, "versus");
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
    openMatch(harness, "versus");
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
    place(harness, 1, { x: 300, y: 300, vx: 300, vy: 0 });

    harness.run(4);

    // Ball 0 scored and went home; ball 1 never paused.
    expect(harness.debug.snapshot().balls[0].held).toBe(true);
    expect(harness.debug.snapshot().balls[1].held).toBe(false);
    expect(harness.debug.snapshot().balls[1].x).toBeGreaterThan(300);
  });

  it("runs each ball's hold on its own clock", () => {
    openMatch(harness, "versus");
    endHolds(harness);
    harness.run(1);
    // Send ball 0 home mid-rally by scoring with it; the others stay in flight.
    place(harness, 0, { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.run(4);

    const holds = harness.state.balls.map((ball) => ball.holdTimer);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[1]).toBe(0);
    expect(holds[2]).toBe(0);
  });

  it("bounces two balls off each other without changing either's spin", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    place(harness, 1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });

    harness.run(30);

    const [a, b] = harness.debug.snapshot().balls;
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.spin).toBe(0);
    expect(b.spin).toBe(0);
  });

  it("plays the ball cue when two balls bounce off each other", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    place(harness, 1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    harness.run(30);

    expect(harness.cues).toContain(CUES.ballBounce);
  });

  it("plays the ball cue once for the pair, not once for each ball", () => {
    rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0, spin: 0 });
    place(harness, 1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    harness.run(30);

    // A collision is one event between two balls (specs/ui.md), so the whole of
    // this scenario is one cue. Playing it from a loop over the balls would sound
    // the same contact twice, once for each side of it.
    expect(harness.cues).toEqual([CUES.ballBounce]);
  });

  it("bounces a moving ball off one waiting at its home point", () => {
    openMatch(harness, "versus");
    // Ball 1 is still waiting on the field center; drive ball 0 into it.
    place(harness, 0, {
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
    openMatch(harness, "versus");
    endHolds(harness);
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
    place(harness, 1, { x: 200, y: 620, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", FIELD_CY);

    harness.run(20);

    // It tracks the near ball at y 180, not the far one at y 620.
    expect(harness.debug.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });
});

// ---- The world the surface poses ----------------------------------------

describe("the world", () => {
  it("empties the field and leaves the paddles standing", () => {
    openMatch(harness, "versus");
    harness.debug.clearWorld();

    const cleared = harness.debug.snapshot();
    expect(cleared.balls).toEqual([]);
    expect(cleared.obstacles).toEqual([]);
    expect(cleared.paddles.left.cy).toBe(FIELD_CY);
    expect(cleared.paddles.right.cy).toBe(FIELD_CY);
  });

  it("spawns one ball back at its own home, held with a full timer", () => {
    openMatch(harness, "versus");
    harness.debug.clearWorld();
    harness.debug.spawnBall(1);

    const balls = harness.debug.snapshot().balls;
    expect(balls).toHaveLength(1);
    expect(balls[0]).toMatchObject({
      index: 1,
      x: BALL_HOMES[1].x,
      y: BALL_HOMES[1].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: expect.any(Number),
      trail: [],
    });
  });

  it("keeps the balls it spawns back in play order", () => {
    harness.debug.clearWorld();
    harness.debug.spawnBall(2);
    harness.debug.spawnBall(0);
    expect(harness.debug.snapshot().balls.map((b) => b.index)).toEqual([0, 2]);
  });

  it("returns a ball already on the field to a fresh arrangement", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0, spin: 50 });
    harness.run(4);
    harness.debug.spawnBall(0);

    expect(driven(harness)).toMatchObject({
      x: BALL_HOMES[0].x,
      y: BALL_HOMES[0].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: expect.any(Number),
      trail: [],
    });
  });

  it("takes an absent ball out of the frame entirely", () => {
    rally(harness, "versus", { x: FIELD_CX, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.clearWorld();
    harness.cues.length = 0;

    harness.run(120);

    // Nothing to advance, nothing to collide, nothing to score.
    expect(harness.debug.snapshot().balls).toEqual([]);
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.cues).toEqual([]);
  });

  it("spawns one obstacle back at its fixed center", () => {
    harness.debug.clearWorld();
    harness.debug.spawnObstacle(1);
    expect(harness.debug.snapshot().obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
  });

  it("flies straight through the place an absent obstacle stood", () => {
    // The obstacle-bounce scenario, with obstacle A taken off the field.
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.debug.clearWorld();
    harness.debug.spawnBall(0);
    place(harness, 0, { x: 300, y: 220, vx: 600 });
    harness.cues.length = 0;

    harness.run(6);

    expect(harness.cues).toEqual([]);
    expect(driven(harness).vx).toBe(600);
  });

  it("restores the whole world on reset", () => {
    harness.debug.clearWorld();
    harness.debug.reset();
    const restored = harness.debug.snapshot();
    expect(restored.balls).toHaveLength(BALL_COUNT);
    expect(restored.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
  });
});

// ---- The snapshot, field by field ---------------------------------------

describe("the snapshot", () => {
  it("reports every field an operation of the surface sets", () => {
    harness.debug.setScreen("paused");
    harness.debug.setMode("solo");
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setResumeScreen("countdown");
    harness.debug.setScore(4, 7);
    harness.debug.setWinner("right");
    harness.debug.setBallLaunchAngle(1, 2.5);
    harness.debug.setPaddleCy("left", 210);
    harness.debug.setPaddleVy("left", -120);
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setAiTracking(false);
    harness.debug.setAiMovement(false);
    harness.debug.setBallPosition(1, 300, 400);
    harness.debug.setBallVelocity(1, 30, 40);
    harness.debug.setBallSpin(1, 55);
    harness.debug.setBallHeld(1, false);
    harness.debug.setBallHoldTimer(1, 0.25);

    const snap = harness.debug.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("paused");
    expect(snap.mode).toBe("solo");
    expect(snap.menuIndex).toBe(2);
    expect(snap.titleIndex).toBe(1);
    expect(snap.resumeScreen).toBe("countdown");
    expect(snap.score).toEqual({ p1: 4, p2: 7 });
    expect(snap.winner).toBe("right");
    expect(snap.balls[1].launchAngle).toBe(2.5);
    expect(snap.muted).toBe(false);
    expect(snap.paddles.left).toEqual({
      cy: 210,
      vy: 0,
      drivenVy: -120,
      driven: true,
    });
    expect(snap.ai).toEqual({ tracking: false, movement: false });
    expect(snap.balls[1]).toMatchObject({
      index: 1,
      x: 300,
      y: 400,
      vx: 30,
      vy: 40,
      speed: 50,
      spin: 55,
      held: false,
      holdTimer: 0.25,
    });
    expect(snap.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
    expect(snap.autoStep).toBe(true);
    expect(snap.simTime).toBe(0);
  });

  it("reports the clock's own setting rather than a field of the state", () => {
    harness.debug.setAutoStep(false);
    expect(harness.debug.snapshot().autoStep).toBe(false);
    // A reset restores the declared fields and leaves the clock as it is.
    harness.debug.reset();
    expect(harness.debug.snapshot().autoStep).toBe(false);
    harness.debug.setAutoStep(true);
    expect(harness.debug.snapshot().autoStep).toBe(true);
  });

  it("hands out a copy: reading it cannot move the game", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.run(4);
    const snap = harness.debug.snapshot();
    snap.balls[0].x = -1;
    snap.balls[0].trail.length = 0;
    expect(harness.state.balls[0].x).not.toBe(-1);
    expect(harness.state.balls[0].trail.length).toBeGreaterThan(0);
  });
});

// ---- The AI's two faculties ---------------------------------------------

describe("the AI's faculties", () => {
  it("senses the ball with tracking on", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", FIELD_CY);
    harness.run(20);
    expect(harness.debug.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });

  it("targets home rather than the ball with tracking off", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", FIELD_CY);
    harness.debug.setAiTracking(false);

    harness.run(20);

    // Already home, so a blind opponent stands exactly still.
    expect(harness.debug.snapshot().paddles.right.cy).toBe(FIELD_CY);
    expect(harness.debug.snapshot().paddles.right.vy).toBe(0);
  });

  it("stands still with movement off, sensing or not", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", 600);
    harness.debug.setAiMovement(false);

    harness.run(20);

    expect(harness.debug.snapshot().paddles.right.cy).toBe(600);
    expect(harness.debug.snapshot().paddles.right.vy).toBe(0);
  });

  it("gates the two faculties one at a time", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", 600);
    // Sensing but not travelling.
    harness.debug.setAiMovement(false);
    harness.run(10);
    expect(harness.debug.snapshot().ai).toEqual({
      tracking: true,
      movement: false,
    });
    expect(harness.debug.snapshot().paddles.right.cy).toBe(600);

    // Travelling again: it chases the ball it was sensing all along.
    harness.debug.setAiMovement(true);
    harness.run(10);
    expect(harness.debug.snapshot().paddles.right.cy).toBeLessThan(600);
  });

  it("returns both faculties on reset", () => {
    harness.debug.setAiTracking(false);
    harness.debug.setAiMovement(false);
    harness.debug.reset();
    expect(harness.debug.snapshot().ai).toEqual({
      tracking: true,
      movement: true,
    });
  });
});

// ---- The pause keys -----------------------------------------------------

describe("the pause keys", () => {
  it("opens the pause menu with either key, from either live screen", () => {
    openMatch(harness, "versus");
    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.resumeScreen).toBe("countdown");
    expect(harness.state.menuIndex).toBe(0);

    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.resumeScreen).toBe("playing");
  });

  it("leaves the pause menu open on the Escape that opened it", () => {
    // One Escape raises `pause` AND `back`, but `back` is not read on a live
    // screen — so the menu opens and stays (specs/ui.md).
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.tap("Escape");
    harness.run(4);
    expect(harness.state.screen).toBe("paused");
  });

  it("resumes on Escape, exactly once", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.debug.setScreen("paused");
    harness.debug.setResumeScreen("playing");
    harness.debug.setMenuIndex(1); // RESTART, which a double-read would trigger

    harness.tap("Escape");
    harness.run(1);

    expect(harness.state.screen).toBe("playing");
    expect(harness.state.menuIndex).toBe(1); // nothing else was acted on
  });

  it("resumes on P as well", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.debug.setScreen("paused");
    harness.debug.setResumeScreen("playing");
    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("resumes to the countdown a countdown was paused from", () => {
    openMatch(harness, "versus");
    harness.tap("KeyP");
    harness.run(1);
    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
  });

  it("does nothing else on the frame it resumes", () => {
    // A movement edge on the same frame as the resume is not applied: the
    // frame resumes and stops (specs/ui.md).
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.debug.setScreen("paused");
    harness.debug.setMenuIndex(0);
    harness.tap("Escape");
    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
    expect(harness.state.menuIndex).toBe(0);
  });
});

// ---- The remembered title selection -------------------------------------

describe("the remembered title selection", () => {
  it("remembers the item that led away from the title", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter"); // HOW TO PLAY
    harness.run(1);

    expect(harness.state.titleIndex).toBe(2);
    expect(harness.state.menuIndex).toBe(0);

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("restores it after quitting a match to the menu", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter"); // VERSUS
    harness.run(1);
    expect(harness.state.titleIndex).toBe(1);

    harness.tap("KeyP");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter"); // QUIT TO MENU
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.titleIndex).toBe(1);
  });

  it("restores it from the match-over screen", () => {
    harness.debug.setTitleIndex(2);
    harness.debug.setMenuIndex(MATCHOVER_ITEMS.length - 1); // MENU
    harness.debug.setScreen("matchover");

    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("keeps its value across starting a match", () => {
    harness.debug.setTitleIndex(1);
    harness.debug.setScreen("matchover");
    harness.debug.setMenuIndex(0); // PLAY AGAIN
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.titleIndex).toBe(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("returns to zero on reset", () => {
    harness.debug.setTitleIndex(2);
    harness.debug.reset();
    expect(harness.state.titleIndex).toBe(0);
    expect(harness.state.menuIndex).toBe(0);
  });
});

// ---- The menus' hit regions ---------------------------------------------

describe("menuItemRect", () => {
  it("reports one region per item of the menu on screen", () => {
    for (const [screen, items] of [
      ["title", TITLE_ITEMS],
      ["paused", PAUSE_ITEMS],
      ["matchover", MATCHOVER_ITEMS],
    ] as const) {
      harness.debug.setScreen(screen);
      for (let i = 0; i < items.length; i++) {
        const rect = harness.debug.menuItemRect(i);
        expect(rect).not.toBeNull();
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
      expect(harness.debug.menuItemRect(items.length)).toBeNull();
      expect(harness.debug.menuItemRect(-1)).toBeNull();
    }
  });

  it("reports the how-to screen's single item", () => {
    harness.debug.setScreen("howto");
    expect(harness.debug.menuItemRect(0)).not.toBeNull();
    expect(harness.debug.menuItemRect(1)).toBeNull();
  });

  it("reports nothing on the two screens that show no menu", () => {
    for (const screen of ["countdown", "playing"] as const) {
      harness.debug.setScreen(screen);
      expect(harness.debug.menuItemRect(0)).toBeNull();
    }
  });

  it("keeps the regions apart, so a point is over at most one item", () => {
    harness.debug.setScreen("title");
    for (let i = 1; i < TITLE_ITEMS.length; i++) {
      const above = harness.debug.menuItemRect(i - 1);
      const below = harness.debug.menuItemRect(i);
      expect(above && below).toBeTruthy();
      expect(above!.y + above!.h).toBeLessThan(below!.y);
    }
  });

  it("draws each item inside the region it reports", () => {
    harness.debug.setScreen("title");
    harness.calls.length = 0;
    harness.run(1);

    const texts = callsTo(harness.calls, "fillText");
    TITLE_ITEMS.forEach((item, index) => {
      const rect = harness.debug.menuItemRect(index);
      const drawn = texts.find((args) => args[0] === item);
      expect(drawn).toBeDefined();
      expect(drawn?.[2]).toBeGreaterThanOrEqual(rect!.y);
      expect(drawn?.[2]).toBeLessThanOrEqual(rect!.y + rect!.h);
    });
  });
});

// ---- The menus under a mouse and a finger -------------------------------

describe("the menus under a pointer", () => {
  it("selects the item the pointer moves onto", () => {
    const at = itemCenter(harness, 1);
    harness.pointerMove(at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("leaves the selection alone for a point outside every region", () => {
    harness.debug.setMenuIndex(1);
    harness.pointerMove(20, 20);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms a press and a release inside one item", () => {
    const at = itemCenter(harness, 2); // HOW TO PLAY
    harness.pointerDown(at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title"); // the press alone confirms nothing

    harness.pointerUp(at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("howto");
    expect(harness.state.titleIndex).toBe(2);
  });

  it("confirms when the press and the release arrive on one frame", () => {
    const at = itemCenter(harness, 1); // VERSUS
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release fall in different items", () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 2);
    harness.pointerDown(from.x, from.y);
    harness.run(1);
    harness.pointerMove(to.x, to.y);
    harness.run(1);
    harness.pointerUp(to.x, to.y);
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2); // the travel still selected
  });

  it("confirms nothing for a gesture outside every region", () => {
    harness.pointerDown(20, 20);
    harness.run(1);
    harness.pointerUp(20, 20);
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
  });

  it("drives the pause menu as well as the title", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    harness.tap("KeyP");
    harness.run(1);

    const at = itemCenter(harness, 0); // RESUME
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("leaves the selection where the pointer put it, over a keyboard move", () => {
    const at = itemCenter(harness, 2);
    harness.tap("ArrowDown"); // would move to 1
    harness.pointerMove(at.x, at.y); // but the pointer named 2
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", () => {
    const at = itemCenter(harness, 2); // HOW TO PLAY, under the pointer
    harness.tap("Enter"); // SOLO, at menuIndex 0
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    harness.run(1);

    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.titleIndex).toBe(0);
  });
});

describe("the menus under a finger", () => {
  it("selects on the landing, because a finger does not hover", () => {
    const at = itemCenter(harness, 1);
    harness.touchStart(at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms a contact that lands and lifts inside one item", () => {
    const at = itemCenter(harness, 1); // VERSUS
    harness.touchStart(at.x, at.y);
    harness.run(1);
    harness.touchEnd(at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.titleIndex).toBe(1);
  });

  it("selects an item the contact travels onto", () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 2);
    harness.touchStart(from.x, from.y);
    harness.run(1);
    harness.touchMove(to.x, to.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms nothing when the landing and the lift are different items", () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 2);
    harness.touchStart(from.x, from.y);
    harness.run(1);
    harness.touchMove(to.x, to.y);
    harness.run(1);
    harness.touchEnd(to.x, to.y);
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms nothing for a lift with no landing behind it", () => {
    const at = itemCenter(harness, 1);
    harness.touchEnd(at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });
});
