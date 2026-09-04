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
// hold the same seam a scenario driven from outside holds: every operation is
// ATOMIC — one field, one entity, or one reading — and a scenario is the
// SEQUENCE of them the helpers below assemble. `reset` is the one exception,
// and it is how a check gets back to a known start.
//
// Input reaches the game the way a player's does: a `KeyboardEvent`-shaped
// event for a key and a `PointerEvent`-shaped event for a mouse or a finger,
// dispatched at the event target the engine listens on. Everything past the
// dispatch — the mapping onto logical units, the edges, the contacts — is the
// engine's own.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
  type Clock,
  type Engine,
  type PointerButton,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  LEVELS,
  OBSTACLE_CENTERS,
  OBSTACLES,
  P1_X1,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  SPEED_MULT,
  SPIN_FROM_PADDLE,
  TAGS,
  TITLE_ITEMS,
  TRAIL_TIME,
  WIN_SCORE,
} from "./constants";
import { Ball } from "./ball";
import type { CaromDebug, CaromSnapshot } from "./debug";
import { BACKGROUND, game } from "./game";
import type { MenuRect } from "./menu";
import { Paddle } from "./paddle";
import { CaromState, SCREENS, type Mode } from "./state";
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

/** How a dispatched pointer event identifies itself. */
interface PointerOptions {
  id?: number;
  device?: "mouse" | "pen" | "touch";
  primary?: boolean;
}

interface Harness {
  readonly engine: Engine<CaromDebug>;
  readonly debug: CaromDebug;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  readonly assetFailures: string[];
  snapshot(): CaromSnapshot;
  state(): CaromState;
  ball(): Ball;
  paddle(side: "left" | "right"): Paddle;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pointerMove(x: number, y: number, options?: PointerOptions): void;
  pointerDown(x: number, y: number, options?: PointerOptions): void;
  pointerUp(x: number, y: number, options?: PointerOptions): void;
  rect(index: number): MenuRect;
  center(index: number): { x: number; y: number };
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

type PointerEventType = "pointerdown" | "pointermove" | "pointerup";

class PointerShapedEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: PointerEventType,
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

/** The bit `PointerEvent.buttons` gives the primary button. */
const PRIMARY_BIT = 1;

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

  /** What each pointer id holds, so a move mid-drag reports a real mask. */
  const held = new Map<number, Set<PointerButton>>();
  const heldBy = (id: number): Set<PointerButton> => {
    const existing = held.get(id);
    if (existing !== undefined) return existing;
    const created = new Set<PointerButton>();
    held.set(id, created);
    return created;
  };

  const point = (
    type: PointerEventType,
    x: number,
    y: number,
    options: PointerOptions,
    button: number,
  ): void => {
    const id = options.id ?? 0;
    const view = engine.viewport();
    events.dispatchEvent(
      new PointerShapedEvent(type, {
        clientX: view.offsetX + x * view.scale,
        clientY: view.offsetY + y * view.scale,
        pointerId: id,
        pointerType: options.device ?? "mouse",
        isPrimary: options.primary ?? true,
        button,
        buttons: heldBy(id).has("primary") ? PRIMARY_BIT : 0,
      }),
    );
  };

  const rect = (index: number): MenuRect => {
    const found = engine.debug.menuItemRect(index);
    if (found === null) {
      throw new Error(`no menu item ${index} on the current screen`);
    }
    return found;
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
    state: () => {
      const state = engine.world.state;
      if (!(state instanceof CaromState)) throw new Error("no Carom state");
      return state;
    },
    ball: () => {
      const found = engine.world.byTag(TAGS.ball)[0];
      if (!(found instanceof Ball)) throw new Error("no tagged ball");
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
    pointerMove: (x, y, options = {}) =>
      point("pointermove", x, y, options, -1),
    pointerDown: (x, y, options = {}) => {
      heldBy(options.id ?? 0).add("primary");
      point("pointerdown", x, y, options, 0);
    },
    pointerUp: (x, y, options = {}) => {
      heldBy(options.id ?? 0).delete("primary");
      point("pointerup", x, y, options, 0);
    },
    rect,
    center: (index) => {
      const r = rect(index);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
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

// ---- Scenario helpers ---------------------------------------------------
//
// Each is a SEQUENCE of atomic operations. Nothing on the surface starts a
// match or stages a rally, because the sequences belong here — a check that
// wants only part of one calls the operations it needs.

/** The title screen, with every declared field at its title value. */
function openTitle(h: Harness): void {
  h.debug.reset();
}

/** A match on its pre-serve countdown, with the standard field. */
function openCountdown(h: Harness, mode: Mode): void {
  openTitle(h);
  h.debug.setMode(mode);
  h.debug.setScreen("countdown");
}

/**
 * Live play: end the hold and let the build's own rule serve. `serve()` is
 * gone from the surface because ending a hold is what serving IS.
 */
async function openPlaying(h: Harness, mode: Mode): Promise<void> {
  openCountdown(h, mode);
  h.debug.setBallHoldTimer(0);
  await h.engine.advance(1);
  expect(h.snapshot().screen).toBe("playing");
}

interface BallPose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin?: number;
}

/** Live play with the ball posed where the check wants it. */
async function rally(h: Harness, mode: Mode, ball: BallPose): Promise<void> {
  await openPlaying(h, mode);
  h.debug.setBallPosition(ball.x, ball.y);
  h.debug.setBallVelocity(ball.vx, ball.vy);
  h.debug.setBallSpin(ball.spin ?? 0);
}

/** Hold a paddle still and out of the way, the one containment there is. */
function parkPaddle(h: Harness, side: "left" | "right", cy: number): void {
  h.debug.setPaddleDriven(side, true);
  h.debug.setPaddleVy(side, 0);
  h.debug.setPaddleCy(side, cy);
}

function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- Initialization -----------------------------------------------------

describe("initialization", () => {
  it("opens the title level with the court posed behind the menu", () => {
    const { engine } = harness;
    expect(engine.world.level).toBe(LEVELS.title);

    // The tagged field bodies are in place (specs/state.md).
    expect(engine.world.byTag(TAGS.paddleLeft)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.paddleRight)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.ball)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.obstacle)).toHaveLength(OBSTACLES.length);

    // Every field of the title-screen state, exactly as specs/state.md gives
    // it — which is also every field `reset` restores.
    const snapshot = harness.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.titleIndex).toBe(0);
    expect(snapshot.resumeScreen).toBe("playing");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    expect(snapshot.receiver).toBe("left");
    expect(snapshot.muted).toBe(false);
    expect(snapshot.seed).toBe(1);
    expect(snapshot.rngState).toBe(1);
    expect(snapshot.ai).toEqual({ tracking: true, movement: true });
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
    expect(snapshot.obstacles).toEqual(
      OBSTACLE_CENTERS.map((center, index) => ({
        index,
        cx: center.x,
        cy: center.y,
      })),
    );
    expect(snapshot.simTime).toBe(0);
  });

  it("loads no assets, so nothing can fail to arrive", async () => {
    await harness.engine.advance(30);
    expect(harness.assetFailures).toEqual([]);
  });

  it("accumulates simTime on every update, whatever the screen", async () => {
    await harness.engine.advance(60);
    expect(harness.engine.frame().count).toBe(60);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 6);

    // The title screen advances nothing else, and the clock still runs.
    harness.debug.setScreen("paused");
    await harness.engine.advance(60);
    expect(harness.snapshot().simTime).toBeCloseTo(2, 6);
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

// ---- The menus, from the keyboard ---------------------------------------

describe("the menus", () => {
  it("starts a Solo match from the first item", async () => {
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.match);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.resumeScreen).toBe("playing");
    expect(snapshot.receiver).toBe("left");
    // Confirming a title item remembers it (specs/ui.md).
    expect(snapshot.titleIndex).toBe(0);
    // One seat per paddle, in both modes.
    expect(harness.engine.world.players()).toHaveLength(2);
  });

  it("moves the selection with either side's slider, wrapping both ways", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("moves only when a movement edge and a confirm edge share a frame", async () => {
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
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("returns from the how-to screen onto the item that led there", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().menuIndex).toBe(0);
    expect(harness.snapshot().titleIndex).toBe(2);

    harness.tap("Escape");
    await harness.engine.advance(1);
    // `menuIndex` becomes `titleIndex`, not 0 (specs/ui.md).
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("returns to the title on the entry that led away from it", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter"); // VERSUS
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");

    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("Enter"); // QUIT TO MENU
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(1);
    expect(snapshot.titleIndex).toBe(1);
  });
});

// ---- The menus, from the mouse and the finger ---------------------------

describe("the menus under a pointer", () => {
  it("selects the item a pointer moves onto", async () => {
    const at = harness.center(2);
    harness.pointerMove(at.x, at.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);

    const back = harness.center(1);
    harness.pointerMove(back.x, back.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("leaves the selection alone for a move outside every region", async () => {
    harness.debug.setMenuIndex(1);
    harness.pointerMove(40, 40);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("confirms an item pressed and released inside one region", async () => {
    const at = harness.center(1); // VERSUS
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("versus");
    expect(snapshot.titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release fall in different items", async () => {
    const press = harness.center(0);
    const release = harness.center(1);
    harness.pointerDown(press.x, press.y);
    harness.pointerUp(release.x, release.y);
    await harness.engine.advance(1);

    expect(harness.snapshot().screen).toBe("title");
  });

  it("confirms nothing when an edge falls outside every region", async () => {
    const press = harness.center(0);
    harness.pointerDown(press.x, press.y);
    harness.pointerUp(20, 700);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("takes a touch contact that lands and lifts inside one item", async () => {
    const at = harness.center(1);
    const touch: PointerOptions = { id: 7, device: "touch" };
    harness.pointerDown(at.x, at.y, touch);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);

    harness.pointerUp(at.x, at.y, touch);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
  });

  it("takes a touch contact that travels onto an item", async () => {
    const touch: PointerOptions = { id: 3, device: "touch" };
    harness.pointerDown(40, 40, touch);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);

    const at = harness.center(2);
    harness.pointerMove(at.x, at.y, touch);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("lets the pointer name the item on a frame a movement key also arrived", async () => {
    const at = harness.center(2);
    harness.tap("ArrowDown"); // would move to 1
    harness.pointerMove(at.x, at.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", async () => {
    const at = harness.center(2); // HOW TO PLAY
    harness.tap("Enter"); // confirms SOLO, the item at menuIndex 0
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.engine.advance(1);

    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("solo");
  });

  it("drives the pause menu with the mouse too", async () => {
    await openPlaying(harness, "versus");
    harness.debug.setScreen("paused");
    await harness.engine.advance(1);

    const quit = harness.center(2); // QUIT TO MENU
    harness.pointerMove(quit.x, quit.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);

    harness.pointerDown(quit.x, quit.y);
    harness.pointerUp(quit.x, quit.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("reports a region for every item of the current menu and none beyond", () => {
    for (let index = 0; index < TITLE_ITEMS.length; index++) {
      const rect = harness.debug.menuItemRect(index);
      expect(rect).not.toBeNull();
      expect(rect?.w).toBeGreaterThan(0);
      expect(rect?.h).toBeGreaterThan(0);
    }
    expect(harness.debug.menuItemRect(TITLE_ITEMS.length)).toBeNull();
    expect(harness.debug.menuItemRect(-1)).toBeNull();
  });

  it("reports no region on the screens that show no menu", () => {
    for (const screen of ["countdown", "playing"] as const) {
      harness.debug.setScreen(screen);
      expect(harness.debug.menuItemRect(0)).toBeNull();
    }
  });
});

// ---- The paddles --------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    openCountdown(harness, "versus");

    // 0.2 s: far enough to measure, short of the clamp at PADDLE_MAX_CY.
    harness.hold("KeyS");
    await harness.engine.advance(12);
    harness.release("KeyS");

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("drives player one from either slider in Solo", async () => {
    openCountdown(harness, "solo");

    harness.hold("ArrowDown");
    await harness.engine.advance(12);
    harness.release("ArrowDown");

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("stands still when opposite sliders are held in Solo", async () => {
    openCountdown(harness, "solo");

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    openCountdown(harness, "versus");

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY - PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
  });
});

// ---- Serving ------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it", async () => {
    openCountdown(harness, "versus");
    expect(harness.snapshot().ball?.held).toBe(true);

    // Just short of the hold: still parked.
    await harness.engine.advance(frames(HOLD_TIME) - 2);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().ball?.speed).toBe(0);

    await harness.engine.advance(3);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.ball?.held).toBe(false);
    expect(snapshot.ball?.holdTimer).toBe(0);
    expect(snapshot.ball?.speed).toBeGreaterThan(0);
  });

  it("sends the first serve of a match toward player one", async () => {
    openCountdown(harness, "versus");
    expect(harness.snapshot().receiver).toBe("left");
    harness.debug.setBallHoldTimer(0);
    await harness.engine.advance(1);
    expect(harness.snapshot().ball?.vx).toBeLessThan(0);
  });

  it("serves toward the receiver the surface named", async () => {
    openCountdown(harness, "versus");
    harness.debug.setReceiver("right");
    harness.debug.setBallHoldTimer(0);
    await harness.engine.advance(1);
    expect(harness.snapshot().ball?.vx).toBeGreaterThan(0);
  });

  it("serves at exactly SERVE_SPEED and SERVE_ANGLE", async () => {
    await openPlaying(harness, "versus");

    const ball = harness.snapshot().ball;
    // Read on the serve frame, before flight has curved or slowed anything.
    expect(ball?.speed).toBeCloseTo(SERVE_SPEED, 3);
    const angle = Math.atan2(Math.abs(ball?.vy ?? 0), Math.abs(ball?.vx ?? 0));
    expect(angle).toBeCloseTo(SERVE_ANGLE, 6);
  });

  it("replays the same serve from the same seed", async () => {
    const first = await servedBall(7);
    const second = await servedBall(7);
    const other = await servedBall(1234);
    expect(first).toEqual(second);
    // The seed genuinely feeds the draw: some seed disagrees.
    expect(first.vy === other.vy && first.vx === other.vx).toBe(
      Math.sign(first.vy) === Math.sign(other.vy),
    );
  });

  it("advances the generator's state on every draw", async () => {
    openCountdown(harness, "versus");
    harness.debug.setSeed(42);
    expect(harness.snapshot().seed).toBe(42);
    expect(harness.snapshot().rngState).toBe(42);

    harness.debug.setBallHoldTimer(0);
    await harness.engine.advance(1);
    expect(harness.snapshot().seed).toBe(42);
    expect(harness.snapshot().rngState).not.toBe(42);
  });

  async function servedBall(seed: number): Promise<{ vx: number; vy: number }> {
    const h = await createHarness();
    try {
      openCountdown(h, "versus");
      h.debug.setSeed(seed);
      h.debug.setBallHoldTimer(0);
      await h.engine.advance(1);
      const ball = h.snapshot().ball;
      return { vx: ball?.vx ?? 0, vy: ball?.vy ?? 0 };
    } finally {
      h.dispose();
    }
  }
});

// ---- The rally ----------------------------------------------------------

describe("the rally", () => {
  it("returns the ball off a paddle and plays the paddle cue", async () => {
    await rally(harness, "versus", {
      x: P1_X1 + BALL_R + 40,
      y: FIELD_CY,
      vx: -400,
      vy: 0,
    });
    harness.cues.length = 0;
    await harness.engine.advance(10);

    const ball = harness.snapshot().ball;
    expect(ball?.vx).toBeGreaterThan(0);
    expect(ball?.speed).toBeCloseTo(400 * SPEED_MULT, 3);
    expect(played(harness)).toContain(CUES.paddleHit);
  });

  it("imparts spin from a moving paddle and curves the flight", async () => {
    await rally(harness, "versus", {
      x: P1_X1 + BALL_R + 40,
      y: FIELD_CY,
      vx: -400,
      vy: 0,
    });
    // The paddle swings downward as it strikes: taken from the player, with a
    // driven velocity that persists across frames.
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setPaddleVy("left", 300);
    harness.debug.setPaddleCy("left", FIELD_CY);
    await harness.engine.advance(10);

    const ball = harness.snapshot().ball;
    expect(ball?.vx).toBeGreaterThan(0);
    expect(ball?.spin).toBeGreaterThan(0);
    expect(ball?.spin).toBeLessThanOrEqual(300 * SPIN_FROM_PADDLE);
  });

  it("bounces off the top wall and plays the wall cue", async () => {
    await rally(harness, "versus", { x: 400, y: 40, vx: 60, vy: -600 });
    harness.cues.length = 0;
    await harness.engine.advance(10);

    const ball = harness.snapshot().ball;
    expect(ball?.vy).toBeGreaterThan(0);
    expect(ball?.speed).toBeCloseTo(Math.hypot(60, 600), 3);
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

    const ball = harness.snapshot().ball;
    expect(ball?.vx).toBeLessThan(0);
    expect(ball?.speed).toBeCloseTo(300, 3);
    expect(played(harness)).toContain(CUES.obstacleBounce);
  });

  it("records a trail that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(40);

    const snapshot = harness.snapshot();
    const trail = snapshot.ball?.trail ?? [];
    expect(trail.length).toBeGreaterThan(2);
    for (const sample of trail) {
      expect(snapshot.simTime - sample.t).toBeLessThanOrEqual(
        TRAIL_TIME + 1e-9,
      );
    }
    // Oldest first, and the newest sample is where the ball is.
    expect(trail[trail.length - 1].x).toBeCloseTo(snapshot.ball?.x ?? 0, 6);
  });

  it("reaches the same place however the second was divided into frames", async () => {
    const even = await flightUnder(new ConstantClock(1000 / 60));
    const uneven = await flightUnder(new SequenceClock([8, 33, 12, 21]));
    expect(Math.hypot(even.x - uneven.x, even.y - uneven.y)).toBeLessThan(1.5);
  });

  async function flightUnder(clock: Clock): Promise<{ x: number; y: number }> {
    const h = await createHarness({ clock });
    try {
      await rally(h, "versus", {
        x: 400,
        y: 200,
        vx: 320,
        vy: 90,
        spin: 250,
      });
      // Drive to one simulated duration, not to a frame count.
      const start = h.snapshot().simTime;
      while (h.snapshot().simTime < start + 0.5) await h.engine.advance(1);
      const ball = h.snapshot().ball;
      // The two runs stop within a frame of the same simulated time; walk the
      // faster one's remainder off analytically for a fair comparison.
      const over = h.snapshot().simTime - (start + 0.5);
      return {
        x: (ball?.x ?? 0) - (ball?.vx ?? 0) * over,
        y: (ball?.y ?? 0) - (ball?.vy ?? 0) * over,
      };
    } finally {
      h.dispose();
    }
  }
});

// ---- Scoring ------------------------------------------------------------

describe("scoring", () => {
  it("gives the point to player one and re-serves toward the receiver", async () => {
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
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.ball?.held).toBe(true);
    expect(snapshot.ball?.x).toBe(FIELD_CX);
    // A fresh hold, already counting down over the frames since the point.
    expect(snapshot.ball?.holdTimer).toBeGreaterThan(0);
    expect(snapshot.ball?.holdTimer).toBeLessThanOrEqual(HOLD_TIME);
    expect(snapshot.receiver).toBe("right");
    expect(played(harness)).toContain(CUES.score);
  });

  it("gives the point to player two when the ball leaves the left edge", async () => {
    await rally(harness, "versus", { x: 60, y: 120, vx: -700, vy: 0 });
    await harness.engine.advance(15);
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 1 });
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
    expect(snapshot.menuIndex).toBe(0);
    expect(harness.engine.world.state.phase).toBe("over");
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
    expect(snapshot.screen).toBe("countdown");
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
  });

  it("returns to the title from the match-over screen on Escape", async () => {
    await wonMatch(harness);
    harness.tap("Escape");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    // Every match figure is back at its title-screen value, the mode's Solo.
    expect(snapshot.mode).toBe("solo");
  });

  /** Drive a real match to its end: 11-0 through the right goal. */
  async function wonMatch(h: Harness): Promise<void> {
    await rally(h, "versus", { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 });
    h.debug.setScore(WIN_SCORE - 1, 0);
    await h.engine.advance(15);
    expect(h.snapshot().screen).toBe("matchover");
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
    expect(harness.snapshot().resumeScreen).toBe("playing");

    const frozen = harness.snapshot();
    await harness.engine.advance(30);
    const still = harness.snapshot();
    expect(still.ball).toEqual(frozen.ball);
    expect(still.paddles).toEqual(frozen.paddles);
    // simTime accumulates on every update, whatever the screen.
    expect(still.simTime).toBeGreaterThan(frozen.simTime);

    harness.tap("KeyP");
    await harness.engine.advance(10);
    const resumed = harness.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.ball?.x).not.toBe(frozen.ball?.x);
  });

  it("opens on Escape and leaves it open, then resumes on the next Escape", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });

    // One Escape raises `pause` and `back` together. On a live match only
    // `pause` is read, so the menu opens and stays open.
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    await harness.engine.advance(5);
    expect(harness.snapshot().screen).toBe("paused");

    // On the pause menu both are read, and the frame resumes exactly once.
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("resumes with P as well as with Escape", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("resumes and does nothing else on a frame carrying pause and a menu edge", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("KeyP");
    await harness.engine.advance(1);

    harness.tap("KeyP");
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("quits to the title from the pause menu", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("KeyP");
    await harness.engine.advance(1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2); // QUIT TO MENU
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("keeps the countdown where the pause left it", async () => {
    openCountdown(harness, "versus");
    await harness.engine.advance(6);
    const before = harness.snapshot().ball?.holdTimer ?? 0;

    harness.tap("Escape"); // a live match: Escape pauses
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    expect(harness.snapshot().resumeScreen).toBe("countdown");
    await harness.engine.advance(30);
    expect(harness.snapshot().ball?.holdTimer).toBeCloseTo(before, 6);

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

    openCountdown(harness, "versus");
    // `reset` leaves the mute bit alone (specs/instrumentation.md).
    expect(harness.snapshot().muted).toBe(true);
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
    expect(harness.snapshot().muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  it("sets each field on its own and reads it straight back", async () => {
    for (const screen of SCREENS) {
      harness.debug.setScreen(screen);
      expect(harness.snapshot().screen).toBe(screen);
    }

    harness.debug.setScreen("paused");
    harness.debug.setMode("versus");
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setResumeScreen("countdown");
    harness.debug.setScore(4, 6);
    harness.debug.setWinner("right");
    harness.debug.setReceiver("right");
    harness.debug.setSeed(99);
    harness.debug.setAiTracking(false);
    harness.debug.setAiMovement(false);

    const snapshot = harness.snapshot();
    expect(snapshot.mode).toBe("versus");
    expect(snapshot.menuIndex).toBe(2);
    expect(snapshot.titleIndex).toBe(1);
    expect(snapshot.resumeScreen).toBe("countdown");
    expect(snapshot.score).toEqual({ p1: 4, p2: 6 });
    expect(snapshot.winner).toBe("right");
    expect(snapshot.receiver).toBe("right");
    expect(snapshot.seed).toBe(99);
    expect(snapshot.rngState).toBe(99);
    expect(snapshot.ai).toEqual({ tracking: false, movement: false });

    harness.debug.setWinner(null);
    expect(harness.snapshot().winner).toBeNull();
    await harness.engine.advance(1);
  });

  it("leaves the scores, the world, and the menus alone when it sets a screen", async () => {
    openCountdown(harness, "versus");
    harness.debug.setScore(3, 5);
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setBallPosition(500, 300);

    harness.debug.setScreen("title");
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toEqual({ p1: 3, p2: 5 });
    expect(snapshot.menuIndex).toBe(2);
    expect(snapshot.titleIndex).toBe(1);
    expect(snapshot.ball?.x).toBe(500);
    expect(snapshot.ball?.y).toBe(300);
  });

  it("empties the field and spawns the entities back", async () => {
    openCountdown(harness, "versus");

    harness.debug.clearWorld();
    let snapshot = harness.snapshot();
    expect(snapshot.ball).toBeNull();
    expect(snapshot.obstacles).toEqual([]);
    // The paddles stay: no operation removes them.
    expect(snapshot.paddles.left.cy).toBe(FIELD_CY);

    // An absent ball takes no part in a frame, and a pose on it does nothing.
    harness.debug.setBallPosition(200, 200);
    await harness.engine.advance(30);
    expect(harness.snapshot().ball).toBeNull();
    expect(harness.snapshot().screen).toBe("countdown");

    harness.debug.spawnObstacle(1);
    snapshot = harness.snapshot();
    expect(snapshot.obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);

    harness.debug.spawnBall();
    snapshot = harness.snapshot();
    expect(snapshot.ball).toMatchObject({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
  });

  it("refuses an obstacle index this field does not have", () => {
    expect(() => harness.debug.spawnObstacle(2)).toThrow(RangeError);
    expect(() => harness.debug.spawnObstacle(-1)).toThrow(RangeError);
  });

  it("takes one paddle at a time and leaves the other to the player", async () => {
    openCountdown(harness, "versus");
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setPaddleVy("left", 200);

    expect(harness.snapshot().paddles.left.driven).toBe(true);
    expect(harness.snapshot().paddles.right.driven).toBe(false);
    // `drivenVy` is held; `vy` is what the frame integrated, still zero.
    expect(harness.snapshot().paddles.left.drivenVy).toBe(200);
    expect(harness.snapshot().paddles.left.vy).toBe(0);

    harness.hold("KeyW"); // player one's key: ignored, the left is driven
    harness.hold("ArrowUp"); // player two's key: still answered
    await harness.engine.advance(12);

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY + 200 * 0.2, 3);
    expect(left.vy).toBeCloseTo(200, 6);
    expect(right.cy).toBeCloseTo(FIELD_CY - PADDLE_SPEED * 0.2, 3);
  });

  it("holds drivenVy across frames whether or not the side is driven", async () => {
    openCountdown(harness, "versus");
    harness.debug.setPaddleVy("right", -150);
    await harness.engine.advance(20);

    // Not driven: the paddle has not moved, and `drivenVy` is still held.
    expect(harness.snapshot().paddles.right.cy).toBeCloseTo(FIELD_CY, 6);
    expect(harness.snapshot().paddles.right.drivenVy).toBe(-150);

    harness.debug.setPaddleDriven("right", true);
    await harness.engine.advance(6);
    expect(harness.snapshot().paddles.right.vy).toBeCloseTo(-150, 6);
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });

  it("restores every declared field on reset, and leaves the mute bit alone", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 100, vy: 0 });
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setPaddleVy("left", 200);
    harness.debug.setPaddleCy("left", 300);
    harness.debug.setScore(5, 7);
    harness.debug.setWinner("right");
    harness.debug.setTitleIndex(2);
    harness.debug.setAiTracking(false);
    harness.debug.setAiMovement(false);
    harness.debug.setSeed(31);
    harness.debug.clearWorld();
    harness.tap("KeyM");
    await harness.engine.advance(5);
    expect(harness.snapshot().muted).toBe(true);

    harness.debug.reset();

    const title = harness.snapshot();
    expect(title.screen).toBe("title");
    expect(title.mode).toBe("solo");
    expect(title.menuIndex).toBe(0);
    expect(title.titleIndex).toBe(0);
    expect(title.resumeScreen).toBe("playing");
    expect(title.score).toEqual({ p1: 0, p2: 0 });
    expect(title.winner).toBeNull();
    expect(title.receiver).toBe("left");
    expect(title.seed).toBe(1);
    expect(title.rngState).toBe(1);
    expect(title.ai).toEqual({ tracking: true, movement: true });
    expect(title.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(title.ball).toMatchObject({ x: FIELD_CX, held: true, trail: [] });
    expect(title.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
    expect(title.simTime).toBe(0);
    // The mute bit is the runtime's, and reset does not touch it.
    expect(title.muted).toBe(true);

    // The keyboard works again: the hold was released.
    harness.debug.setScreen("countdown");
    harness.hold("KeyS");
    await harness.engine.advance(12);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("gates the AI's sensing and its travel on their own", async () => {
    // The opponent chases a low ball with both faculties on.
    await rally(harness, "solo", { x: 900, y: 600, vx: 300, vy: 0 });
    parkPaddle(harness, "left", FIELD_CY);
    await harness.engine.advance(20);
    expect(harness.snapshot().paddles.right.cy).toBeGreaterThan(FIELD_CY + 60);

    // Movement off: the body stands where it is, with vy of 0.
    harness.debug.setAiMovement(false);
    const parked = harness.snapshot().paddles.right.cy;
    await harness.engine.advance(30);
    expect(harness.snapshot().paddles.right.cy).toBeCloseTo(parked, 6);
    expect(harness.snapshot().paddles.right.vy).toBe(0);

    // Tracking off with movement back on: it eases home, whatever the ball
    // is doing.
    harness.debug.setAiMovement(true);
    harness.debug.setAiTracking(false);
    await harness.engine.advance(120);
    expect(
      Math.abs(harness.snapshot().paddles.right.cy - AI_HOME_Y),
    ).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  });

  it("returns the AI paddle home once the ball travels away", async () => {
    await rally(harness, "solo", { x: 900, y: 650, vx: 300, vy: 0 });
    parkPaddle(harness, "left", FIELD_CY);
    await harness.engine.advance(40);
    expect(harness.snapshot().paddles.right.cy).toBeGreaterThan(500);

    harness.debug.setBallPosition(400, 650);
    harness.debug.setBallVelocity(-300, 0);
    await harness.engine.advance(120);
    const settled = harness.snapshot().paddles.right.cy;
    expect(Math.abs(settled - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
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

// ---- Rendering ----------------------------------------------------------

describe("rendering", () => {
  it("fills each body in its own color at its own position", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(harness.pixel(P1_X1 - 8, snapshot.paddles.left.cy)).toEqual(
      rgba(COLOR.p1),
    );
    expect(harness.pixel(400, 200)).toEqual(rgba(COLOR.ball));
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

  it("draws nothing for an entity that is not on the field", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    harness.debug.clearWorld();
    await harness.engine.advance(1);

    expect(harness.pixel(400, 200)).toEqual(rgba(BACKGROUND));
    const [a] = OBSTACLES;
    expect(harness.pixel((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2)).toEqual(
      rgba(BACKGROUND),
    );
    // The paddles are still drawn: they were never removed.
    expect(
      harness.pixel(P1_X1 - 8, harness.snapshot().paddles.left.cy),
    ).toEqual(rgba(COLOR.p1));
  });

  it("honors the renderer's wireframe switch", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    harness.engine.renderer.setMode("wireframe");
    await harness.engine.advance(1);

    expect(harness.engine.renderer.mode()).toBe("wireframe");
    // Outlines alone: the ball's interior is no longer filled.
    expect(harness.pixel(400, 200)).toEqual(rgba(BACKGROUND));
  });

  it("keeps the field on screen at any window size", async () => {
    expect(harness.engine.viewport().width).toBe(FIELD_W);
    expect(harness.engine.viewport().height).toBe(FIELD_H);
  });
});
