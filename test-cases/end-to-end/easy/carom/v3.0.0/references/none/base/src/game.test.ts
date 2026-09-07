// Carom over its own runtime, in process.
//
// Every check here stands the real runtime up over an `@napi-rs/canvas` canvas
// and a `Surface` of its own, so the game runs with no browser and no document
// behind it, and steps it with `advance` — which makes a duration an exact number
// of frames of an exact length, and the arithmetic asserted below the arithmetic
// specs/ names. What is read back is the game's own state, the cues its update
// played, the pixels its render produced, and the surface's own readings.
//
// THE INPUT IS REAL. Keys arrive as key events dispatched at the surface's event
// target and the mouse and the finger as pointer events, so what is exercised is
// the whole path from an event to a menu rather than a posed intention.
//
// The runtime itself is checked in `src/runtime.test.ts`; this file is the game.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BALL_R,
  CUES,
  DEFAULT_SEED,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_ANGLE,
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
import { game } from "./game";
import { createRuntime, type Game, type Runtime } from "./runtime";
import type { CaromState, Mode } from "./state";
import { COLOR, HOWTO_ITEMS } from "./theme";
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
  /** Dispatch one pointer event at a logical position. */
  point(type: "down" | "move" | "up" | "cancel", x: number, y: number): void;
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

/** A `PointerEvent`-shaped event: the runtime reads the id and the position. */
class PointerEventLike extends Event {
  readonly pointerId = 1;
  readonly clientX: number;
  readonly clientY: number;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
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

/** A `#rrggbb` theme color as the opaque pixel `getImageData` reads back. */
function rgba(hex: string): [number, number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
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
  // The canvas is the field's own size at the page's origin, so a logical point
  // and the position an event carries are the same number and a check can aim at
  // a region the surface reported without converting anything.
  const surface: Surface = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    origin: () => ({ x: 0, y: 0 }),
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
          pointer: api.pointer,
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
    background: COLOR.bg,
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
    point: (type, x, y) => {
      events.dispatchEvent(new PointerEventLike(`pointer${type}`, x, y));
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

// ---- Sequences, assembled from the atomic operations --------------------
//
// The surface poses one field at a time (specs/instrumentation.md), so reaching a
// situation is a SEQUENCE of poses. The three below are the ones this file uses
// over and over, and they live here rather than on the surface for exactly the
// reason the specification gives.

/** Open a match on its pre-serve countdown, without driving the menus. */
function openCountdown(h: Harness, mode: Mode): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setScreen("countdown");
}

/** Open a match and let the build's own rule serve it into live play. */
function startPlaying(h: Harness, mode: Mode): void {
  openCountdown(h, mode);
  h.debug.setBallHoldTimer(0);
  h.run(1); // the hold elapses, and the game serves on that frame
}

/** Take the match to a live rally with the ball posed exactly as asked. */
function rally(
  h: Harness,
  mode: Mode,
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): void {
  startPlaying(h, mode);
  h.debug.setBallHeld(false);
  h.debug.setBallHoldTimer(0);
  h.debug.setBallPosition(ball.x, ball.y);
  h.debug.setBallVelocity(ball.vx, ball.vy);
  h.debug.setBallSpin(ball.spin ?? 0);
}

/** Take both paddles from the player, each holding a velocity. */
function takePaddles(h: Harness, vy = 0): void {
  for (const side of ["left", "right"] as const) {
    h.debug.setPaddleVy(side, vy);
    h.debug.setPaddleDriven(side, true);
  }
}

/** Run single frames until `done` holds, or until `limit` frames have run. */
function runUntil(h: Harness, done: () => boolean, limit = 120): boolean {
  for (let frame = 0; frame < limit; frame += 1) {
    if (done()) return true;
    h.run(1);
  }
  return done();
}

/** The center of the region the build reports for item `index`. */
function itemCenter(h: Harness, index: number): { x: number; y: number } {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) throw new Error(`no region for menu item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the pointer onto item `index` and run the frame that reads it. */
function pointerOnto(h: Harness, index: number): void {
  const at = itemCenter(h, index);
  h.point("move", at.x, at.y);
  h.run(1);
}

/** Press and release inside item `index`: two frames, as a real click is. */
function clickItem(h: Harness, index: number): void {
  const at = itemCenter(h, index);
  h.point("move", at.x, at.y);
  h.point("down", at.x, at.y);
  h.run(1);
  h.point("up", at.x, at.y);
  h.run(1);
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every field of the state present", () => {
    const opened = harness.debug.snapshot();
    expect(opened.screen).toBe("title");
    expect(opened.mode).toBe("solo");
    expect(opened.menuIndex).toBe(0);
    expect(opened.titleIndex).toBe(0);
    expect(opened.resumeScreen).toBe("playing");
    expect(opened.score).toEqual({ p1: 0, p2: 0 });
    expect(opened.winner).toBeNull();
    expect(opened.receiver).toBe("left");
    expect(opened.seed).toBe(DEFAULT_SEED);
    expect(opened.rngState).toBe(DEFAULT_SEED);
    expect(opened.simTime).toBe(0);
    for (const side of ["left", "right"] as const) {
      expect(opened.paddles[side]).toEqual({
        cy: FIELD_CY,
        vy: 0,
        drivenVy: 0,
        driven: false,
      });
    }
    expect(opened.ai).toEqual({ tracking: true, movement: true });
    expect(opened.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      speed: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
    expect(opened.obstacles).toEqual(
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

// ---- Menus, from the keyboard -------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", () => {
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.ball?.holdTimer).toBeCloseTo(HOLD_TIME - TICK, 9);
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
    harness.debug.setMenuIndex(2);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("leaves the how-to-play screen on confirm as well as on back", () => {
    harness.debug.setScreen("howto");
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("wraps the selection in both directions", () => {
    harness.tap("ArrowUp");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);

    harness.tap("ArrowDown");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("reads up before down, and movement before confirm, on one frame", () => {
    harness.tap("ArrowUp");
    harness.tap("ArrowDown");
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title");
  });

  it("ignores back on the title", () => {
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

// ---- The remembered title selection -------------------------------------

describe("the title selection", () => {
  it("remembers the item a match was started from", () => {
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.titleIndex).toBe(1);
  });

  it("puts the selection back on the item that led away from the title", () => {
    // VERSUS, then quit from the pause menu: the title reopens on VERSUS.
    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);
    harness.tap("KeyP");
    harness.run(1);
    harness.debug.setMenuIndex(2); // QUIT TO MENU
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.titleIndex).toBe(1);
  });

  it("restores it from the match-over screen and from how-to-play alike", () => {
    harness.debug.setTitleIndex(2);

    harness.debug.setScreen("matchover");
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);

    harness.debug.setScreen("howto");
    harness.debug.setMenuIndex(0);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("keeps its value across a match, which starts on the first item", () => {
    harness.debug.setTitleIndex(1);
    harness.debug.setScreen("matchover");
    harness.tap("Enter"); // PLAY AGAIN
    harness.run(1);
    expect(harness.state.menuIndex).toBe(0);
    expect(harness.state.titleIndex).toBe(1);
  });
});

// ---- Menus, from a mouse and a finger ------------------------------------

describe("the menus under a pointer", () => {
  it("selects the item the pointer moves onto", () => {
    pointerOnto(harness, 2);
    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title");
  });

  it("selects nothing while the pointer is off every item", () => {
    harness.debug.setMenuIndex(1);
    harness.point("move", 20, 20);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms an item pressed and released inside it", () => {
    clickItem(harness, 1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release fall in two items", () => {
    const from = itemCenter(harness, 0);
    harness.point("move", from.x, from.y);
    harness.point("down", from.x, from.y);
    harness.run(1);

    const to = itemCenter(harness, 2);
    harness.point("move", to.x, to.y);
    harness.point("up", to.x, to.y);
    harness.run(1);

    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms nothing when a press begins outside every item", () => {
    harness.point("down", 20, 20);
    harness.run(1);
    harness.point("up", 20, 20);
    harness.run(1);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms a press and its release arriving on one frame", () => {
    const at = itemCenter(harness, 2);
    harness.point("down", at.x, at.y);
    harness.point("up", at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("howto");
  });

  it("selects the item a contact lands on, which is how a finger arrives", () => {
    // No move first: a finger does not hover, so the landing is the first the
    // game hears of it.
    const at = itemCenter(harness, 1);
    harness.point("down", at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");

    harness.point("up", at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
  });

  it("leaves the selection where a pointer put it, over a keyboard move", () => {
    const at = itemCenter(harness, 2);
    harness.tap("ArrowDown"); // would select 1
    harness.point("move", at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", () => {
    const at = itemCenter(harness, 2); // HOW TO PLAY
    harness.point("down", at.x, at.y);
    harness.run(1);
    expect(harness.state.menuIndex).toBe(2);

    // The keyboard confirms HOW TO PLAY; the release that lands on the same
    // frame must not then confirm the how-to screen's own item as well.
    harness.tap("Enter");
    harness.point("up", at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("howto");
  });

  it("drops a press that a change of screen happened under", () => {
    const at = itemCenter(harness, 2);
    harness.point("down", at.x, at.y);
    harness.run(1);
    harness.tap("Enter"); // to how-to-play, with the press still down
    harness.run(1);
    harness.point("up", at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("howto");
  });

  it("works the pause menu the same way", () => {
    startPlaying(harness, "versus");
    harness.tap("KeyP");
    harness.run(1);
    clickItem(harness, 0); // RESUME
    expect(harness.state.screen).toBe("playing");
  });

  it("cancels a press the device took away", () => {
    const at = itemCenter(harness, 1);
    harness.point("down", at.x, at.y);
    harness.run(1);
    harness.point("cancel", at.x, at.y);
    harness.point("up", at.x, at.y);
    harness.run(1);
    expect(harness.state.screen).toBe("title");
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

    // Up is held on both sides and down on one: `up` and `down` are each 1.
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

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", () => {
    openCountdown(harness, "versus");
    harness.run(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.debug.snapshot().ball?.held).toBe(true);

    harness.run(2);
    expect(harness.state.screen).toBe("playing");
    expect(harness.debug.snapshot().ball?.held).toBe(false);
  });

  it("sends the first serve of a match toward player one", () => {
    openCountdown(harness, "versus");
    harness.run(frames(HOLD_TIME) + 1);
    const ball = harness.debug.snapshot().ball;
    expect(ball?.vx).toBeLessThan(0);
    expect(ball?.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("sends it toward the receiver the state names", () => {
    openCountdown(harness, "versus");
    harness.debug.setReceiver("right");
    harness.debug.setBallHoldTimer(0);
    harness.run(1);
    expect(harness.debug.snapshot().ball?.vx).toBeGreaterThan(0);
  });

  it("leaves at SERVE_ANGLE from horizontal, up or down", () => {
    startPlaying(harness, "versus");
    const ball = harness.debug.snapshot().ball;
    expect(Math.abs(ball?.vy ?? 0)).toBeGreaterThan(0);
    expect(
      Math.abs(Math.atan2(ball?.vy ?? 0, Math.abs(ball?.vx ?? 0))),
    ).toBeCloseTo(SERVE_ANGLE, 9);
  });

  it("replays the same serve from the same seed", () => {
    const other = createHarness();
    try {
      for (const h of [harness, other]) {
        h.debug.setSeed(4242);
        h.debug.setMode("versus");
        h.debug.setScreen("countdown");
        h.debug.setBallHoldTimer(0);
        h.run(1);
      }
      expect(other.debug.snapshot().ball?.vy).toBe(
        harness.debug.snapshot().ball?.vy,
      );
    } finally {
      other.dispose();
    }
  });

  it("does not serve a field with no ball on it", () => {
    openCountdown(harness, "versus");
    harness.debug.clearWorld();
    harness.run(frames(HOLD_TIME) + 6);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.debug.snapshot().ball).toBeNull();
  });
});

// ---- Physics, through the runtime ---------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", () => {
    rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.debug.setPaddleCy("left", FIELD_CY);
    harness.debug.setPaddleVy("left", 200);
    harness.debug.setPaddleDriven("left", true);
    harness.cues.length = 0;

    harness.run(6);

    expect(harness.cues).toEqual([CUES.paddleHit]);
    const ball = harness.debug.snapshot().ball;
    expect(ball?.vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 units per second when it struck.
    expect(ball?.spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball?.spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", () => {
    rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.wallBounce]);
    expect(harness.debug.snapshot().ball?.vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", () => {
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([CUES.obstacleBounce]);
    expect(harness.debug.snapshot().ball?.vx).toBeLessThan(0);
  });

  it("passes through an obstacle that has been taken off the field", () => {
    rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.debug.clearWorld();
    harness.debug.spawnBall();
    harness.debug.setBallHeld(false);
    harness.debug.setBallPosition(450, 220);
    harness.debug.setBallVelocity(600, 0);
    harness.cues.length = 0;

    harness.run(3);

    expect(harness.cues).toEqual([]);
    expect(harness.debug.snapshot().ball?.vx).toBe(600);
  });

  it("records a trail that spans a slice of time, not of frames", () => {
    // TRAIL_TIME is a window of TIME, so a finer step fills the same window with
    // more samples. Both harnesses cover the same third of a second.
    const pose = { x: 300, y: FIELD_CY, vx: 400, vy: 0 };
    rally(harness, "versus", pose);
    harness.run(20);
    const coarse = harness.debug.snapshot().ball?.trail.length ?? 0;

    const fine = createHarness();
    try {
      rally(fine, "versus", pose);
      fine.runtime.advance(20 / 60, 80); // four times as finely
      expect(fine.debug.snapshot().ball?.trail.length ?? 0).toBeGreaterThan(
        coarse,
      );
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

    // Read on the frame the point lands on, before the countdown it opens has
    // ticked the new hold down.
    expect(runUntil(harness, () => harness.state.score.p1 > 0, 10)).toBe(true);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(harness.cues).toEqual([CUES.score]);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.receiver).toBe("right");
    expect(harness.debug.snapshot().ball).toMatchObject({
      x: FIELD_CX,
      y: FIELD_CY,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });

    harness.run(frames(HOLD_TIME) + 1);
    expect(harness.debug.snapshot().ball?.vx).toBeGreaterThan(0);
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
    expect(harness.state.menuIndex).toBe(0);
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
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
  });

  it("returns to the title from MENU on the match-over screen", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);
    expect(harness.state.screen).toBe("matchover");

    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
    expect(harness.state.winner).toBeNull();
  });

  it("returns to the title from back on the match-over screen", () => {
    rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    harness.run(4);
    expect(harness.state.screen).toBe("matchover");
    const elapsed = harness.state.simTime;

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.simTime).toBeCloseTo(elapsed + TICK, 9);
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
    expect(harness.state.resumeScreen).toBe("playing");

    const frozen = harness.debug.snapshot();
    harness.run(60);
    expect(harness.debug.snapshot().ball?.x).toBe(frozen.ball?.x);

    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("opens on Escape and leaves the menu open on that same press", () => {
    // Escape raises `pause` and `back` together: during a match only `pause` is
    // read, so one press opens the menu and nothing closes it again.
    startPlaying(harness, "versus");
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.menuIndex).toBe(0);
  });

  it("resumes on Escape, once", () => {
    startPlaying(harness, "versus");
    harness.tap("Escape");
    harness.run(1);
    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("resumes to the countdown it was opened from", () => {
    openCountdown(harness, "versus");
    harness.run(6);
    const held = harness.state.ball?.holdTimer ?? 0;

    harness.tap("KeyP");
    harness.run(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.resumeScreen).toBe("countdown");

    harness.run(30); // the hold is frozen with the rest of the field
    expect(harness.state.ball?.holdTimer).toBe(held);

    harness.tap("Escape");
    harness.run(1);
    expect(harness.state.screen).toBe("countdown");
  });

  it("restarts the match in the current mode", () => {
    rally(harness, "solo", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.debug.setScore(4, 2);
    harness.tap("KeyP");
    harness.run(1);

    harness.tap("ArrowDown");
    harness.run(1);
    harness.tap("Enter");
    harness.run(1);

    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
  });

  it("quits to the title from the pause menu", () => {
    rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    harness.run(1);

    harness.debug.setMenuIndex(2);
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

  it("survives a reset, because muting is the player's rather than the state's", () => {
    harness.tap("KeyM");
    harness.run(1);
    harness.debug.reset();
    harness.run(1);
    expect(harness.debug.snapshot().muted).toBe(true);
  });
});

// ---- Drawing ------------------------------------------------------------

describe("rendering", () => {
  it("fills each paddle in its own color", () => {
    openCountdown(harness, "versus");
    harness.run(1);

    expect(harness.pixel(P1_X0 + PADDLE_W / 2, FIELD_CY)).toEqual(
      rgba(COLOR.p1),
    );
    expect(harness.pixel(FIELD_W - P1_X0 - PADDLE_W / 2, FIELD_CY)).toEqual(
      rgba(COLOR.p2),
    );
  });

  it("draws each score as its own number", () => {
    openCountdown(harness, "versus");
    harness.debug.setScore(7, 9);
    harness.calls.length = 0;
    harness.run(1);

    const drawn = callsTo(harness.calls, "fillText").map(([text]) => text);
    expect(drawn).toContain("7");
    expect(drawn).toContain("9");
  });

  it("draws the ball as one arc at its own position", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    harness.run(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].slice(0, 3)).toEqual([400, 300, BALL_R]);
    expect(harness.pixel(400, 300)).toEqual(rgba(COLOR.ball));
  });

  it("draws no ball and no obstacle once the field has been cleared", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.debug.clearWorld();
    harness.calls.length = 0;
    harness.run(1);

    expect(callsTo(harness.calls, "arc")).toHaveLength(0);
    const obstacle = OBSTACLE_CENTERS[0];
    expect(harness.pixel(obstacle.x, obstacle.y)).toEqual(rgba(COLOR.bg));
  });

  it("draws every menu item where the surface says it is", () => {
    harness.run(1);
    const drawn = callsTo(harness.calls, "fillText").map(([text, , y]) => ({
      text,
      y,
    }));
    for (const [index, item] of ["SOLO", "VERSUS", "HOW TO PLAY"].entries()) {
      const rect = harness.debug.menuItemRect(index);
      expect(rect).not.toBeNull();
      const at = drawn.find((call) => call.text === item);
      expect(at).toBeDefined();
      expect(at?.y).toBeCloseTo((rect?.y ?? 0) + (rect?.h ?? 0) / 2, 6);
    }
  });

  it("draws the how-to screen's one item, as the other menus draw theirs", () => {
    harness.debug.setScreen("howto");
    harness.calls.length = 0;
    harness.run(1);
    const drawn = callsTo(harness.calls, "fillText").map(([text]) => text);
    expect(drawn).toContain(HOWTO_ITEMS[0]);
  });

  it("draws in logical coordinates whatever size the surface is", () => {
    openCountdown(harness, "versus");
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

// ---- The debug surface --------------------------------------------------

describe("window.__carom", () => {
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

  it("reports back every field its poses set", () => {
    const { debug } = harness;
    debug.setScreen("paused");
    debug.setMode("versus");
    debug.setMenuIndex(2);
    debug.setTitleIndex(1);
    debug.setResumeScreen("countdown");
    debug.setScore(3, 4);
    debug.setWinner("right");
    debug.setReceiver("right");
    debug.setSeed(99);
    debug.setPaddleCy("left", 200);
    debug.setPaddleVy("left", 150);
    debug.setPaddleDriven("left", true);
    debug.setBallPosition(300, 400);
    debug.setBallVelocity(60, 80);
    debug.setBallSpin(-40);
    debug.setBallHeld(false);
    debug.setBallHoldTimer(0.25);
    debug.setAiTracking(false);
    debug.setAiMovement(false);
    debug.reconcile();

    const posed = debug.snapshot();
    expect(posed).toMatchObject({
      version: 1,
      screen: "paused",
      mode: "versus",
      menuIndex: 2,
      titleIndex: 1,
      resumeScreen: "countdown",
      score: { p1: 3, p2: 4 },
      winner: "right",
      receiver: "right",
      seed: 99,
      rngState: 99,
      ai: { tracking: false, movement: false },
      autoStep: true,
    });
    expect(posed.paddles.left).toEqual({
      cy: 200,
      vy: 0,
      drivenVy: 150,
      driven: true,
    });
    expect(posed.paddles.right.driven).toBe(false);
    expect(posed.ball).toMatchObject({
      x: 300,
      y: 400,
      vx: 60,
      vy: 80,
      speed: 100,
      spin: -40,
      held: false,
      holdTimer: 0.25,
    });
  });

  it("drives one paddle and leaves the other to whoever had it", () => {
    startPlaying(harness, "versus");
    harness.debug.setPaddleVy("left", 300);
    harness.debug.setPaddleDriven("left", true);

    harness.hold("KeyW"); // ignored: the left paddle is driven
    harness.hold("ArrowDown"); // player two still has the right one
    harness.run(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("holds a driven velocity across frames, and reports it apart from vy", () => {
    startPlaying(harness, "versus");
    harness.debug.setPaddleVy("right", 240);
    // Set while the paddle is nobody's to move: `vy` is still zero.
    expect(harness.debug.snapshot().paddles.right).toMatchObject({
      vy: 0,
      drivenVy: 240,
    });

    harness.debug.setPaddleDriven("right", true);
    harness.run(1);
    expect(harness.debug.snapshot().paddles.right).toMatchObject({
      vy: 240,
      drivenVy: 240,
    });
  });

  it("hands a paddle back, with the velocity it was driven at left behind", () => {
    startPlaying(harness, "versus");
    takePaddles(harness, 300);
    harness.run(frames(0.1));
    harness.debug.setPaddleDriven("left", false);
    const parked = harness.state.paddles.left.cy;

    harness.run(frames(0.1)); // nothing is held, so the player's paddle stands
    expect(harness.state.paddles.left.cy).toBe(parked);
    expect(harness.debug.snapshot().paddles.left.drivenVy).toBe(300);
  });

  it("runs the real AI against a posed shot, faculty by faculty", () => {
    rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", 600);

    harness.debug.setAiMovement(false);
    harness.run(30);
    expect(harness.state.paddles.right.cy).toBe(600);

    harness.debug.setAiMovement(true);
    harness.run(30);
    expect(harness.state.paddles.right.cy).toBeLessThan(600);
  });

  it("empties the field and spawns its bodies back one at a time", () => {
    harness.debug.clearWorld();
    expect(harness.debug.snapshot().ball).toBeNull();
    expect(harness.debug.snapshot().obstacles).toEqual([]);

    harness.debug.spawnObstacle(1);
    expect(harness.debug.snapshot().obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);

    harness.debug.spawnObstacle(0);
    expect(
      harness.debug.snapshot().obstacles.map((obstacle) => obstacle.index),
    ).toEqual([0, 1]);

    harness.debug.spawnBall();
    expect(harness.debug.snapshot().ball).toMatchObject({
      x: FIELD_CX,
      y: FIELD_CY,
      held: true,
      holdTimer: HOLD_TIME,
    });
  });

  it("fails on an index this field has no obstacle for", () => {
    harness.debug.clearWorld();
    expect(() => harness.debug.spawnObstacle(7)).toThrow();
    expect(harness.debug.snapshot().obstacles).toEqual([]);
  });

  // An absent ball is no ball to pose. A surface that quietly did nothing would
  // let a caller read its own pose back off a field that never took it, so every
  // ball operation fails where the caller can see it instead.
  it("fails loudly when a ball pose names no ball", () => {
    harness.debug.clearWorld();
    expect(() => harness.debug.setBallPosition(100, 100)).toThrow();
    expect(() => harness.debug.setBallVelocity(10, 10)).toThrow();
    expect(() => harness.debug.setBallSpin(10)).toThrow();
    expect(() => harness.debug.setBallHeld(false)).toThrow();
    expect(() => harness.debug.setBallHoldTimer(0)).toThrow();
    expect(harness.debug.snapshot().ball).toBeNull();
  });

  // `reconcile` is required of every build. This one works every derived reading
  // out at the read, so the call has nothing to rewrite — which is exactly what
  // these two assert: the readings agree with the pose, and nothing moved.
  it("re-derives a reading from a posed velocity", () => {
    harness.debug.spawnBall();
    harness.debug.setBallVelocity(30, 40);
    harness.debug.reconcile();
    expect(harness.debug.snapshot().ball?.speed).toBeCloseTo(50, 10);
  });

  it("advances nothing", () => {
    rally(harness, "versus", { x: 400, y: 300, vx: 250, vy: -120 });
    harness.debug.setPaddleCy("left", 240);
    harness.debug.setBallHoldTimer(0.4);

    const before = harness.debug.snapshot();
    harness.debug.reconcile();
    const once = harness.debug.snapshot();
    harness.debug.reconcile();
    const twice = harness.debug.snapshot();

    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });

  it("returns the whole state to the title on reset", () => {
    rally(harness, "solo", { x: 300, y: 200, vx: 400, vy: 0 });
    harness.debug.setScore(3, 5);
    harness.debug.setTitleIndex(2);
    harness.debug.setSeed(77);
    takePaddles(harness, 300);
    harness.debug.setAiTracking(false);
    harness.debug.clearWorld();

    harness.debug.reset();

    const title = harness.debug.snapshot();
    expect(title).toMatchObject({
      screen: "title",
      mode: "solo",
      menuIndex: 0,
      titleIndex: 0,
      resumeScreen: "playing",
      score: { p1: 0, p2: 0 },
      winner: null,
      receiver: "left",
      seed: DEFAULT_SEED,
      rngState: DEFAULT_SEED,
      simTime: 0,
      ai: { tracking: true, movement: true },
    });
    expect(title.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(title.ball).toMatchObject({ held: true, holdTimer: HOLD_TIME });
    expect(title.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
  });

  it("reports the region of each item of the menu on screen", () => {
    const first = harness.debug.menuItemRect(0);
    const second = harness.debug.menuItemRect(1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.w).toBeGreaterThan(0);
    expect(first?.h).toBeGreaterThan(0);
    // Stacked, and never overlapping, so a point names one item at most.
    expect((second?.y ?? 0) >= (first?.y ?? 0) + (first?.h ?? 0)).toBe(true);
    expect(harness.debug.menuItemRect(3)).toBeNull();
  });

  it("reports no region on the two screens that show no menu", () => {
    harness.debug.setScreen("playing");
    expect(harness.debug.menuItemRect(0)).toBeNull();
    harness.debug.setScreen("countdown");
    expect(harness.debug.menuItemRect(0)).toBeNull();
    harness.debug.setScreen("howto");
    expect(harness.debug.menuItemRect(0)).not.toBeNull();
    expect(harness.debug.menuItemRect(1)).toBeNull();
  });

  it("hands out a snapshot nothing can write back through", () => {
    rally(harness, "versus", { x: 300, y: 300, vx: 100, vy: 0 });
    harness.run(4);
    const snapshot = harness.debug.snapshot();
    snapshot.ball?.trail.push({ x: 0, y: 0, t: 0 });
    expect(harness.debug.snapshot().ball?.trail).not.toEqual(
      snapshot.ball?.trail,
    );
  });
});

// ---- The clock the surface owns -----------------------------------------

describe("the manual clock", () => {
  it("stops the game advancing itself, and advance moves it on instead", () => {
    harness.debug.setAutoStep(false);
    expect(harness.runtime.autoStep()).toBe(false);
    expect(harness.debug.snapshot().autoStep).toBe(false);

    startPlaying(harness, "versus");
    const before = harness.debug.snapshot().simTime;

    harness.debug.advance(1, 60);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 1, 9);

    harness.debug.setAutoStep(true);
    expect(harness.runtime.autoStep()).toBe(true);
  });

  it("is left alone by a reset, because it is the clock's and not the state's", () => {
    harness.debug.setAutoStep(false);
    harness.debug.reset();
    expect(harness.debug.snapshot().autoStep).toBe(false);
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
    expect(harness.state.paddles.left.driven).toBe(false);

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
        h.debug.setSeed(7);
        rally(h, "versus", pose);
      }
      coarse.debug.advance(0.5, 1);
      fine.debug.advance(0.5, 60);

      const a = coarse.debug.snapshot().ball;
      const b = fine.debug.snapshot().ball;
      // A curving path is integrated, so "the same place" is the same place to
      // within the sub-step resolution rather than bit for bit.
      expect(
        Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0)),
      ).toBeLessThan(4);
      expect(a?.spin).toBeCloseTo(b?.spin ?? 0, 6);
      expect(a?.speed).toBeCloseTo(b?.speed ?? 0, 6);
    } finally {
      coarse.dispose();
      fine.dispose();
    }
  });
});
