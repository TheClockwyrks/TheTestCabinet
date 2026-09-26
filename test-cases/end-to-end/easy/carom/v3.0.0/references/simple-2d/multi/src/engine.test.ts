// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` — which
// makes a duration a frame count and the arithmetic asserted here the arithmetic
// specs/ names. What is read back is the game's own state — the CURRENT value,
// off `engine.state`, since every frame replaces it — the debug surface the game
// returned beside its state, the engine's events, and the pixels the render
// produced.
//
// The surface is a set of transitions and readings over the state: a pose is
// driven through `engine.apply((s) => debug.pose(s, …))`, which stores what it
// returns as the state the next frame receives, and a reading through
// `debug.snapshot(engine.state)`.
//
// The keyboard and the pointer are driven the way a player drives them: the
// engine attaches its listeners to the event target the `surface` option supplies
// (`engine/input.md`), so dispatching a `KeyboardEvent`- or `PointerEvent`-shaped
// event at that target reaches the game by exactly the path a real one takes.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type PointerDevice,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
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
  LAYOUT,
  OBSTACLE_CENTERS,
  P1_X0,
  PADDLE_SPEED,
  PADDLE_W,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import type { CaromDebugApi, CaromSnapshot } from "./debug";
import { BACKGROUND, game, type CaromState, type Mode } from "./game";
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

/** How one dispatched pointer event is shaped. */
interface PointerOptions {
  /** Which device drove it. A finger and a mouse differ on the menus. */
  device?: PointerDevice;
  /** The pointer's id, so a second contact can be driven beside the first. */
  id?: number;
  /** Whether the primary button is held as the event is delivered. */
  held?: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Harness {
  readonly engine: Engine<CaromState, CaromDebugApi>;
  /** The engine's CURRENT state: what the most recent frame or pose left. */
  readonly state: DeepReadonly<CaromState>;
  readonly debug: CaromDebugApi;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  /** Move the pointer to a logical point, pressing nothing. */
  movePointer(x: number, y: number, options?: PointerOptions): void;
  /** Press at a logical point and leave the pointer down. */
  pressPointer(x: number, y: number, options?: PointerOptions): void;
  /** Release a pointer pressed by `pressPointer`, at a logical point. */
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

/**
 * A `PointerEvent`-shaped event carrying exactly the seven fields the engine's
 * listeners read (`engine/input.md`), which is what makes it drive the pointer
 * as a player's does. A shim rather than a real `PointerEvent`, because there is
 * no DOM here to construct one from.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDevice;
  readonly isPrimary = true;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    options: PointerOptions,
    button: number,
    buttons: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerId = options.id ?? 1;
    this.pointerType = options.device ?? "mouse";
    this.button = button;
    this.buttons = buttons;
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
    options: PointerOptions,
    button: number,
    buttons: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y, options, button, buttons));
  };

  return {
    engine,
    // Read off the engine on every access rather than kept from `initialize`:
    // a frame replaces the state with the value `update` returned, so the object
    // `initialize` resolved with is the title screen forever.
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here: `initialize` returns the
    // surface beside the state, so reaching it this way is what makes that return
    // load-bearing — a build that returned none fails here rather than being
    // handed a surface this file constructed for it.
    debug: engine.debug,
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
    // The surface has no `origin`, and the fit is 1:1 here, so a logical point
    // and the client position of an event at it are the same numbers.
    movePointer: (x, y, options = {}) =>
      point("pointermove", x, y, options, -1, options.held === true ? 1 : 0),
    pressPointer: (x, y, options = {}) =>
      point("pointerdown", x, y, options, 0, 1),
    releasePointer: (x, y, options = {}) =>
      point("pointerup", x, y, options, 0, 0),
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

// ---- Posing a scenario --------------------------------------------------

/** How a ball is posed: where it is, where it is going, and what spin it carries. */
interface Pose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin?: number;
}

/**
 * Where a scenario parks the two balls it is not driving.
 *
 * Motionless, clear of both paddles, both obstacles, and each other, and well
 * inside the field so neither drifts over a goal edge and scores mid-scenario.
 */
const IDLE: Pose[] = [
  { x: 150, y: 60, vx: 0, vy: 0 },
  { x: 1130, y: 60, vx: 0, vy: 0 },
];

/**
 * The opening of a match, posed one atomic operation at a time: the title
 * screen's world and scores from `reset`, the mode, and the countdown screen.
 */
function openMatch(h: Harness, mode: Mode): void {
  h.engine.apply((s) => h.debug.reset(s));
  h.engine.apply((s) => h.debug.setMode(s, mode));
  h.engine.apply((s) => h.debug.setScreen(s, "countdown"));
}

/** Every waiting ball's hold ended now, so each launches on the next frame. */
function endHolds(h: Harness): void {
  for (let index = 0; index < BALL_COUNT; index++) {
    h.engine.apply((s) => h.debug.setBallHoldTimer(s, index, 0));
  }
}

/** One ball placed, aimed, spun, and taken into live play. */
function poseBall(h: Harness, index: number, pose: Pose): void {
  h.engine.apply((s) => h.debug.setBallPosition(s, index, pose.x, pose.y));
  h.engine.apply((s) => h.debug.setBallVelocity(s, index, pose.vx, pose.vy));
  h.engine.apply((s) => h.debug.setBallSpin(s, index, pose.spin ?? 0));
  h.engine.apply((s) => h.debug.setBallHeld(s, index, false));
  h.engine.apply((s) => h.debug.setBallHoldTimer(s, index, 0));
}

/** One side's paddle taken from the player and set travelling at `vy`. */
function drivePaddle(h: Harness, side: "left" | "right", vy: number): void {
  h.engine.apply((s) => h.debug.setPaddleVy(s, side, vy));
  h.engine.apply((s) => h.debug.setPaddleDriven(s, side, true));
}

/**
 * Take the match to a live rally with ball 0 posed exactly as asked, and the
 * other two parked out of the way so the scenario is about the one ball.
 */
async function rally(h: Harness, mode: Mode, ball: Pose): Promise<void> {
  openMatch(h, mode);
  endHolds(h);
  await h.engine.advance(1); // the launch, through the build's own code
  poseBall(h, 0, ball);
  poseBall(h, 1, IDLE[0]);
  poseBall(h, 2, IDLE[1]);
}

/** The one ball a `rally` scenario is driving. */
function driven(h: Harness): CaromSnapshot["balls"][number] {
  return h.debug.snapshot(h.engine.state).balls[0];
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

/** The middle of item `index` on the menu the current screen shows. */
function itemCenter(h: Harness, index: number): Point {
  const rect = h.debug.menuItemRect(h.engine.state, index);
  if (rect === null) throw new Error(`no menu item ${index} on this screen`);
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
    expect(state.obstacles).toEqual([
      { index: 0, cx: OBSTACLE_CENTERS[0].x, cy: OBSTACLE_CENTERS[0].y },
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
    expect(state.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: false,
      drivenVy: 0,
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
    for (const ball of harness.state.balls) {
      expect(ball.holdTimer).toBeCloseTo(HOLD_TIME - 1 / 60, 9);
    }
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("wraps the selection both ways", async () => {
    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);
  });

  it("moves only on a frame carrying a movement edge and a confirm edge", async () => {
    harness.tap("ArrowDown");
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
  });

  it("moves up only on a frame carrying both an up and a down edge", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("KeyW");
    harness.tap("KeyS");
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

  it("leaves the how-to screen on its own menu item too", async () => {
    harness.engine.apply((s) => harness.debug.setScreen(s, "howto"));
    harness.tap("Enter");
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
  it("remembers the item that led away from the title", async () => {
    harness.tap("ArrowDown"); // VERSUS
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.titleIndex).toBe(1);
    expect(harness.state.menuIndex).toBe(0); // the countdown's own menu index
  });

  it("restores it when the how-to screen is left", async () => {
    harness.engine.apply((s) => harness.debug.setMenuIndex(s, 2));
    harness.tap("Enter"); // HOW TO PLAY
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("restores it when a pause quits to the menu", async () => {
    harness.tap("ArrowDown"); // VERSUS
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter"); // QUIT TO MENU
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(1);
    expect(harness.state.titleIndex).toBe(1);
  });

  it("restores it from the match-over screen", async () => {
    harness.engine.apply((s) => harness.debug.setTitleIndex(s, 2));
    harness.engine.apply((s) => harness.debug.setScreen(s, "matchover"));
    harness.engine.apply((s) => harness.debug.setMenuIndex(s, 1));
    harness.tap("Enter"); // MENU
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });
});

// ---- Menus, from a mouse and a finger ------------------------------------

describe("the menus under a pointer", () => {
  it("selects the item the pointer moves onto", async () => {
    const target = itemCenter(harness, 2);
    harness.movePointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("leaves the selection alone while the pointer is over no item", async () => {
    harness.engine.apply((s) => harness.debug.setMenuIndex(s, 1));
    harness.movePointer(20, 20);
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms an item pressed and released inside one region", async () => {
    const target = itemCenter(harness, 1); // VERSUS
    harness.pressPointer(target.x, target.y);
    harness.releasePointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.titleIndex).toBe(1);
  });

  it("confirms across two frames when the press and release are apart", async () => {
    const target = itemCenter(harness, 1);
    harness.pressPointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");

    harness.releasePointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.screen).toBe("countdown");
  });

  it("confirms nothing when the press and the release name different items", async () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 1);
    harness.pressPointer(from.x, from.y);
    await harness.engine.advance(1);
    harness.movePointer(to.x, to.y, { held: true });
    harness.releasePointer(to.x, to.y);
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("title");
    // The travel still moved the highlight, which is what the player sees.
    expect(harness.state.menuIndex).toBe(1);
  });

  it("confirms nothing when the press began outside every item", async () => {
    const target = itemCenter(harness, 1);
    harness.pressPointer(20, 20);
    await harness.engine.advance(1);
    harness.releasePointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms nothing when the release lands outside every item", async () => {
    const target = itemCenter(harness, 1);
    harness.pressPointer(target.x, target.y);
    await harness.engine.advance(1);
    harness.releasePointer(20, 20);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("takes a finger's landing as the selection a mouse hovers for", async () => {
    const target = itemCenter(harness, 2);
    harness.pressPointer(target.x, target.y, { device: "touch" });
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
    expect(harness.state.screen).toBe("title");
  });

  it("confirms a finger that lands and lifts inside one item", async () => {
    const target = itemCenter(harness, 1);
    harness.pressPointer(target.x, target.y, { device: "touch" });
    harness.releasePointer(target.x, target.y, { device: "touch" });
    await harness.engine.advance(1);
    expect(harness.state.mode).toBe("versus");
    expect(harness.state.screen).toBe("countdown");
  });

  it("confirms nothing for a finger that travels onto another item", async () => {
    const from = itemCenter(harness, 0);
    const to = itemCenter(harness, 2);
    harness.pressPointer(from.x, from.y, { device: "touch" });
    await harness.engine.advance(1);
    harness.movePointer(to.x, to.y, { device: "touch", held: true });
    harness.releasePointer(to.x, to.y, { device: "touch" });
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("leaves menuIndex where the pointer put it, not where a key did", async () => {
    const target = itemCenter(harness, 2);
    harness.tap("ArrowDown"); // the keyboard says 1
    harness.movePointer(target.x, target.y); // the pointer says 2
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", async () => {
    const target = itemCenter(harness, 1); // VERSUS, under the pointer
    harness.tap("Enter"); // SOLO, under the keyboard
    harness.pressPointer(target.x, target.y);
    harness.releasePointer(target.x, target.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.mode).toBe("solo");
  });

  it("moves only when a movement edge, a confirm edge, and the pointer meet", async () => {
    const target = itemCenter(harness, 2);
    harness.tap("ArrowDown");
    harness.tap("Enter");
    harness.movePointer(target.x, target.y);
    await harness.engine.advance(1);
    // Movement takes the frame, and the pointer's selection stands over the key's.
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(2);
  });

  it("drives the pause menu the same way", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    const resume = itemCenter(harness, 0);
    harness.pressPointer(resume.x, resume.y);
    harness.releasePointer(resume.x, resume.y);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("reports no region on the two screens that show no menu", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    expect(harness.debug.menuItemRect(harness.engine.state, 0)).toBeNull();
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

  it("reads each Solo direction as held once however many keys hold it", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    // Two keys up against one key down is still up against down: a standstill.
    harness.hold("KeyW");
    harness.hold("ArrowUp");
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

describe("launching", () => {
  it("holds all three for HOLD_TIME and then launches them together", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(frames(HOLD_TIME) - 1);
    expect(harness.state.screen).toBe("countdown");
    expect(
      harness.debug.snapshot(harness.engine.state).balls.map((b) => b.held),
    ).toEqual([true, true, true]);

    await harness.engine.advance(2);
    expect(harness.state.screen).toBe("playing");
    expect(
      harness.debug.snapshot(harness.engine.state).balls.map((b) => b.held),
    ).toEqual([false, false, false]);
  });

  it("starts each ball on its own home point", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(1);
    harness.debug
      .snapshot(harness.engine.state)
      .balls.forEach((ball, index) => {
        expect(ball.x).toBe(BALL_HOMES[index].x);
        expect(ball.y).toBe(BALL_HOMES[index].y);
      });
  });

  it("launches every ball at SERVE_SPEED", async () => {
    openMatch(harness, "versus");
    endHolds(harness);
    await harness.engine.advance(1);
    for (const ball of harness.debug.snapshot(harness.engine.state).balls) {
      expect(ball.speed).toBeCloseTo(SERVE_SPEED, 6);
    }
  });

  it("draws a fresh angle over the whole circle whenever a ball is parked", () => {
    const quadrants = new Set<number>();
    for (let i = 0; i < 200 && quadrants.size < 4; i++) {
      harness.engine.apply((s) => harness.debug.spawnBall(s, 0));
      const angle = harness.debug.snapshot(harness.engine.state).balls[0]
        .launchAngle;
      quadrants.add(Math.floor(angle / (Math.PI / 2)) % 4);
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("launches each ball along the angle it holds, and leaves it as it is", async () => {
    openMatch(harness, "versus");
    const angles = [0.4, 2.0, 4.5];
    angles.forEach((angle, index) => {
      harness.engine.apply((s) =>
        harness.debug.setBallLaunchAngle(s, index, angle),
      );
    });
    endHolds(harness);
    await harness.engine.advance(1);
    const balls = harness.debug.snapshot(harness.engine.state).balls;
    angles.forEach((angle, index) => {
      expect(balls[index].launchAngle).toBe(angle);
      const flown = Math.atan2(balls[index].vy, balls[index].vx);
      expect(Math.cos(flown - angle)).toBeCloseTo(1, 3);
    });
  });
});

// ---- Physics, through the engine ----------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.engine.apply((s) => harness.debug.setPaddleCy(s, "left", FIELD_CY));
    drivePaddle(harness, "left", 200);
    harness.cues.length = 0;

    await harness.engine.advance(6);

    expect(played(harness)).toEqual([CUES.paddleHit]);
    const ball = driven(harness);
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
    expect(driven(harness).vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.obstacleBounce]);
    expect(driven(harness).vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(60);
    const slow = harness.state.balls[0].trail.length;

    const fast = await createHarness(new ConstantClock(1000 / 240));
    try {
      await rally(fast, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
      await fast.engine.advance(240);
      expect(fast.state.balls[0].trail.length).toBeGreaterThan(slow);
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

      const slowBall = driven(harness);
      const fastBall = driven(fast);
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

// ---- The world -----------------------------------------------------------

describe("the world", () => {
  it("empties the field and leaves nothing to advance or draw", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.clearWorld(s));
    harness.calls.length = 0;

    await harness.engine.advance(30);

    const snap = harness.debug.snapshot(harness.engine.state);
    expect(snap.balls).toEqual([]);
    expect(snap.obstacles).toEqual([]);
    expect(callsTo(harness.calls, "arc")).toEqual([]);
  });

  it("spawns a ball back into a cleared field, held on its own home", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.clearWorld(s));
    harness.engine.apply((s) => harness.debug.spawnBall(s, 1));

    const spawned = harness.debug.snapshot(harness.engine.state).balls;
    expect(spawned).toHaveLength(1);
    expect(spawned[0].index).toBe(1);
    expect(spawned[0].held).toBe(true);

    // And it relaunches on its own hold, through the build's own rule.
    await harness.engine.advance(frames(HOLD_TIME) + 1);
    const launched = harness.debug.snapshot(harness.engine.state).balls[0];
    expect(launched.held).toBe(false);
    expect(launched.speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("gives a removed obstacle no collision at all", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.engine.apply((s) => harness.debug.clearWorld(s));
    harness.engine.apply((s) => harness.debug.spawnBall(s, 0));
    harness.engine.apply((s) => harness.debug.spawnObstacle(s, 1));
    poseBall(harness, 0, { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    // Obstacle A is gone, so the ball flies straight through where it was.
    expect(played(harness)).toEqual([]);
    expect(driven(harness).vx).toBe(600);
  });

  it("puts a spawned obstacle's collision back", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.engine.apply((s) => harness.debug.clearWorld(s));
    harness.engine.apply((s) => harness.debug.spawnBall(s, 0));
    harness.engine.apply((s) => harness.debug.spawnObstacle(s, 0));
    poseBall(harness, 0, { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.obstacleBounce]);
    expect(driven(harness).vx).toBeLessThan(0);
  });
});

// ---- Scoring and the match ----------------------------------------------

describe("scoring", () => {
  it("gives the point to the far side and sends only that ball home", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(4);

    expect(harness.state.score).toEqual({ p1: 1, p2: 0 });
    expect(played(harness)).toEqual([CUES.score]);
    // The field never freezes for a respawn: the match stays live.
    expect(harness.state.screen).toBe("playing");

    const scored = driven(harness);
    expect(scored.held).toBe(true);
    expect(scored.x).toBe(BALL_HOMES[0].x);
    expect(scored.y).toBe(BALL_HOMES[0].y);

    await harness.engine.advance(frames(HOLD_TIME) + 1);
    expect(driven(harness).held).toBe(false);
    expect(driven(harness).speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("gives the point to player two when a ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    await harness.engine.advance(4);
    expect(harness.state.score).toEqual({ p1: 0, p2: 1 });
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.engine.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );

    await harness.engine.advance(4);

    expect(harness.state.score.p1).toBe(WIN_SCORE);
    expect(harness.state.winner).toBe("left");
    expect(harness.state.screen).toBe("matchover");
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.engine.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 1),
    );

    await harness.engine.advance(4);

    expect(harness.state.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 1 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.screen).toBe("playing");
  });

  it("offers a rematch from the match-over screen", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.engine.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.winner).toBeNull();
    expect(harness.state.balls).toHaveLength(BALL_COUNT);
  });

  it("returns to the title from the match-over screen on back", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.engine.apply((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);
    expect(harness.state.screen).toBe("matchover");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
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
    expect(harness.state.resumeScreen).toBe("playing");

    const frozen = harness.debug.snapshot(harness.engine.state);
    await harness.engine.advance(60);
    expect(harness.debug.snapshot(harness.engine.state).balls).toEqual(
      frozen.balls,
    );

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("opens the pause menu on Escape and leaves it open", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    // The same Escape raised `back` too; the pause menu must not have eaten it.
    await harness.engine.advance(5);
    expect(harness.state.screen).toBe("paused");
  });

  it("resumes on P as well as on Escape", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("Escape");
    await harness.engine.advance(1);
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
  });

  it("resumes to the countdown when the pause began there", async () => {
    openMatch(harness, "versus");
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");
    expect(harness.state.resumeScreen).toBe("countdown");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("countdown");
  });

  it("does nothing else on the frame a resume arrives", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);

    // A resume and a movement edge together: the resume wins outright.
    harness.tap("KeyP");
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
    expect(harness.state.menuIndex).toBe(0);
  });

  it("restarts the match from the pause menu", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.setScore(s, 4, 2));
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter"); // RESTART
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("countdown");
    expect(harness.state.score).toEqual({ p1: 0, p2: 0 });
    expect(harness.state.mode).toBe("versus");
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

  it("survives a reset, which restores everything else", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    harness.engine.apply((s) => harness.debug.reset(s));
    expect(harness.state.muted).toBe(true);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.simTime).toBe(0);
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  it("moves a driven paddle at its drivenVy and ignores the keyboard", async () => {
    openMatch(harness, "versus");
    drivePaddle(harness, "left", 300);

    harness.hold("KeyW"); // ignored: that paddle is driven
    await harness.engine.advance(frames(0.1));

    expect(harness.state.paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.state.paddles.left.vy).toBe(300);
  });

  it("leaves the other side with the player", async () => {
    openMatch(harness, "versus");
    drivePaddle(harness, "left", 300);

    harness.hold("ArrowUp");
    await harness.engine.advance(frames(0.1));

    expect(harness.state.paddles.right.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("holds drivenVy across frames while the paddle stands still", async () => {
    openMatch(harness, "versus");
    harness.engine.apply((s) => harness.debug.setPaddleVy(s, "left", 300));
    await harness.engine.advance(10);
    // Not driven, so it did not move — but the velocity it would travel at holds.
    expect(harness.state.paddles.left.cy).toBe(FIELD_CY);
    expect(harness.state.paddles.left.drivenVy).toBe(300);

    harness.engine.apply((s) => harness.debug.setPaddleDriven(s, "left", true));
    await harness.engine.advance(1);
    expect(harness.state.paddles.left.vy).toBe(300);
  });

  it("hands both paddles back on reset", async () => {
    openMatch(harness, "versus");
    drivePaddle(harness, "left", 300);
    harness.engine.apply((s) => harness.debug.reset(s));
    expect(harness.state.paddles.left.driven).toBe(false);
    expect(harness.state.paddles.left.drivenVy).toBe(0);
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

  it("runs the real AI against a posed shot on the side it does not drive", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    drivePaddle(harness, "left", 0);

    await harness.engine.advance(30);

    const { paddles } = harness.debug.snapshot(harness.engine.state);
    expect(paddles.right.cy).toBeLessThan(600);
    expect(paddles.left.cy).toBe(FIELD_CY); // driven, at a drivenVy of 0
  });

  it("takes a posed ball into live play", async () => {
    openMatch(harness, "versus");
    poseBall(harness, 2, { x: 400, y: 300, vx: 200, vy: 0 });
    expect(harness.debug.snapshot(harness.engine.state).balls[2].held).toBe(
      false,
    );

    await harness.engine.advance(6);
    expect(
      harness.debug.snapshot(harness.engine.state).balls[2].x,
    ).toBeGreaterThan(400);
  });
});

describe("the AI's faculties", () => {
  it("holds its rest position with tracking off", async () => {
    await rally(harness, "solo", { x: 900, y: 120, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.engine.apply((s) => harness.debug.setAiTracking(s, false));

    await harness.engine.advance(60);

    // It eases home rather than climbing to meet the ball at y 120.
    expect(
      harness.debug.snapshot(harness.engine.state).paddles.right.cy,
    ).toBeLessThan(600);
    expect(
      harness.debug.snapshot(harness.engine.state).paddles.right.cy,
    ).toBeGreaterThan(300);
  });

  it("does not travel at all with movement off", async () => {
    await rally(harness, "solo", { x: 900, y: 120, vx: 400, vy: 0 });
    harness.engine.apply((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.engine.apply((s) => harness.debug.setAiMovement(s, false));

    await harness.engine.advance(60);

    const { right } = harness.debug.snapshot(harness.engine.state).paddles;
    expect(right.cy).toBe(600);
    expect(right.vy).toBe(0);
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

  it("draws every ball as its own arc at its own position", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    await harness.engine.advance(1);

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

  it("draws each score as its own digits, one each side of center", async () => {
    openMatch(harness, "versus");
    harness.engine.apply((s) => harness.debug.setScore(s, 7, 9));
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const texts = callsTo(harness.calls, "fillText");
    const p1 = texts.find((args) => args[0] === "7");
    const p2 = texts.find((args) => args[0] === "9");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1?.[1] as number).toBeLessThan(FIELD_CX);
    expect(p2?.[1] as number).toBeGreaterThan(FIELD_CX);
  });

  it("draws every menu item the hit regions report", async () => {
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const texts = callsTo(harness.calls, "fillText");
    for (const item of ["SOLO", "VERSUS", "HOW TO PLAY"]) {
      const drawn = texts.find((args) => args[0] === item);
      expect(drawn).toBeDefined();
    }
    // And each drawn item sits inside the region reported for it.
    for (let index = 0; index < 3; index++) {
      const rect = harness.debug.menuItemRect(harness.engine.state, index);
      const center = itemCenter(harness, index);
      expect(rect).not.toBeNull();
      expect(center.y).toBeGreaterThan(rect?.y ?? 0);
    }
  });

  it("draws in logical coordinates whatever size the surface is", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(1);
    const view = harness.engine.viewport();
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBe(1);
  });

  it("draws from the state it is handed and leaves it as it was", async () => {
    // That `render` cannot change the state is the type's doing; what is checked
    // here is that drawing again is a pure function of the same value.
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    await harness.engine.advance(1);
    const { state } = harness;
    const before = JSON.stringify(state);
    game.render(state, {
      ctx: harness.ctx as unknown as CanvasRenderingContext2D,
      frame: () => harness.engine.frame(),
      viewport: () => harness.engine.viewport(),
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(harness.engine.state).toBe(state);
  });

  it("draws every screen without reading anything but the state", async () => {
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "matchover",
    ] as const) {
      harness.engine.apply((s) => harness.debug.setScreen(s, screen));
      harness.calls.length = 0;
      await harness.engine.advance(1);
      expect(harness.calls.length).toBeGreaterThan(0);
    }
  });
});

// ---- The three balls ----------------------------------------------------

describe("three independent balls", () => {
  it("keeps the other two running while one respawns", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    poseBall(harness, 1, { x: 300, y: 300, vx: 300, vy: 0 });

    await harness.engine.advance(4);

    // Ball 0 scored and went home; ball 1 never paused.
    const balls = harness.debug.snapshot(harness.engine.state).balls;
    expect(balls[0].held).toBe(true);
    expect(balls[1].held).toBe(false);
    expect(balls[1].x).toBeGreaterThan(300);
  });

  it("runs each ball's hold on its own clock", async () => {
    openMatch(harness, "versus");
    endHolds(harness);
    await harness.engine.advance(1);
    // Send ball 0 home mid-rally by scoring with it; the others stay in flight.
    poseBall(harness, 0, { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    await harness.engine.advance(4);

    const holds = harness.state.balls.map((ball) => ball.holdTimer);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[1]).toBe(0);
    expect(holds[2]).toBe(0);
  });

  it("bounces two balls off each other without changing either's spin", async () => {
    await rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0 });
    poseBall(harness, 1, { x: 700, y: 400, vx: -300, vy: 0 });

    await harness.engine.advance(30);

    const [a, b] = harness.debug.snapshot(harness.engine.state).balls;
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.spin).toBe(0);
    expect(b.spin).toBe(0);
  });

  it("plays the ball cue once for the pair, not once for each ball", async () => {
    await rally(harness, "versus", { x: 600, y: 400, vx: 300, vy: 0 });
    poseBall(harness, 1, { x: 700, y: 400, vx: -300, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(30);

    // A collision is one event between two balls (specs/audio.md), so the whole
    // of this scenario is one cue. Playing it from a loop over the balls would
    // sound the same contact twice, once for each side of it.
    expect(played(harness)).toEqual([CUES.ballBounce]);
  });

  it("bounces a moving ball off one waiting at its home point", async () => {
    openMatch(harness, "versus");
    // Ball 1 is still waiting on the field center; drive ball 0 into it.
    poseBall(harness, 0, {
      x: BALL_HOMES[1].x - 120,
      y: BALL_HOMES[1].y,
      vx: 400,
      vy: 0,
    });

    await harness.engine.advance(30);

    const [moving, waiting] = harness.debug.snapshot(
      harness.engine.state,
    ).balls;
    expect(moving.vx).toBeLessThan(0);
    expect(waiting.held).toBe(true);
    expect(waiting.x).toBe(BALL_HOMES[1].x);
    expect(waiting.y).toBe(BALL_HOMES[1].y);
  });

  it("never lets two balls occupy the same place", async () => {
    openMatch(harness, "versus");
    endHolds(harness);
    await harness.engine.advance(600);

    const balls = harness.debug.snapshot(harness.engine.state).balls;
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

  it("defends the ball arriving at its goal soonest in Solo", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    // A second ball threatens the same goal, but from much further away.
    poseBall(harness, 1, { x: 200, y: 620, vx: 400, vy: 0 });
    harness.engine.apply((s) =>
      harness.debug.setPaddleCy(s, "right", FIELD_CY),
    );

    await harness.engine.advance(20);

    // It tracks the near ball at y 180, not the far one at y 620.
    expect(
      harness.debug.snapshot(harness.engine.state).paddles.right.cy,
    ).toBeLessThan(FIELD_CY);
  });
});
