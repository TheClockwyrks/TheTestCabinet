// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` — which
// makes a duration a frame count and the arithmetic asserted here the arithmetic
// specs/ names. What is read back is the game's own state — `engine.state`, the
// value the most recent frame left — the debug surface the game returned beside
// its opening state, the engine's events, and the pixels the render produced.
//
// The surface's poses are transitions, so a check drives one through
// `engine.apply((s) => engine.debug.setScreen(s, "countdown"))` and its readings
// through `engine.debug.snapshot(engine.state)`; the harness wraps both.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_ANGLE,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import type { BallSnapshot, CaromDebugApi, CaromSnapshot } from "./debug";
import { BACKGROUND, game, type CaromState, type Mode } from "./game";
import { itemCenter, TITLE_MENU } from "./menus";
import type { Transition } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

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

/** How a dispatched pointer event names itself. */
interface PointerOptions {
  device?: "mouse" | "pen" | "touch";
  id?: number;
  primary?: boolean;
}

interface Harness {
  readonly engine: Engine<CaromState, CaromDebugApi>;
  /** The current state: what the most recent frame or pose left. */
  readonly state: DeepReadonly<CaromState>;
  readonly debug: CaromDebugApi;
  /** Pose the game between frames through the surface's transitions. */
  apply(transition: Transition<CaromState>): DeepReadonly<CaromState>;
  /** The surface's reading of the current state. */
  snapshot(): CaromSnapshot;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  /** Move a pointer to a logical point without pressing anything. */
  movePointer(x: number, y: number, options?: PointerOptions): void;
  /** Press a pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): void;
  /** Release a pointer at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): void;
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

/** Exactly the fields the engine's pointer listeners read (`engine/input.md`). */
class PointerLikeEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    fields: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      button: number;
      buttons: number;
    },
  ) {
    super(type);
    this.clientX = fields.clientX;
    this.clientY = fields.clientY;
    this.pointerId = fields.pointerId;
    this.pointerType = fields.pointerType;
    this.isPrimary = fields.isPrimary;
    this.button = fields.button;
    this.buttons = fields.buttons;
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
  const engine = createEngine<CaromState, CaromDebugApi>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
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

  await engine.initialize();
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const point = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    button: number,
    buttons: number,
    options: PointerOptions,
  ): void => {
    events.dispatchEvent(
      new PointerLikeEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: options.id ?? 1,
        pointerType: options.device ?? "mouse",
        isPrimary: options.primary ?? true,
        button,
        buttons,
      }),
    );
  };

  return {
    engine,
    // Read off the engine at every access rather than captured once: each frame
    // replaces the value, so the state `initialize` resolved to is the opening
    // state and nothing more.
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here: `initialize` returns the
    // surface beside the state, so reaching it this way is what makes that return
    // load-bearing — a build that returned none fails here rather than being
    // handed a surface this file constructed for it.
    debug: engine.debug,
    apply: (transition) => engine.apply(transition),
    snapshot: () => engine.debug.snapshot(engine.state),
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
    movePointer: (x, y, options = {}) =>
      point("pointermove", x, y, -1, 0, options),
    pressPointer: (x, y, options = {}) =>
      point("pointerdown", x, y, 0, 1, options),
    releasePointer: (x, y, options = {}) =>
      point("pointerup", x, y, 0, 0, options),
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

// ---- Arrangements, from atomic poses ------------------------------------

/**
 * A match opened on its pre-serve countdown, taking NOTHING from the player.
 *
 * `reset` puts every declared field at its title value, and the mode and the
 * screen are all that is left to say — which is the whole point of an atomic
 * surface: no arrangement seizes a paddle, gates a faculty, or empties the field
 * unless the check asks it to.
 */
function openMatch(h: Harness, mode: Mode): void {
  h.apply((s) => h.debug.reset(s));
  h.apply((s) => h.debug.setMode(s, mode));
  h.apply((s) => h.debug.setScreen(s, "countdown"));
}

/** Take the match to a live rally with the ball posed exactly as asked. */
async function rally(
  h: Harness,
  mode: Mode,
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): Promise<void> {
  openMatch(h, mode);
  // The SERVE is the build's own: ending the hold is all a pose does.
  h.apply((s) => h.debug.setBallHoldTimer(s, 0));
  await h.engine.advance(1);
  h.apply((s) => h.debug.setBallPosition(s, ball.x, ball.y));
  h.apply((s) => h.debug.setBallVelocity(s, ball.vx, ball.vy));
  h.apply((s) => h.debug.setBallSpin(s, ball.spin ?? 0));
}

/** The ball a snapshot reports, refusing a field that carries none. */
function ballOf(h: Harness): BallSnapshot {
  const { ball } = h.snapshot();
  if (!ball) throw new Error("the field carries no ball");
  return ball;
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

/** The center of title item `index`, where a pointer selects it. */
function titleItem(index: number): { x: number; y: number } {
  return itemCenter(TITLE_MENU, index);
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every field of the state present", () => {
    const s = harness.snapshot();
    expect(s.version).toBe(1);
    expect(s.screen).toBe("title");
    expect(s.mode).toBe("solo");
    expect(s.menuIndex).toBe(0);
    expect(s.titleIndex).toBe(0);
    expect(s.resumeScreen).toBe("playing");
    expect(s.score).toEqual({ p1: 0, p2: 0 });
    expect(s.winner).toBeNull();
    expect(s.receiver).toBe("left");
    expect(Math.abs(s.ball?.serveSign ?? 0)).toBe(1);
    expect(s.ai).toEqual({ tracking: true, movement: true });
    expect(s.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(s.paddles.right).toEqual(s.paddles.left);
    expect(s.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      speed: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      serveSign: expect.any(Number),
      trail: [],
    });
    expect(s.obstacles.map((o) => o.index)).toEqual([0, 1]);
    expect(s.obstacles[0].cy).toBeCloseTo(OBSTACLE_CENTERS[0].y, 9);
    expect(s.obstacles[0].theta).toBe(0);
    expect(s.obstacleClock).toBe(0);
    expect(s.obstacleClockRunning).toBe(true);
    expect(s.simTime).toBe(0);
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
  function engineWithLayout(
    layout?: string,
  ): Engine<CaromState, CaromDebugApi> {
    const canvas = createCanvas(FIELD_W, FIELD_H);
    const ctx = canvas.getContext("2d");
    const element = Object.assign(canvas, {
      style: {} as CSSStyleDeclaration,
      getContext: () => ctx,
    }) as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    return createEngine<CaromState, CaromDebugApi>({
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

// ---- Menus, from the keyboard -------------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
    expect(ballOf(harness).holdTimer).toBeCloseTo(HOLD_TIME - 1 / 60, 9);
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("wraps both ways over the title items", async () => {
    harness.tap("ArrowUp");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(TITLE_MENU.items.length - 1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("moves only, on a frame carrying both a movement and a confirm edge", async () => {
    harness.tap("ArrowDown");
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.screen).toBe("title");
  });

  it("moves up only, on a frame carrying both an up and a down edge", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowUp");
    harness.tap("ArrowDown");
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
    expect(harness.state.menuIndex).toBe(0);

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

// ---- The remembered title selection --------------------------------------

describe("the remembered title selection", () => {
  it("remembers the entry that led away and highlights it on the way back", async () => {
    harness.tap("ArrowDown"); // VERSUS
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().titleIndex).toBe(1);

    // Pause, then QUIT TO MENU.
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.titleIndex).toBe(1);
  });

  it("keeps it across leaving the how-to screen", async () => {
    harness.apply((s) => harness.debug.setTitleIndex(s, 2));
    harness.apply((s) => harness.debug.setMenuIndex(s, 0));
    harness.apply((s) => harness.debug.setScreen(s, "howto"));

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("forgets it on reset, which is a title of its own", () => {
    harness.apply((s) => harness.debug.setTitleIndex(s, 2));
    harness.apply((s) => harness.debug.reset(s));
    expect(harness.snapshot().titleIndex).toBe(0);
    expect(harness.snapshot().menuIndex).toBe(0);
  });
});

// ---- Menus, from a mouse and a finger -------------------------------------

describe("the menus under a pointer", () => {
  it("reports each item's hit region, and none where there is no menu", () => {
    const rect = harness.debug.menuItemRect(harness.state, 1);
    expect(rect).not.toBeNull();
    const center = titleItem(1);
    expect(rect?.x).toBeCloseTo(center.x - (rect?.w ?? 0) / 2, 9);
    expect(rect?.y).toBeCloseTo(center.y - (rect?.h ?? 0) / 2, 9);

    expect(harness.debug.menuItemRect(harness.state, 3)).toBeNull();
    expect(harness.debug.menuItemRect(harness.state, -1)).toBeNull();

    const playing = harness.apply((s) => harness.debug.setScreen(s, "playing"));
    expect(harness.debug.menuItemRect(playing, 0)).toBeNull();
  });

  it("selects the item a pointer moves onto", async () => {
    const item = titleItem(2);
    harness.movePointer(item.x, item.y);
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("leaves the highlight alone when the pointer leaves the menu", async () => {
    const item = titleItem(1);
    harness.movePointer(item.x, item.y);
    await harness.engine.advance(1);
    harness.movePointer(40, 40);
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms on a press and release inside one item, both on one frame", async () => {
    const item = titleItem(1); // VERSUS
    harness.pressPointer(item.x, item.y);
    harness.releasePointer(item.x, item.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release land on different items", async () => {
    const from = titleItem(0);
    const to = titleItem(1);
    harness.pressPointer(from.x, from.y);
    await harness.engine.advance(1);
    harness.movePointer(to.x, to.y);
    await harness.engine.advance(1);
    harness.releasePointer(to.x, to.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms nothing when an edge falls outside every region", async () => {
    const item = titleItem(0);
    harness.pressPointer(item.x, item.y);
    await harness.engine.advance(1);
    harness.releasePointer(20, 20);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("selects on a touch landing, because a finger does not hover", async () => {
    const item = titleItem(2);
    harness.pressPointer(item.x, item.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);

    harness.releasePointer(item.x, item.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("howto");
  });

  it("keeps a second contact from stealing the first one's press", async () => {
    const first = titleItem(0);
    const second = titleItem(1);
    harness.pressPointer(first.x, first.y, { device: "touch", id: 11 });
    await harness.engine.advance(1);
    harness.pressPointer(second.x, second.y, {
      device: "touch",
      id: 12,
      primary: false,
    });
    await harness.engine.advance(1);
    // The first contact lifts where it landed, so ITS item is the one confirmed.
    harness.releasePointer(first.x, first.y, { device: "touch", id: 11 });
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
  });

  it("ends on the item the pointer named when a key moved the selection too", async () => {
    const item = titleItem(2);
    harness.tap("ArrowDown"); // the keyboard says 1
    harness.movePointer(item.x, item.y); // the pointer says 2
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", async () => {
    const item = titleItem(1);
    harness.tap("Enter"); // the keyboard confirms SOLO, at menuIndex 0
    harness.pressPointer(item.x, item.y);
    harness.releasePointer(item.x, item.y);
    await harness.engine.advance(1);
    expect(harness.state.mode).toBe("solo");
    expect(harness.snapshot().titleIndex).toBe(0);
  });

  it("drives the pause menu the same way", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    const quit = harness.debug.menuItemRect(harness.state, 2);
    expect(quit).not.toBeNull();
    const x = (quit?.x ?? 0) + (quit?.w ?? 0) / 2;
    const y = (quit?.y ?? 0) + (quit?.h ?? 0) / 2;
    harness.pressPointer(x, y);
    harness.releasePointer(x, y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
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

  it("reads both up actions as one up in Solo", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    // Two ups and one down is up = 1, down = 1: the paddle stands still rather
    // than summing the sliders.
    harness.hold("KeyW");
    harness.hold("ArrowUp");
    harness.hold("KeyS");
    await harness.engine.advance(30);
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);

    harness.release("KeyS");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
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
    openMatch(harness, "versus");
    await harness.engine.advance(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(ballOf(harness).held).toBe(true);

    await harness.engine.advance(2);
    expect(harness.state.screen).toBe("playing");
    expect(ballOf(harness).held).toBe(false);
  });

  it("sends the first serve of a match toward player one", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(frames(HOLD_TIME) + 1);
    const ball = ballOf(harness);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("leaves at exactly SERVE_ANGLE from horizontal", async () => {
    openMatch(harness, "versus");
    harness.apply((s) => harness.debug.setBallHoldTimer(s, 0));
    await harness.engine.advance(1);
    const ball = ballOf(harness);
    // The deviation from horizontal, whichever way the serve is travelling.
    expect(Math.abs(Math.atan2(ball.vy, Math.abs(ball.vx)))).toBeCloseTo(
      SERVE_ANGLE,
      9,
    );
  });

  it("does not advance the ball on the frame it is served", async () => {
    openMatch(harness, "versus");
    harness.apply((s) => harness.debug.setBallHoldTimer(s, 0));
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
    expect(ballOf(harness).x).toBe(FIELD_CX);
    expect(ballOf(harness).y).toBe(FIELD_CY);
    expect(ballOf(harness).trail).toEqual([]);
  });

  it("serves with the sign the ball holds, and leaves it as it is", async () => {
    for (const sign of [-1, 1] as const) {
      openMatch(harness, "versus");
      harness.apply((s) => harness.debug.setBallServeSign(s, sign));
      harness.apply((s) => harness.debug.setBallHoldTimer(s, 0));
      await harness.engine.advance(1);
      expect(Math.sign(ballOf(harness).vy)).toBe(sign);
      expect(ballOf(harness).serveSign).toBe(sign);
    }
  });

  it("draws the serve sign afresh whenever the ball is parked", () => {
    const signs = new Set<number>();
    for (let i = 0; i < 200 && signs.size < 2; i++) {
      harness.apply((s) => harness.debug.spawnBall(s));
      signs.add(ballOf(harness).serveSign);
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });
});

// ---- Physics, through the engine ----------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.apply((s) => harness.debug.setPaddleCy(s, "left", FIELD_CY));
    harness.apply((s) => harness.debug.setPaddleVy(s, "left", 200));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.cues.length = 0;

    await harness.engine.advance(6);

    expect(played(harness)).toEqual([CUES.paddleHit]);
    const ball = ballOf(harness);
    expect(ball.vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 units per second when it struck.
    expect(ball.spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball.spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", async () => {
    await rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.wallBounce]);
    expect(ballOf(harness).vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.apply((s) => harness.debug.setObstacleClockRunning(s, false));
    harness.apply((s) => harness.debug.setObstacleClock(s, 0));
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.obstacleBounce]);
    expect(ballOf(harness).vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(60);
    const slow = ballOf(harness).trail.length;

    const fast = await createHarness(new ConstantClock(1000 / 240));
    try {
      await rally(fast, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
      await fast.engine.advance(240);
      expect(ballOf(fast).trail.length).toBeGreaterThan(slow);
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
      for (const h of [harness, fast]) {
        h.apply((s) => h.debug.setObstacleClockRunning(s, false));
        h.apply((s) => h.debug.setObstacleClock(s, 0));
      }

      await harness.engine.advance(30); // 0.5 s at 60 Hz
      await fast.engine.advance(120); // 0.5 s at 240 Hz

      const slowBall = ballOf(harness);
      const fastBall = ballOf(fast);
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
    expect(ballOf(harness).vx).toBeGreaterThan(0);
  });

  it("gives the point to player two when the ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    await harness.engine.advance(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
    expect(harness.state.receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );

    await harness.engine.advance(4);

    expect(harness.state.score.p1).toBe(WIN_SCORE);
    expect(harness.state.winner).toBe("left");
    expect(harness.state.screen).toBe("matchover");
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 1),
    );

    await harness.engine.advance(4);

    expect(harness.state.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 1 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.screen).toBe("countdown");
  });

  it("offers a rematch from the match-over screen", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
  });

  it("returns to the title from the match-over screen on Escape", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);
    expect(harness.state.screen).toBe("matchover");
    const simTime = harness.state.simTime;

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.obstacleClock).toBe(0);
    // Time carries on across the transition.
    expect(harness.state.simTime).toBeCloseTo(simTime + 1 / 60, 9);
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

    const frozen = harness.snapshot();
    await harness.engine.advance(60);
    const still = harness.snapshot();
    expect(ballOf(harness).x).toBe(frozen.ball?.x);
    expect(still.obstacleClock).toBe(frozen.obstacleClock);
    // Time itself never stops.
    expect(still.simTime).toBeGreaterThan(frozen.simTime);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("opens on Escape and stays open, though Escape raises `back` too", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");
    await harness.engine.advance(5);
    expect(harness.state.screen).toBe("paused");
  });

  it("resumes exactly once on one Escape", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("resumes to the countdown it interrupted", async () => {
    openMatch(harness, "versus");
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().resumeScreen).toBe("countdown");
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
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

  it("is left alone by a reset", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    harness.apply((s) => harness.debug.reset(s));
    await harness.engine.advance(1);
    expect(harness.snapshot().muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  it("takes one paddle and leaves the other under its player", async () => {
    openMatch(harness, "versus");
    harness.apply((s) => harness.debug.setPaddleVy(s, "left", 300));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "left", true));
    expect(harness.snapshot().paddles.left.driven).toBe(true);
    expect(harness.snapshot().paddles.right.driven).toBe(false);
    // `setPaddleVy` sets `drivenVy` alone; `vy` is what a frame integrates.
    expect(harness.snapshot().paddles.left.drivenVy).toBe(300);
    expect(harness.snapshot().paddles.left.vy).toBe(0);

    harness.hold("KeyW"); // ignored: the surface has this paddle
    harness.hold("ArrowDown"); // the right paddle is still player two's
    await harness.engine.advance(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.snapshot().paddles.left.vy).toBe(300);
    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("hands a paddle back without touching the other", async () => {
    openMatch(harness, "versus");
    harness.apply((s) => harness.debug.setPaddleVy(s, "left", 300));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "left", false));

    harness.hold("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.state.paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
    // The velocity it was posed with is still there, unused.
    expect(harness.snapshot().paddles.left.drivenVy).toBe(300);
  });

  it("releases both paddles on reset", () => {
    harness.apply((s) => harness.debug.setPaddleVy(s, "right", 120));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "right", true));
    harness.apply((s) => harness.debug.reset(s));
    const { paddles } = harness.snapshot();
    expect(paddles.right).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
  });

  it("runs the real AI against a posed shot on the side it did not take", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.apply((s) => harness.debug.setPaddleVy(s, "left", 0));
    harness.apply((s) => harness.debug.setPaddleDriven(s, "left", true));

    await harness.engine.advance(30);

    const { paddles } = harness.snapshot();
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // still the surface's
  });

  it("gates the AI's two faculties on their own", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.apply((s) => harness.debug.setAiTracking(s, false));
    await harness.engine.advance(20);
    // Blind, but not lame: it walks home rather than to the ball.
    const blind = harness.snapshot();
    expect(blind.ai).toEqual({ tracking: false, movement: true });
    expect(blind.paddles.right.cy).toBeLessThan(600);
    expect(blind.paddles.right.cy).toBeGreaterThan(180);

    harness.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.apply((s) => harness.debug.setAiMovement(s, false));
    await harness.engine.advance(20);
    const frozen = harness.snapshot();
    expect(frozen.paddles.right.cy).toBe(600);
    expect(frozen.paddles.right.vy).toBe(0);
  });

  it("empties the field, and spawns each entity back on its own", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.apply((s) => harness.debug.clearWorld(s));
    let s = harness.snapshot();
    expect(s.ball).toBeNull();
    expect(s.obstacles).toEqual([]);

    // An absent ball takes no part in a frame and scores no point.
    await harness.engine.advance(30);
    s = harness.snapshot();
    expect(s.ball).toBeNull();
    expect(s.score).toEqual({ p1: 0, p2: 0 });
    // The paddles stay: they are furniture the game always has.
    expect(s.paddles.left.cy).toBe(FIELD_CY);

    harness.apply((st) => harness.debug.spawnObstacle(st, 1));
    expect(harness.snapshot().obstacles.map((o) => o.index)).toEqual([1]);
    harness.apply((st) => harness.debug.spawnObstacle(st, 0));
    expect(harness.snapshot().obstacles.map((o) => o.index)).toEqual([0, 1]);

    harness.apply((st) => harness.debug.spawnBall(st));
    expect(harness.snapshot().ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      speed: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      serveSign: expect.any(Number),
      trail: [],
    });
  });

  it("leaves the state alone when a ball operation meets an empty field", () => {
    harness.apply((s) => harness.debug.clearWorld(s));
    harness.apply((s) => harness.debug.setBallPosition(s, 10, 20));
    harness.apply((s) => harness.debug.setBallVelocity(s, 30, 40));
    expect(harness.snapshot().ball).toBeNull();
  });

  it("poses the obstacle clock and freezes it as its own gate", async () => {
    const t = Math.PI / 4 / OBSTACLE_SPIN_RATE;
    harness.apply((s) => harness.debug.setObstacleClockRunning(s, false));
    harness.apply((s) => harness.debug.setObstacleClock(s, t));

    // The poses follow the clock on the very frame it is set.
    let s = harness.snapshot();
    expect(s.obstacleClock).toBeCloseTo(t, 9);
    expect(s.obstacles[0].theta).toBeCloseTo(Math.PI / 4, 9);

    openMatch(harness, "versus");
    harness.apply((st) => harness.debug.setObstacleClockRunning(st, false));
    harness.apply((st) => harness.debug.setObstacleClock(st, t));
    await harness.engine.advance(30);
    s = harness.snapshot();
    expect(s.obstacleClock).toBeCloseTo(t, 9);
    expect(s.obstacles[0].theta).toBeCloseTo(Math.PI / 4, 9);
    // Nothing else was taken away: the paddles are still the players'.
    expect(s.paddles.left.driven).toBe(false);
  });

  it("advances the clock through a countdown while it is running", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(30);
    expect(harness.snapshot().obstacleClock).toBeCloseTo(0.5, 6);
    expect(harness.snapshot().obstacles[0].theta).toBeCloseTo(
      OBSTACLE_SPIN_RATE * 0.5,
      6,
    );
  });

  it("reads back every field it poses", () => {
    harness.apply((s) => harness.debug.setScreen(s, "matchover"));
    harness.apply((s) => harness.debug.setMode(s, "versus"));
    harness.apply((s) => harness.debug.setMenuIndex(s, 1));
    harness.apply((s) => harness.debug.setTitleIndex(s, 2));
    harness.apply((s) => harness.debug.setResumeScreen(s, "countdown"));
    harness.apply((s) => harness.debug.setScore(s, 3, 5));
    harness.apply((s) => harness.debug.setWinner(s, "right"));
    harness.apply((s) => harness.debug.setReceiver(s, "right"));
    harness.apply((s) => harness.debug.setPaddleCy(s, "right", 200));
    harness.apply((s) => harness.debug.setBallHeld(s, false));
    harness.apply((s) => harness.debug.setBallHoldTimer(s, 0.25));
    harness.apply((s) => harness.debug.setBallSpin(s, -120));
    harness.apply((s) => harness.debug.setBallServeSign(s, -1));

    const s = harness.snapshot();
    expect(s.screen).toBe("matchover");
    expect(s.mode).toBe("versus");
    expect(s.menuIndex).toBe(1);
    expect(s.titleIndex).toBe(2);
    expect(s.resumeScreen).toBe("countdown");
    expect(s.score).toEqual({ p1: 3, p2: 5 });
    expect(s.winner).toBe("right");
    expect(s.receiver).toBe("right");
    expect(s.paddles.right.cy).toBe(200);
    expect(s.ball?.held).toBe(false);
    expect(s.ball?.holdTimer).toBe(0.25);
    expect(s.ball?.spin).toBe(-120);
    expect(s.ball?.serveSign).toBe(-1);
  });

  it("changes nothing when it reads", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    const before = JSON.stringify(harness.snapshot());
    harness.debug.snapshot(harness.state);
    harness.debug.menuItemRect(harness.state, 0);
    expect(JSON.stringify(harness.snapshot())).toBe(before);
  });
});

// ---- Drawing ------------------------------------------------------------

describe("rendering", () => {
  it("fills each paddle in its own color", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(1);

    expect(harness.pixel(P1_X0 + PADDLE_W / 2, FIELD_CY)).toEqual([
      58, 231, 196, 255,
    ]);
    expect(harness.pixel(FIELD_W - P1_X0 - PADDLE_W / 2, FIELD_CY)).toEqual([
      255, 92, 138, 255,
    ]);
  });

  it("draws each score as its own number near the top", async () => {
    openMatch(harness, "versus");
    harness.apply((s) => harness.debug.setScore(s, 7, 9));
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const texts = callsTo(harness.calls, "fillText");
    const seven = texts.find((args) => args[0] === "7");
    const nine = texts.find((args) => args[0] === "9");
    expect(seven).toBeDefined();
    expect(nine).toBeDefined();
    expect(seven?.[1]).toBeLessThan(FIELD_CX);
    expect(nine?.[1]).toBeGreaterThan(FIELD_CX);
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

  it("draws no ball at all on a field that carries none", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.apply((s) => harness.debug.clearWorld(s));
    harness.calls.length = 0;
    await harness.engine.advance(1);
    expect(callsTo(harness.calls, "arc")).toHaveLength(0);
  });

  it("draws the how-to screen's single menu item", async () => {
    harness.apply((s) => harness.debug.setScreen(s, "howto"));
    harness.calls.length = 0;
    await harness.engine.advance(1);
    const texts = callsTo(harness.calls, "fillText").map((args) => args[0]);
    expect(texts).toContain("BACK");
  });

  it("draws in logical coordinates whatever size the surface is", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(1);
    const view = harness.engine.viewport();
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBe(1);
  });

  it("keeps the field inside the design size", () => {
    expect(FIELD_W / FIELD_H).toBeCloseTo(16 / 9, 6);
  });

  it("draws every screen, with the field full and with it empty", async () => {
    const screens = [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "matchover",
    ] as const;
    for (const screen of screens) {
      harness.apply((s) => harness.debug.reset(s));
      harness.apply((s) => harness.debug.setScreen(s, screen));
      await harness.engine.advance(1);
      harness.apply((s) => harness.debug.clearWorld(s));
      harness.apply((s) => harness.debug.setScreen(s, screen));
      await harness.engine.advance(1);
    }
    expect(harness.assetFailures).toEqual([]);
  });

  it("changes nothing about the state", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    await harness.engine.advance(1);
    const before = JSON.stringify(harness.snapshot());
    game.render(harness.state, {
      ctx: harness.ctx as unknown as CanvasRenderingContext2D,
      frame: () => harness.engine.frame(),
      viewport: () => harness.engine.viewport(),
    });
    expect(JSON.stringify(harness.snapshot())).toBe(before);
  });
});
