// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` — which
// makes a duration a frame count and the arithmetic asserted here the arithmetic
// specs/ names. What is read back is the game's own state, the debug surface the
// game returned beside its state, the engine's events, and the pixels the render
// produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose on the debug surface takes a state and returns the
// next one, and is driven through `engine.apply`; a reading is handed
// `engine.state`. `h.pose` and `h.snapshot` are those two moves, named.
//
// The keyboard and the pointer are driven the way the engine documents: a
// `KeyboardEvent`- or `PointerEvent`-shaped event dispatched at the target the
// surface supplies. The engine reads `code` and `repeat` off the first and
// `clientX`, `clientY`, `pointerId`, `pointerType`, `isPrimary`, `button` and
// `buttons` off the second, and narrows structurally, so the shims below drive it
// exactly as a player does.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type PointerDevice,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  BALL_R,
  CUES,
  DEFAULT_SEED,
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
  SERVE_ANGLE,
  SERVE_SPEED,
  SPIN_FROM_PADDLE,
  WIN_SCORE,
} from "./constants";
import type { CaromDebugApi, CaromSnapshot } from "./debug";
import { BACKGROUND, game, type CaromState } from "./game";
import { itemCenterY, menuFor } from "./menus";
import { seedState } from "./rng";
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
  device?: PointerDevice;
  id?: number;
}

interface Harness {
  readonly engine: Engine<CaromState, CaromDebugApi>;
  /** The current state: `engine.state`, read at the moment it is read. */
  readonly state: DeepReadonly<CaromState>;
  readonly debug: CaromDebugApi;
  /** Apply a pose from the surface to the current state. */
  pose(transition: (state: DeepReadonly<CaromState>) => CaromState): void;
  /** The surface's reading of the current state. */
  snapshot(): CaromSnapshot;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  /** Move the pointer to a logical point without pressing anything. */
  movePointer(x: number, y: number, options?: PointerOptions): void;
  /** Press the pointer at a logical point and leave it down. */
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

type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/** A `PointerEvent`-shaped event: the seven fields the engine's listeners read. */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDevice;
  readonly isPrimary = true;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: PointerEventName,
    fields: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: PointerDevice;
      button: number;
      buttons: number;
    },
  ) {
    super(type);
    this.clientX = fields.clientX;
    this.clientY = fields.clientY;
    this.pointerId = fields.pointerId;
    this.pointerType = fields.pointerType;
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
  // The surface is 1:1 with the field, so a logical point is its own client
  // point; the engine still maps it through the same letterboxed fit it draws
  // under.
  const dispatchPointer = (
    type: PointerEventName,
    x: number,
    y: number,
    button: number,
    buttons: number,
    options: PointerOptions,
  ): void => {
    events.dispatchEvent(
      new PointerEventShim(type, {
        clientX: x,
        clientY: y,
        pointerId: options.id ?? 1,
        pointerType: options.device ?? "mouse",
        button,
        buttons,
      }),
    );
  };
  // Read off the engine rather than built here: `initialize` returns the
  // surface beside the state, so reaching it this way is what makes that return
  // load-bearing — a build that returned none fails here rather than being
  // handed a surface this file constructed for it.
  const debug = engine.debug;

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    pose: (transition) => {
      engine.apply(transition);
    },
    snapshot: () => debug.snapshot(engine.state),
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
    // `-1` is what a browser puts in `button` for an event about position alone.
    movePointer: (x, y, options = {}) =>
      dispatchPointer("pointermove", x, y, -1, 0, options),
    pressPointer: (x, y, options = {}) =>
      dispatchPointer("pointerdown", x, y, 0, 1, options),
    releasePointer: (x, y, options = {}) =>
      dispatchPointer("pointerup", x, y, 0, 0, options),
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

/** The screen a match opens on, posed atomically rather than through the menu. */
function openMatch(h: Harness, mode: "solo" | "versus"): void {
  h.pose((s) => h.debug.setMode(s, mode));
  h.pose((s) => h.debug.setScreen(s, "countdown"));
  h.pose((s) => h.debug.spawnBall(s));
}

/** Take the match to a live rally with the ball posed exactly as asked. */
async function rally(
  h: Harness,
  mode: "solo" | "versus",
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): Promise<void> {
  openMatch(h, mode);
  h.pose((s) => h.debug.setBallHoldTimer(s, 0));
  await h.engine.advance(1); // the launch, through the build's own serve
  h.pose((s) => h.debug.setBallPosition(s, ball.x, ball.y));
  h.pose((s) => h.debug.setBallVelocity(s, ball.vx, ball.vy));
  h.pose((s) => h.debug.setBallSpin(s, ball.spin ?? 0));
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

/** The ball, which every rally check knows is present. */
function ball(h: Harness): NonNullable<CaromSnapshot["ball"]> {
  const found = h.snapshot().ball;
  if (!found) throw new Error("the ball is not in the field");
  return found;
}

/** The center of the hit region of item `index` on the current screen's menu. */
function itemCenter(h: Harness, index: number): { x: number; y: number } {
  const rect = h.debug.menuItemRect(h.state, index);
  if (!rect) throw new Error(`no region for item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with every field of the state present", () => {
    const snapshot = harness.snapshot();
    expect(snapshot.version).toBe(harness.debug.version);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.titleIndex).toBe(0);
    expect(snapshot.resumeScreen).toBe("playing");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    expect(snapshot.receiver).toBe("left");
    expect(snapshot.ai).toEqual({ tracking: true, movement: true });
    expect(snapshot.seed).toBe(DEFAULT_SEED);
    expect(snapshot.rngState).toBe(seedState(DEFAULT_SEED));
    expect(snapshot.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(snapshot.paddles.right).toEqual(snapshot.paddles.left);
    expect(snapshot.ball).toEqual({
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
    expect(snapshot.obstacles).toEqual([
      { index: 0, cx: OBSTACLE_CENTERS[0].x, cy: OBSTACLE_CENTERS[0].y },
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
    expect(snapshot.simTime).toBe(0);
  });

  it("loads no assets, so nothing can fail to arrive", async () => {
    await harness.engine.advance(10);
    expect(harness.assetFailures).toEqual([]);
  });

  it("runs frames off the clock it was given", async () => {
    await harness.engine.advance(30);
    expect(harness.engine.frame().count).toBe(30);
    expect(harness.engine.frame().timeMs).toBeCloseTo(500, 6);
    expect(harness.snapshot().simTime).toBeCloseTo(0.5, 9);
  });

  it("accumulates the clock on every screen, the menus included", async () => {
    await harness.engine.advance(30); // the title
    harness.pose((s) => harness.debug.setScreen(s, "paused"));
    await harness.engine.advance(30);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 9);
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
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("solo");
    expect(ball(harness).holdTimer).toBeCloseTo(HOLD_TIME - 1 / 60, 9);
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("wraps both ways over the title items", async () => {
    harness.tap("ArrowUp");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("moves up only when an up and a down edge arrive together", async () => {
    harness.tap("ArrowDown");
    harness.tap("ArrowUp");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("moves only when a movement edge and a confirm arrive together", async () => {
    harness.tap("ArrowDown");
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("starts a Versus match from the second item", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Space");
    await harness.engine.advance(1);
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().screen).toBe("countdown");
  });

  it("opens and leaves the how-to-play screen", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().menuIndex).toBe(0);

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("consumes a press exactly once", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(10);
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("does nothing for `back` on the title", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

// ---- The remembered title selection --------------------------------------

describe("the remembered title selection", () => {
  it("records the item confirmed and restores it on the way back", async () => {
    // HOW TO PLAY is the third item; confirming it remembers index 2.
    harness.pose((s) => harness.debug.setMenuIndex(s, 2));
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().titleIndex).toBe(2);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("comes back to VERSUS after a match started from it", async () => {
    harness.pose((s) => harness.debug.setMenuIndex(s, 1));
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().titleIndex).toBe(1);
    // A match opens with the pause menu's own selection at zero.
    expect(harness.snapshot().menuIndex).toBe(0);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.pose((s) => harness.debug.setMenuIndex(s, 2)); // QUIT TO MENU
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("comes back to it from the match-over screen too", async () => {
    harness.pose((s) => harness.debug.setTitleIndex(s, 1));
    harness.pose((s) => harness.debug.setScreen(s, "matchover"));
    harness.pose((s) => harness.debug.setMenuIndex(s, 1)); // MENU
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

// ---- Menus, from the pointer and from touch ------------------------------

describe("the menus under a pointer", () => {
  it("selects the item a pointer moves onto", async () => {
    const versus = itemCenter(harness, 1);
    harness.movePointer(versus.x, versus.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("selects nothing for a move into the gap between two items", async () => {
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    const between = (itemCenterY(menu, 0) + itemCenterY(menu, 1)) / 2;
    harness.movePointer(FIELD_CX, between);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("confirms an item pressed and released inside it, on one frame", async () => {
    const howto = itemCenter(harness, 2);
    harness.pressPointer(howto.x, howto.y);
    harness.releasePointer(howto.x, howto.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().titleIndex).toBe(2);
  });

  it("confirms across the frames a press and its release fall on", async () => {
    const versus = itemCenter(harness, 1);
    harness.pressPointer(versus.x, versus.y);
    await harness.engine.advance(3);
    expect(harness.snapshot().screen).toBe("title");
    harness.releasePointer(versus.x, versus.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
  });

  it("confirms nothing when a press slides off onto another item", async () => {
    const solo = itemCenter(harness, 0);
    const versus = itemCenter(harness, 1);
    harness.pressPointer(solo.x, solo.y);
    await harness.engine.advance(1);
    harness.movePointer(versus.x, versus.y);
    await harness.engine.advance(1);
    harness.releasePointer(versus.x, versus.y);
    await harness.engine.advance(1);
    // The slide selected the item it travelled onto, and confirmed nothing.
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("confirms nothing for a release outside every region", async () => {
    const solo = itemCenter(harness, 0);
    harness.pressPointer(solo.x, solo.y);
    harness.releasePointer(solo.x, 12);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("confirms nothing for a press that began outside every region", async () => {
    const solo = itemCenter(harness, 0);
    harness.pressPointer(solo.x, 12);
    harness.releasePointer(solo.x, solo.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("leaves menuIndex where the pointer put it when a key moved too", async () => {
    const howto = itemCenter(harness, 2);
    harness.tap("ArrowDown"); // the keyboard would leave it on 1
    harness.movePointer(howto.x, howto.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", async () => {
    const howto = itemCenter(harness, 2);
    // The keyboard's selection is SOLO; the pointer taps HOW TO PLAY.
    harness.tap("Enter");
    harness.pressPointer(howto.x, howto.y);
    harness.releasePointer(howto.x, howto.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().titleIndex).toBe(0);
  });

  it("drives the pause menu the same way", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");

    const quit = itemCenter(harness, 2);
    harness.pressPointer(quit.x, quit.y);
    harness.releasePointer(quit.x, quit.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("leaves the how-to screen from its own single item", async () => {
    harness.pose((s) => harness.debug.setScreen(s, "howto"));
    const back = itemCenter(harness, 0);
    harness.pressPointer(back.x, back.y);
    harness.releasePointer(back.x, back.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });
});

describe("the menus under touch", () => {
  it("selects on a landing, because a finger does not hover", async () => {
    const versus = itemCenter(harness, 1);
    harness.pressPointer(versus.x, versus.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("confirms a contact that lands and lifts inside one item", async () => {
    const versus = itemCenter(harness, 1);
    harness.pressPointer(versus.x, versus.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    harness.releasePointer(versus.x, versus.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("confirms nothing for a contact that travels onto another item", async () => {
    const solo = itemCenter(harness, 0);
    const versus = itemCenter(harness, 1);
    harness.pressPointer(solo.x, solo.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    harness.movePointer(versus.x, versus.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    harness.releasePointer(versus.x, versus.y, { device: "touch", id: 7 });
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");
  });
});

// ---- Controls -----------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );

    harness.release("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("drives player one from either slider in Solo", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("ArrowDown");
    await harness.engine.advance(frames(0.1));
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
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
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY);
  });

  it("reads both sliders as one up and one down in Solo", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    // Both ups and one down: `up` and `down` are each 1, so the axis is 0.
    harness.hold("KeyW");
    harness.hold("ArrowUp");
    harness.hold("KeyS");
    await harness.engine.advance(30);
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    harness.hold("ArrowDown");
    await harness.engine.advance(frames(0.1));
    expect(harness.snapshot().paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY);
  });
});

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(frames(HOLD_TIME) - 1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(ball(harness).held).toBe(true);

    await harness.engine.advance(2);
    expect(harness.snapshot().screen).toBe("playing");
    expect(ball(harness).held).toBe(false);
    expect(ball(harness).holdTimer).toBe(0);
  });

  it("sends the first serve of a match toward player one", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(frames(HOLD_TIME) + 1);
    expect(ball(harness).vx).toBeLessThan(0);
    expect(ball(harness).speed).toBeCloseTo(SERVE_SPEED, 6);
  });

  it("serves at exactly SERVE_ANGLE from horizontal", async () => {
    openMatch(harness, "versus");
    harness.pose((s) => harness.debug.setBallHoldTimer(s, 0));
    await harness.engine.advance(1);
    const served = ball(harness);
    // The deviation from horizontal, whichever way the serve is travelling.
    expect(Math.abs(Math.atan2(served.vy, Math.abs(served.vx)))).toBeCloseTo(
      SERVE_ANGLE,
      9,
    );
  });

  it("replays the same serve from the same seed", async () => {
    const other = await createHarness();
    try {
      for (const h of [harness, other]) {
        h.pose((s) => h.debug.setSeed(s, 4242));
        openMatch(h, "versus");
        h.pose((s) => h.debug.setBallHoldTimer(s, 0));
        await h.engine.advance(1);
      }
      expect(ball(other).vy).toBe(ball(harness).vy);
      expect(other.snapshot().seed).toBe(4242);
    } finally {
      other.dispose();
    }
  });
});

// ---- Physics, through the engine ----------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", { x: 120, y: FIELD_CY, vx: -600, vy: 0 });
    harness.pose((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.pose((s) => harness.debug.setPaddleVy(s, "left", 200));
    harness.cues.length = 0;

    await harness.engine.advance(6);

    expect(played(harness)).toEqual([CUES.paddleHit]);
    expect(ball(harness).vx).toBeGreaterThan(0);
    // The paddle was travelling down at 200 units per second when it struck.
    expect(ball(harness).spin).toBeGreaterThan(0.9 * 200 * SPIN_FROM_PADDLE);
    expect(ball(harness).spin).toBeLessThanOrEqual(200 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", async () => {
    await rally(harness, "versus", { x: FIELD_CX, y: 20, vx: 0, vy: -600 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.wallBounce]);
    expect(ball(harness).vy).toBeGreaterThan(0);
  });

  it("bounces off an obstacle and plays the obstacle cue", async () => {
    await rally(harness, "versus", { x: 450, y: 220, vx: 600, vy: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(3);

    expect(played(harness)).toEqual([CUES.obstacleBounce]);
    expect(ball(harness).vx).toBeLessThan(0);
  });

  it("records a trail that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(60);
    const slow = ball(harness).trail.length;

    const fast = await createHarness(new ConstantClock(1000 / 240));
    try {
      await rally(fast, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
      await fast.engine.advance(240);
      expect(ball(fast).trail.length).toBeGreaterThan(slow);
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

      const slowBall = ball(harness);
      const fastBall = ball(fast);
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

    expect(harness.snapshot().score).toEqual({ p1: 1, p2: 0 });
    expect(played(harness)).toEqual([CUES.score]);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().receiver).toBe("right");

    await harness.engine.advance(frames(HOLD_TIME) + 1);
    expect(ball(harness).vx).toBeGreaterThan(0);
  });

  it("gives the point to player two when the ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 0, y: FIELD_CY, vx: -600, vy: 0 });
    await harness.engine.advance(4);
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 1 });
    expect(harness.snapshot().receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.pose((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );

    await harness.engine.advance(4);

    expect(harness.snapshot().score.p1).toBe(WIN_SCORE);
    expect(harness.snapshot().winner).toBe("left");
    expect(harness.snapshot().screen).toBe("matchover");
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.pose((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 1),
    );

    await harness.engine.advance(4);

    expect(harness.snapshot().score).toEqual({
      p1: WIN_SCORE,
      p2: WIN_SCORE - 1,
    });
    expect(harness.snapshot().winner).toBeNull();
    expect(harness.snapshot().screen).toBe("countdown");
  });

  it("offers a rematch from the match-over screen", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.pose((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
    expect(harness.snapshot().winner).toBeNull();
  });

  it("returns to the title from the match-over screen on Escape", async () => {
    await rally(harness, "versus", { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 });
    harness.pose((s) =>
      harness.debug.setScore(s, WIN_SCORE - 1, WIN_SCORE - 2),
    );
    await harness.engine.advance(4);
    expect(harness.snapshot().screen).toBe("matchover");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(0);
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
    expect(harness.snapshot().winner).toBeNull();
  });
});

// ---- Pause and mute -----------------------------------------------------

describe("pause", () => {
  it("freezes the field and resumes where it left off", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    await harness.engine.advance(6);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    expect(harness.snapshot().resumeScreen).toBe("playing");

    const frozen = ball(harness).x;
    await harness.engine.advance(60);
    expect(ball(harness).x).toBe(frozen);

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("resumes on P as well as on Escape", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("opens and leaves the pause menu once for one Escape each way", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    // Escape raises `pause` and `back` together; on a live match only `pause` is
    // read, so the menu opens and stays open.
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    await harness.engine.advance(5);
    expect(harness.snapshot().screen).toBe("paused");

    // On the pause menu both are read, and either resumes — once.
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("pauses out of the countdown and resumes back into it", async () => {
    openMatch(harness, "versus");
    await harness.engine.advance(2);
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    expect(harness.snapshot().resumeScreen).toBe("countdown");

    const frozen = ball(harness).holdTimer;
    await harness.engine.advance(30);
    expect(ball(harness).holdTimer).toBe(frozen);

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
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

    expect(harness.snapshot().screen).toBe("title");
  });

  it("restarts the match in the same mode from the pause menu", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.pose((s) => harness.debug.setScore(s, 4, 2));
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.pose((s) => harness.debug.setMenuIndex(s, 1)); // RESTART
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
  });
});

describe("mute", () => {
  it("toggles the engine's mute bit from any screen and mirrors it", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.snapshot().muted).toBe(true);

    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.snapshot().muted).toBe(false);
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

  it("is the one bit a reset leaves alone", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    harness.pose((s) => harness.debug.reset(s));
    await harness.engine.advance(1);
    expect(harness.snapshot().muted).toBe(true);
    expect(harness.snapshot().screen).toBe("title");
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  /**
   * Every operation specs/instrumentation.md names, in the order it introduces
   * them. `setReceiver` is here because this variant plays with one ball and a
   * receiver; the obstacle-clock operations are another variant's.
   */
  const OPERATIONS = [
    "clearWorld",
    "spawnBall",
    "spawnObstacle",
    "reset",
    "setSeed",
    "setScreen",
    "setMode",
    "setMenuIndex",
    "setTitleIndex",
    "setResumeScreen",
    "setScore",
    "setWinner",
    "setReceiver",
    "setPaddleCy",
    "setPaddleVy",
    "setPaddleDriven",
    "setBallPosition",
    "setBallVelocity",
    "setBallSpin",
    "setBallHeld",
    "setBallHoldTimer",
    "setAiTracking",
    "setAiMovement",
    "setMuted",
    "snapshot",
    "menuItemRect",
  ] as const;

  /** The operations the specification retired, which must be gone. */
  const RETIRED = [
    "startMatch",
    "serve",
    "setAiControl",
    "setPaddle",
    "setBall",
    "setAutoStep",
    "advance",
  ] as const;

  it("carries a version and every operation, as functions, and no retired one", () => {
    const api = harness.engine.debug as unknown as Record<string, unknown>;
    expect(typeof api.version).toBe("number");
    for (const op of OPERATIONS) {
      expect(typeof api[op]).toBe("function");
    }
    for (const op of RETIRED) {
      expect(api[op]).toBeUndefined();
    }
  });

  it("is the one object the engine hands back, unchanged", () => {
    expect(harness.engine.debug).toBe(harness.debug);
    expect(harness.engine.debug).not.toBeNull();
  });

  it("drives one paddle at a time and leaves the other to its owner", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter"); // Versus, so both paddles are a player's
    await harness.engine.advance(1);

    harness.pose((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.pose((s) => harness.debug.setPaddleVy(s, "left", 300));
    expect(harness.snapshot().paddles.left.driven).toBe(true);
    expect(harness.snapshot().paddles.right.driven).toBe(false);

    harness.hold("KeyW"); // ignored: the surface has the left paddle
    harness.hold("ArrowDown"); // player two still has the right one
    await harness.engine.advance(frames(0.1));

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY + 30, 6);
    expect(harness.snapshot().paddles.right.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("keeps drivenVy and vy as two separate fields", async () => {
    openMatch(harness, "versus");
    harness.pose((s) => harness.debug.setPaddleVy(s, "left", 300));
    // Set but not yet driven: the velocity is held, and no frame has used it.
    expect(harness.snapshot().paddles.left.drivenVy).toBe(300);
    expect(harness.snapshot().paddles.left.vy).toBe(0);

    harness.pose((s) => harness.debug.setPaddleDriven(s, "left", true));
    await harness.engine.advance(1);
    expect(harness.snapshot().paddles.left.vy).toBe(300);
    expect(harness.snapshot().paddles.left.drivenVy).toBe(300);
  });

  it("hands both paddles back on reset", async () => {
    openMatch(harness, "versus");
    harness.pose((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.pose((s) => harness.debug.setPaddleVy(s, "left", 300));
    harness.pose((s) => harness.debug.reset(s));
    expect(harness.snapshot().paddles.left.driven).toBe(false);
    expect(harness.snapshot().paddles.left.drivenVy).toBe(0);
    expect(harness.snapshot().screen).toBe("title");

    harness.tap("Enter");
    await harness.engine.advance(1);
    harness.hold("KeyW");
    await harness.engine.advance(frames(0.1));
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY - PADDLE_SPEED * 0.1,
      6,
    );
  });

  it("runs the real AI against a posed shot", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.pose((s) => harness.debug.setPaddleDriven(s, "left", true));
    harness.pose((s) => harness.debug.setPaddleCy(s, "right", 600));

    await harness.engine.advance(30);

    expect(harness.snapshot().paddles.right.cy).toBeLessThan(600);
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY); // still driven
  });

  it("returns the AI paddle home and stops within AI_HOME_DEADZONE", async () => {
    await rally(harness, "solo", { x: 600, y: FIELD_CY, vx: -300, vy: 0 });
    harness.pose((s) => harness.debug.setPaddleCy(s, "right", 600));
    await harness.engine.advance(60);

    const right = harness.snapshot().paddles.right;
    expect(Math.abs(right.cy - AI_HOME_Y)).toBeLessThanOrEqual(
      AI_HOME_DEADZONE,
    );
    expect(right.vy).toBe(0);
  });

  it("gates the AI's two faculties one at a time", async () => {
    await rally(harness, "solo", { x: 900, y: 180, vx: 400, vy: 0 });
    harness.pose((s) => harness.debug.setPaddleCy(s, "right", 600));
    harness.pose((s) => harness.debug.setAiTracking(s, false));
    await harness.engine.advance(30);
    // Blind, it heads home rather than up to meet the ball at y = 180.
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(600);
    expect(harness.snapshot().paddles.right.cy).toBeGreaterThan(AI_HOME_Y);

    harness.pose((s) => harness.debug.setAiMovement(s, false));
    const parked = harness.snapshot().paddles.right.cy;
    await harness.engine.advance(30);
    expect(harness.snapshot().paddles.right.cy).toBe(parked);
    expect(harness.snapshot().paddles.right.vy).toBe(0);
    expect(harness.snapshot().ai).toEqual({
      tracking: false,
      movement: false,
    });
  });

  it("empties the field and spawns it back", async () => {
    await rally(harness, "versus", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });

    harness.pose((s) => harness.debug.clearWorld(s));
    expect(harness.snapshot().ball).toBeNull();
    expect(harness.snapshot().obstacles).toEqual([]);
    // The paddles stay, and an absent ball scores no point and is not advanced.
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY);
    await harness.engine.advance(60);
    expect(harness.snapshot().ball).toBeNull();
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });

    harness.pose((s) => harness.debug.spawnObstacle(s, 1));
    expect(harness.snapshot().obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
    harness.pose((s) => harness.debug.spawnObstacle(s, 0));
    expect(harness.snapshot().obstacles.map((o) => o.index)).toEqual([0, 1]);
    // Spawning one already present returns it to its arrangement rather than
    // adding a second.
    harness.pose((s) => harness.debug.spawnObstacle(s, 0));
    expect(harness.snapshot().obstacles).toHaveLength(2);
    // An index the field has no obstacle for changes nothing.
    harness.pose((s) => harness.debug.spawnObstacle(s, 5));
    expect(harness.snapshot().obstacles).toHaveLength(2);

    harness.pose((s) => harness.debug.spawnBall(s));
    expect(ball(harness).held).toBe(true);
    expect(ball(harness).holdTimer).toBe(HOLD_TIME);
    expect(ball(harness).trail).toEqual([]);
  });

  it("leaves every ball operation inert while no ball is present", () => {
    harness.pose((s) => harness.debug.clearWorld(s));
    harness.pose((s) => harness.debug.setBallPosition(s, 10, 20));
    harness.pose((s) => harness.debug.setBallVelocity(s, 1, 2));
    harness.pose((s) => harness.debug.setBallSpin(s, 5));
    harness.pose((s) => harness.debug.setBallHeld(s, false));
    harness.pose((s) => harness.debug.setBallHoldTimer(s, 0));
    expect(harness.snapshot().ball).toBeNull();
  });

  it("reports every field it sets, one operation at a time", () => {
    harness.pose((s) => harness.debug.setScreen(s, "paused"));
    harness.pose((s) => harness.debug.setMode(s, "versus"));
    harness.pose((s) => harness.debug.setMenuIndex(s, 2));
    harness.pose((s) => harness.debug.setTitleIndex(s, 1));
    harness.pose((s) => harness.debug.setResumeScreen(s, "countdown"));
    harness.pose((s) => harness.debug.setScore(s, 3, 4));
    harness.pose((s) => harness.debug.setWinner(s, "right"));
    harness.pose((s) => harness.debug.setReceiver(s, "right"));
    harness.pose((s) => harness.debug.setPaddleCy(s, "right", 200));
    harness.pose((s) => harness.debug.setSeed(s, 99));
    harness.pose((s) => harness.debug.setBallPosition(s, 400, 300));
    harness.pose((s) => harness.debug.setBallVelocity(s, 120, -80));
    harness.pose((s) => harness.debug.setBallSpin(s, 42));
    harness.pose((s) => harness.debug.setBallHeld(s, false));
    harness.pose((s) => harness.debug.setBallHoldTimer(s, 0.25));

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("paused");
    expect(snapshot.mode).toBe("versus");
    expect(snapshot.menuIndex).toBe(2);
    expect(snapshot.titleIndex).toBe(1);
    expect(snapshot.resumeScreen).toBe("countdown");
    expect(snapshot.score).toEqual({ p1: 3, p2: 4 });
    expect(snapshot.winner).toBe("right");
    expect(snapshot.receiver).toBe("right");
    expect(snapshot.paddles.right.cy).toBe(200);
    expect(snapshot.seed).toBe(99);
    expect(snapshot.rngState).toBe(seedState(99));
    expect(snapshot.ball).toMatchObject({
      x: 400,
      y: 300,
      vx: 120,
      vy: -80,
      spin: 42,
      held: false,
      holdTimer: 0.25,
    });
    expect(snapshot.ball?.speed).toBeCloseTo(Math.hypot(120, -80), 9);
    // `setWinner(null)` clears it again.
    harness.pose((s) => harness.debug.setWinner(s, null));
    expect(harness.snapshot().winner).toBeNull();
  });

  it("leaves the state it was handed alone", () => {
    const before = harness.state;
    const posed = harness.debug.setScore(before, 5, 6);
    expect(posed).not.toBe(before);
    expect(harness.debug.snapshot(before).score).toEqual({ p1: 0, p2: 0 });
    expect(harness.debug.snapshot(posed).score).toEqual({ p1: 5, p2: 6 });
    // The engine's own state is untouched until a pose is applied.
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
  });

  it("reports the hit region of the menu the screen shows, and no other", () => {
    // The title's three items, in the order they are drawn.
    const first = harness.debug.menuItemRect(harness.state, 0);
    const second = harness.debug.menuItemRect(harness.state, 1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.y).toBeGreaterThan(first?.y ?? 0);
    expect(harness.debug.menuItemRect(harness.state, 3)).toBeNull();
    expect(harness.debug.menuItemRect(harness.state, -1)).toBeNull();

    for (const screen of ["countdown", "playing"] as const) {
      harness.pose((s) => harness.debug.setScreen(s, screen));
      expect(harness.debug.menuItemRect(harness.state, 0)).toBeNull();
    }

    harness.pose((s) => harness.debug.setScreen(s, "matchover"));
    expect(harness.debug.menuItemRect(harness.state, 1)).not.toBeNull();
    expect(harness.debug.menuItemRect(harness.state, 2)).toBeNull();
  });

  it("restores the whole title screen on reset", async () => {
    await rally(harness, "solo", { x: 300, y: FIELD_CY, vx: 400, vy: 0 });
    harness.pose((s) => harness.debug.setScore(s, 3, 4));
    harness.pose((s) => harness.debug.setTitleIndex(s, 2));
    harness.pose((s) => harness.debug.setAiTracking(s, false));
    harness.pose((s) => harness.debug.clearWorld(s));

    harness.pose((s) => harness.debug.reset(s));
    const title = harness.snapshot();
    expect(title.screen).toBe("title");
    expect(title.mode).toBe("solo");
    expect(title.menuIndex).toBe(0);
    expect(title.titleIndex).toBe(0);
    expect(title.resumeScreen).toBe("playing");
    expect(title.score).toEqual({ p1: 0, p2: 0 });
    expect(title.winner).toBeNull();
    expect(title.receiver).toBe("left");
    expect(title.ai).toEqual({ tracking: true, movement: true });
    expect(title.paddles.left.cy).toBe(FIELD_CY);
    expect(title.paddles.right.cy).toBe(FIELD_CY);
    expect(title.ball?.held).toBe(true);
    expect(title.obstacles).toHaveLength(2);
    expect(title.simTime).toBe(0);
    expect(title.seed).toBe(DEFAULT_SEED);
    expect(title.rngState).toBe(seedState(DEFAULT_SEED));
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

  it("draws the ball as one arc at its own position", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const arcs = callsTo(harness.calls, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].slice(0, 3)).toEqual([400, 300, BALL_R]);
    expect(harness.pixel(400, 300)).toEqual([242, 245, 247, 255]);
  });

  it("draws no ball at all once the field has been cleared", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 0, vy: 0 });
    harness.pose((s) => harness.debug.clearWorld(s));
    harness.calls.length = 0;
    await harness.engine.advance(1);
    expect(callsTo(harness.calls, "arc")).toHaveLength(0);
  });

  it("draws each score as its own text on its own side of center", async () => {
    openMatch(harness, "versus");
    harness.pose((s) => harness.debug.setScore(s, 7, 9));
    harness.calls.length = 0;
    await harness.engine.advance(1);

    const texts = callsTo(harness.calls, "fillText");
    const p1 = texts.find((args) => args[0] === "7");
    const p2 = texts.find((args) => args[0] === "9");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1?.[1]).toBeLessThan(FIELD_CX);
    expect(p2?.[1]).toBeGreaterThan(FIELD_CX);
  });

  it("draws every menu item on the row its hit region names", async () => {
    harness.calls.length = 0;
    await harness.engine.advance(1);
    const texts = callsTo(harness.calls, "fillText");
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    for (let i = 0; i < menu.items.length; i++) {
      const drawn = texts.find((args) => args[0] === menu.items[i]);
      expect(drawn).toBeDefined();
      const rect = harness.debug.menuItemRect(harness.state, i);
      expect(rect).not.toBeNull();
      expect(drawn?.[2]).toBeCloseTo((rect?.y ?? 0) + (rect?.h ?? 0) / 2, 6);
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

  it("draws every screen without reaching for something that is gone", async () => {
    harness.pose((s) => harness.debug.clearWorld(s));
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "matchover",
    ] as const) {
      harness.pose((s) => harness.debug.setScreen(s, screen));
      await harness.engine.advance(1);
      expect(harness.snapshot().screen).toBe(screen);
    }
  });
});
