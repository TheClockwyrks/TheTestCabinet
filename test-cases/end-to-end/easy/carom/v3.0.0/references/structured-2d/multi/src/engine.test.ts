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
// hold the same seam a scenario driven from outside holds: every pose is one
// atomic operation on the live world, a screen pose that crosses a level lands
// on the next advanced frame, and a reading is `engine.debug.snapshot()`.
//
// The keyboard and the pointer are driven the same way: a `KeyboardEvent`- or
// `PointerEvent`-shaped event dispatched at the surface's own event target,
// which is the seam the engine listens on.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  BALL_COLLIDE_DIST,
  BALL_COUNT,
  BALL_HOMES,
  BALL_R,
  CUES,
  DEFAULT_SEED,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  LEVELS,
  MATCHOVER_ITEMS,
  OBSTACLE_CENTERS,
  OBSTACLES,
  P1_X1,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_SPEED,
  SPEED_MULT,
  SPIN_FROM_PADDLE,
  TAGS,
  TITLE_ITEMS,
  TRAIL_TIME,
  WIN_SCORE,
} from "./constants";
import { ballsOf } from "./field";
import type { BallSnapshot, CaromDebug, CaromSnapshot } from "./debug";
import { BACKGROUND, game } from "./game";
import { menuOf } from "./menus";
import { Paddle } from "./paddle";
import { CaromState, type Mode, type Screen } from "./state";
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
  device?: "mouse" | "pen" | "touch";
  id?: number;
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
  paddle(side: "left" | "right"): Paddle;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pointerMove(x: number, y: number, options?: PointerOptions): void;
  pointerDown(x: number, y: number, options?: PointerOptions): void;
  pointerUp(x: number, y: number, options?: PointerOptions): void;
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
 * A `PointerEvent`-shaped event. The engine reads `clientX`, `clientY`,
 * `pointerId`, `pointerType`, `isPrimary`, and `button` off it and nothing
 * else, so those are the whole of what a check has to supply.
 */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    options: PointerOptions,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerId = options.id ?? 0;
    this.pointerType = options.device ?? "mouse";
    this.isPrimary = options.primary ?? true;
    this.button = type === "pointermove" ? -1 : 0;
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

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    o: PointerOptions,
  ): void => {
    events.dispatchEvent(new PointerEventShim(type, x, y, o));
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
    paddle: (side) => {
      const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
      const found = engine.world.byTag(tag)[0];
      if (!(found instanceof Paddle))
        throw new Error(`no tagged ${side} paddle`);
      return found;
    },
    hold: (code) => {
      key("keydown", code);
    },
    release: (code) => {
      key("keyup", code);
    },
    tap: (code) => {
      key("keydown", code);
      key("keyup", code);
    },
    pointerMove: (x, y, o = {}) => {
      pointer("pointermove", x, y, o);
    },
    pointerDown: (x, y, o = {}) => {
      pointer("pointerdown", x, y, o);
    },
    pointerUp: (x, y, o = {}) => {
      pointer("pointerup", x, y, o);
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

// ---- Driving the game through the surface -------------------------------
//
// The sequences every scenario below shares, written the way
// specs/instrumentation.md says a caller drives the surface: one atomic pose at
// a time, and one advanced frame after a pose that changes the screen before
// anything else is posed, pressed, or read.

/** The title screen, with every declared field at its title value. */
async function openTitle(h: Harness): Promise<void> {
  h.debug.reset();
  await h.engine.advance(1);
}

/** A match on its opening countdown, through the surface alone. */
async function openCountdown(h: Harness, mode: Mode): Promise<void> {
  await openTitle(h);
  h.debug.setScreen("countdown");
  await h.engine.advance(1);
  h.debug.setMode(mode);
}

/** What a scenario leaves on the field. */
interface FieldContents {
  /** How many balls, from ball zero up. Defaults to one. */
  balls?: number;
  /** Which obstacles, by index. Defaults to none. */
  obstacles?: readonly number[];
}

/** Clear the field and spawn back exactly what `contents` names. */
function isolate(h: Harness, contents: FieldContents = {}): void {
  h.debug.clearWorld();
  for (let i = 0; i < (contents.balls ?? 1); i += 1) h.debug.spawnBall(i);
  for (const i of contents.obstacles ?? []) h.debug.spawnObstacle(i);
}

/** End every present ball's hold, so the game's own rule launches it. */
function endHolds(h: Harness): void {
  for (const ball of h.snapshot().balls) {
    h.debug.setBallHoldTimer(ball.index, 0);
  }
}

/** Live play over a field holding only what the scenario is about. */
async function openPlaying(
  h: Harness,
  mode: Mode,
  contents: FieldContents = {},
): Promise<void> {
  await openCountdown(h, mode);
  isolate(h, contents);
  endHolds(h);
  for (let i = 0; i < 30 && h.snapshot().screen !== "playing"; i += 1) {
    await h.engine.advance(1);
  }
  expect(h.snapshot().screen).toBe("playing");
}

/** Place and aim one ball, taking it out of any hold it was in. */
function poseBall(
  h: Harness,
  index: number,
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
): void {
  h.debug.setBallHeld(index, false);
  h.debug.setBallHoldTimer(index, 0);
  h.debug.setBallPosition(index, ball.x, ball.y);
  h.debug.setBallVelocity(index, ball.vx, ball.vy);
  h.debug.setBallSpin(index, ball.spin ?? 0);
}

/** Take one paddle from the player and hold it where the options say. */
function drivePaddle(
  h: Harness,
  side: "left" | "right",
  options: { cy?: number; vy?: number } = {},
): void {
  if (options.cy !== undefined) h.debug.setPaddleCy(side, options.cy);
  h.debug.setPaddleVy(side, options.vy ?? 0);
  h.debug.setPaddleDriven(side, true);
}

/** Live play over one ball, posed as asked, with an empty field around it. */
async function rally(
  h: Harness,
  mode: Mode,
  ball: { x: number; y: number; vx: number; vy: number; spin?: number },
  contents: FieldContents = {},
): Promise<void> {
  await openPlaying(h, mode, contents);
  poseBall(h, 0, ball);
}

/** The one ball a `rally` scenario is driving. */
function driven(h: Harness): BallSnapshot {
  return h.snapshot().balls[0];
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

/** The centre of item `index`'s hit region, as the build reports it. */
function itemCentre(h: Harness, index: number): { x: number; y: number } {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) throw new Error(`no hit region for item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens the title level with the court posed behind the menu", () => {
    const { engine } = harness;
    expect(engine.world.level).toBe(LEVELS.title);

    // The tagged field bodies are in place (specs/state.md), the balls in
    // play order.
    expect(engine.world.byTag(TAGS.paddleLeft)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.paddleRight)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.ball)).toHaveLength(BALL_COUNT);
    expect(engine.world.byTag(TAGS.obstacle)).toHaveLength(OBSTACLES.length);

    // Every field of the title-screen state (specs/state.md).
    const snapshot = harness.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.titleIndex).toBe(0);
    expect(snapshot.resumeScreen).toBe("playing");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    expect(snapshot.muted).toBe(false);
    expect(snapshot.seed).toBe(DEFAULT_SEED);
    expect(snapshot.rngState).toBe(DEFAULT_SEED);
    expect(snapshot.ai).toEqual({ tracking: true, movement: true });
    expect(snapshot.simTime).toBe(0);
    const rest = { cy: FIELD_CY, vy: 0, drivenVy: 0, driven: false };
    expect(snapshot.paddles.left).toEqual(rest);
    expect(snapshot.paddles.right).toEqual(rest);
    expect(snapshot.balls).toEqual(
      BALL_HOMES.map((home, index) => ({
        index,
        x: home.x,
        y: home.y,
        vx: 0,
        vy: 0,
        speed: 0,
        spin: 0,
        held: true,
        holdTimer: HOLD_TIME,
        trail: [],
      })),
    );
    expect(snapshot.obstacles).toEqual(
      OBSTACLE_CENTERS.map((centre, index) => ({
        index,
        cx: centre.x,
        cy: centre.y,
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
    // One seat per side, whichever way the match is played: who drives the
    // right paddle is read from the mode every frame (src/match-mode.ts).
    expect(harness.engine.world.players()).toHaveLength(2);
  });

  it("moves the selection with either side's slider", async () => {
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(1);

    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);

    // Wraps both ways.
    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("moves up only when one frame carries both an up and a down edge", async () => {
    harness.debug.setMenuIndex(1);
    harness.tap("ArrowDown");
    harness.tap("KeyW");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("moves only when one frame carries a movement edge and a confirm", async () => {
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
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    // Confirming a title item remembers it (specs/ui.md).
    expect(harness.snapshot().titleIndex).toBe(2);

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    // Returning to the title selects the entry that led away from it.
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("leaves the how-to screen by confirming its one item too", async () => {
    harness.debug.setTitleIndex(1);
    harness.debug.setScreen("howto");
    await harness.engine.advance(1);

    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

// ---- The menus, from a mouse and a finger --------------------------------

describe("the menus under a pointer", () => {
  it("selects the item a pointer moves onto", async () => {
    const at = itemCentre(harness, 2);
    harness.pointerMove(at.x, at.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("confirms an item pressed and released inside its own region", async () => {
    const at = itemCentre(harness, 1);
    harness.pointerMove(at.x, at.y);
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.engine.advance(1);

    // VERSUS: selected, confirmed, and remembered as the title's selection.
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release fall in different items", async () => {
    const from = itemCentre(harness, 0);
    const to = itemCentre(harness, 2);
    harness.pointerDown(from.x, from.y);
    await harness.engine.advance(1);
    harness.pointerMove(to.x, to.y);
    await harness.engine.advance(1);
    harness.pointerUp(to.x, to.y);
    await harness.engine.advance(1);

    expect(harness.snapshot().screen).toBe("title");
    // The travel still selected the item it ended over.
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("confirms nothing when an edge falls outside every region", async () => {
    const at = itemCentre(harness, 0);
    harness.pointerDown(at.x, at.y);
    await harness.engine.advance(1);
    harness.pointerUp(20, 20);
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("selects and confirms from a touch that lands and lifts on one item", async () => {
    const at = itemCentre(harness, 2);
    const touch = { device: "touch" as const, id: 7 };
    // No move in front of the landing: a finger does not hover.
    harness.pointerDown(at.x, at.y, touch);
    harness.pointerUp(at.x, at.y, touch);
    await harness.engine.advance(1);

    // HOW TO PLAY: selected by the landing, confirmed by the lift, and
    // remembered as the title's selection (specs/ui.md).
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().titleIndex).toBe(2);
  });

  it("leaves menuIndex where the pointer put it when a key moved too", async () => {
    const at = itemCentre(harness, 2);
    harness.tap("ArrowDown"); // would select item 1
    harness.pointerMove(at.x, at.y);
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("reports a region for every menu item, and none where no menu shows", async () => {
    for (const screen of ["title", "howto", "paused", "matchover"] as const) {
      harness.debug.setScreen(screen);
      await harness.engine.advance(1);
      const menu = menuOf(screen);
      expect(menu).not.toBeNull();
      for (let i = 0; i < (menu?.items.length ?? 0); i += 1) {
        expect(harness.debug.menuItemRect(i)).toEqual(menu?.rects[i]);
      }
      expect(harness.debug.menuItemRect(menu?.items.length ?? 0)).toBeNull();
      expect(harness.debug.menuItemRect(-1)).toBeNull();
    }

    for (const screen of ["countdown", "playing"] as const) {
      harness.debug.setScreen(screen);
      await harness.engine.advance(1);
      expect(harness.debug.menuItemRect(0)).toBeNull();
    }
  });

  it("keeps every menu's regions apart and on the field", () => {
    for (const screen of ["title", "howto", "paused", "matchover"] as const) {
      const rects = menuOf(screen)?.rects ?? [];
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(FIELD_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(FIELD_H);
      }
      for (let i = 1; i < rects.length; i += 1) {
        expect(rects[i].y).toBeGreaterThanOrEqual(
          rects[i - 1].y + rects[i - 1].h,
        );
      }
    }
  });
});

// ---- The paddles --------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    await openCountdown(harness, "versus");

    // 0.2 s: far enough to measure, short of the clamp at PADDLE_MAX_CY.
    harness.hold("KeyS");
    await harness.engine.advance(12);
    harness.release("KeyS");

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("drives player one from either slider in Solo", async () => {
    await openCountdown(harness, "solo");

    harness.hold("ArrowDown");
    await harness.engine.advance(12);
    harness.release("ArrowDown");

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("stands still when opposite sliders are held in Solo", async () => {
    await openCountdown(harness, "solo");

    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);

    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    await openCountdown(harness, "versus");

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
    await openCountdown(harness, "versus");
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
    await openCountdown(harness, "versus");
    harness.snapshot().balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
    });
  });

  it("launches every ball at exactly SERVE_SPEED", async () => {
    await openCountdown(harness, "versus");
    endHolds(harness);
    await harness.engine.advance(1);

    for (const ball of harness.snapshot().balls) {
      // Read on the launch frame, before flight has curved or slowed anything.
      expect(ball.speed).toBeCloseTo(SERVE_SPEED, 3);
    }
  });

  it("draws a fresh angle for every launch, over the whole circle", async () => {
    const quadrants = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      await openCountdown(harness, "versus");
      harness.debug.setSeed(seed);
      endHolds(harness);
      await harness.engine.advance(1);
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
      await openCountdown(h, "versus");
      h.debug.setSeed(seed);
      endHolds(h);
      await h.engine.advance(1);
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
    // The paddle swings downward as it strikes; `drivenVy` persists across
    // frames, so it is still moving at contact (specs/instrumentation.md).
    drivePaddle(harness, "left", { cy: FIELD_CY, vy: 300 });
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
    await rally(
      harness,
      "versus",
      {
        x: obstacle.x0 - BALL_R - 30,
        y: (obstacle.y0 + obstacle.y1) / 2,
        vx: 300,
        vy: 0,
      },
      { obstacles: [0] },
    );
    harness.cues.length = 0;
    await harness.engine.advance(15);

    const ball = driven(harness);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.speed).toBeCloseTo(300, 3);
    expect(played(harness)).toContain(CUES.obstacleBounce);
  });

  it("passes through where an obstacle would be once it is off the field", async () => {
    const [obstacle] = OBSTACLES;
    await rally(harness, "versus", {
      x: obstacle.x0 - BALL_R - 30,
      y: (obstacle.y0 + obstacle.y1) / 2,
      vx: 300,
      vy: 0,
    });
    await harness.engine.advance(15);

    expect(harness.snapshot().obstacles).toEqual([]);
    expect(driven(harness).vx).toBeGreaterThan(0);
  });

  it("records a trail per ball that spans a slice of time, not of frames", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    await harness.engine.advance(40);

    const ball = driven(harness);
    expect(ball.trail.length).toBeGreaterThan(2);
    const now = harness.snapshot().simTime;
    for (const sample of ball.trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME + 1e-9);
    }
    // Oldest first (specs/state.md).
    for (let i = 1; i < ball.trail.length; i += 1) {
      expect(ball.trail[i].t).toBeGreaterThanOrEqual(ball.trail[i - 1].t);
    }
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
      const until = h.snapshot().simTime + 0.5;
      while (h.snapshot().simTime < until) await h.engine.advance(1);
      const ball = driven(h);
      // The two runs stop within a frame of the same simulated time; walk the
      // faster one's remainder off analytically for a fair comparison.
      const over = h.snapshot().simTime - until;
      return { x: ball.x - ball.vx * over, y: ball.y - ball.vy * over };
    } finally {
      h.dispose();
    }
  }
});

// ---- Scoring ------------------------------------------------------------

describe("scoring", () => {
  it("gives the point to player one and respawns only the crossed ball", async () => {
    await rally(
      harness,
      "versus",
      { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 },
      { balls: 3 },
    );
    poseBall(harness, 1, { x: 300, y: 300, vx: 120, vy: 0 });
    poseBall(harness, 2, { x: 300, y: 600, vx: 120, vy: 0 });
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
    await rally(harness, "versus", { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 });
    await harness.engine.advance(15);
    expect(harness.snapshot().balls[0].held).toBe(true);

    await harness.engine.advance(frames(HOLD_TIME) + 2);
    const relaunched = harness.snapshot().balls[0];
    expect(relaunched.held).toBe(false);
    expect(relaunched.speed).toBeGreaterThan(0);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 });
    harness.debug.setScore(WIN_SCORE - 1, 0);
    await harness.engine.advance(15);

    const snapshot = harness.snapshot();
    expect(snapshot.score).toEqual({ p1: WIN_SCORE, p2: 0 });
    expect(snapshot.screen).toBe("matchover");
    expect(snapshot.winner).toBe("left");
    expect(snapshot.menuIndex).toBe(0);
    expect(harness.engine.world.state.phase).toBe("over");
    // Every ball is left where it is (specs/balls.md): the winning ball is
    // beyond the goal edge, not respawned.
    expect(snapshot.balls[0].x).toBeGreaterThan(FIELD_W);
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", { x: FIELD_W - 60, y: 120, vx: 700, vy: 0 });
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
    harness.debug.setTitleIndex(1);
    harness.tap("Escape");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.winner).toBeNull();
    // Every match figure is back at its title-screen value, the mode's Solo,
    // and the remembered selection is what the menu lands on.
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.menuIndex).toBe(1);
    expect(snapshot.titleIndex).toBe(1);
  });

  it("takes the MENU item back to the title too", async () => {
    await wonMatch(harness);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(MATCHOVER_ITEMS.length - 1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("title");
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
    expect(harness.snapshot().menuIndex).toBe(0);

    const frozen = harness.snapshot();
    await harness.engine.advance(30);
    const still = harness.snapshot();
    expect(still.balls).toEqual(frozen.balls);
    expect(still.paddles).toEqual(frozen.paddles);
    // simTime accumulates on every update, whatever the screen
    // (specs/state.md).
    expect(still.simTime).toBeGreaterThan(frozen.simTime);

    // Escape resumes: on `paused` it raises both `pause` and `back`, and the
    // frame that carries either resumes once (specs/ui.md).
    harness.tap("Escape");
    await harness.engine.advance(10);
    const resumed = harness.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.balls[0].x).not.toBe(frozen.balls[0].x);
  });

  it("resumes on P as well as on Escape", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("resumes and does nothing else on the frame that carries the key", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.debug.setMenuIndex(2); // QUIT TO MENU is highlighted

    harness.tap("Escape");
    await harness.engine.advance(1);
    // Resumed rather than quit, and the highlight is untouched.
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("resumes to the countdown it was opened from", async () => {
    await openCountdown(harness, "versus");
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    expect(harness.snapshot().resumeScreen).toBe("countdown");

    harness.tap("Enter"); // RESUME
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("countdown");
  });

  it("restarts the match in the current mode from the pause menu", async () => {
    await rally(harness, "solo", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.debug.setScore(4, 5);
    harness.tap("KeyP");
    await harness.engine.advance(1);
    harness.tap("ArrowDown"); // RESTART
    await harness.engine.advance(1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.balls).toHaveLength(BALL_COUNT);
  });

  it("quits to the title from the pause menu", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 300, vy: 60 });
    harness.debug.setTitleIndex(2);
    harness.tap("KeyP");
    await harness.engine.advance(1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.snapshot().menuIndex).toBe(PAUSE_ITEMS.length - 1);
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("keeps every hold where the pause left it", async () => {
    await openCountdown(harness, "versus");
    await harness.engine.advance(6);
    const before = harness.snapshot().balls.map((ball) => ball.holdTimer);

    harness.tap("Escape"); // a live match: Escape pauses
    await harness.engine.advance(1);
    expect(harness.snapshot().screen).toBe("paused");
    await harness.engine.advance(30);
    const during = harness.snapshot().balls.map((ball) => ball.holdTimer);
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

    await openCountdown(harness, "versus");
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

  it("is the one bit reset leaves alone", async () => {
    harness.tap("KeyM");
    await harness.engine.advance(1);
    await openTitle(harness);
    expect(harness.snapshot().muted).toBe(true);
  });
});

// ---- The debug surface --------------------------------------------------

describe("the debug surface", () => {
  it("reports every field an operation sets, and sets one at a time", async () => {
    await openCountdown(harness, "versus");

    harness.debug.setMode("solo");
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setResumeScreen("countdown");
    harness.debug.setScore(3, 4);
    harness.debug.setWinner("right");
    harness.debug.setSeed(99);
    harness.debug.setAiTracking(false);
    harness.debug.setPaddleCy("left", 200);
    harness.debug.setPaddleVy("left", 150);
    harness.debug.setPaddleDriven("left", true);

    const snapshot = harness.snapshot();
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.menuIndex).toBe(2);
    expect(snapshot.titleIndex).toBe(1);
    expect(snapshot.resumeScreen).toBe("countdown");
    expect(snapshot.score).toEqual({ p1: 3, p2: 4 });
    expect(snapshot.winner).toBe("right");
    expect(snapshot.seed).toBe(99);
    expect(snapshot.rngState).toBe(99);
    expect(snapshot.ai).toEqual({ tracking: false, movement: true });
    expect(snapshot.paddles.left).toMatchObject({
      cy: 200,
      drivenVy: 150,
      driven: true,
    });
    // Driving one side leaves the other exactly as it was.
    expect(snapshot.paddles.right).toMatchObject({
      drivenVy: 0,
      driven: false,
    });
  });

  it("leaves the world and the scores alone when the screen crosses a level", async () => {
    await openPlaying(harness, "versus", { balls: 2, obstacles: [1] });
    harness.debug.setScore(3, 4);
    harness.debug.setMenuIndex(1);
    poseBall(harness, 0, { x: 400, y: 200, vx: 0, vy: 0 });
    const before = harness.snapshot();

    // The title level hosts `title`; the match level hosted `playing`.
    harness.debug.setScreen("title");
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    const after = harness.snapshot();
    expect(after.screen).toBe("title");
    expect(after.score).toEqual({ p1: 3, p2: 4 });
    expect(after.menuIndex).toBe(1);
    expect(after.balls).toEqual(before.balls);
    expect(after.obstacles).toEqual(before.obstacles);
    expect(after.paddles).toEqual(before.paddles);
  });

  it("clears the field and spawns entities back one at a time", async () => {
    await openCountdown(harness, "versus");

    harness.debug.clearWorld();
    let snapshot = harness.snapshot();
    expect(snapshot.balls).toEqual([]);
    expect(snapshot.obstacles).toEqual([]);
    // The paddles are furniture the game always has.
    expect(snapshot.paddles.left.cy).toBe(FIELD_CY);

    harness.debug.spawnBall(2);
    harness.debug.spawnObstacle(1);
    snapshot = harness.snapshot();
    expect(snapshot.balls).toHaveLength(1);
    expect(snapshot.balls[0]).toMatchObject({
      index: 2,
      x: BALL_HOMES[2].x,
      y: BALL_HOMES[2].y,
      held: true,
      holdTimer: HOLD_TIME,
      spin: 0,
      trail: [],
    });
    expect(snapshot.obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);

    // Balls come back in PLAY ORDER however they were spawned.
    harness.debug.spawnBall(0);
    expect(harness.snapshot().balls.map((ball) => ball.index)).toEqual([0, 2]);
  });

  it("leaves an absent ball's operations without effect", async () => {
    await openCountdown(harness, "versus");
    harness.debug.clearWorld();

    harness.debug.setBallPosition(0, 100, 100);
    harness.debug.setBallVelocity(0, 10, 10);
    harness.debug.setBallSpin(0, 5);
    harness.debug.setBallHeld(0, false);
    harness.debug.setBallHoldTimer(0, 0);
    expect(harness.snapshot().balls).toEqual([]);

    // And an index this variant does not have changes nothing either.
    harness.debug.spawnBall(BALL_COUNT);
    harness.debug.spawnBall(-1);
    harness.debug.spawnObstacle(9);
    expect(harness.snapshot().balls).toEqual([]);
    expect(harness.snapshot().obstacles).toEqual([]);
  });

  it("holds one paddle at its drivenVy and leaves the other to the player", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 100, vy: 0 });
    drivePaddle(harness, "left", { cy: 300, vy: 200 });

    // Input is ignored on the driven side and answered on the other.
    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.engine.advance(12);
    harness.release("KeyW");
    harness.release("ArrowDown");

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(300 + 200 * 0.2, 3);
    expect(left.vy).toBeCloseTo(200, 6);
    expect(right.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
  });

  it("keeps drivenVy across frames and reaches vy on the first driven frame", async () => {
    await openCountdown(harness, "versus");
    harness.debug.setPaddleVy("left", 120);
    await harness.engine.advance(5);
    // Set but not driven: the paddle has not moved and vy is still zero.
    expect(harness.snapshot().paddles.left).toMatchObject({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 120,
      driven: false,
    });

    harness.debug.setPaddleDriven("left", true);
    await harness.engine.advance(1);
    expect(harness.snapshot().paddles.left.vy).toBeCloseTo(120, 6);
  });

  it("restores the whole title-screen state on reset", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 100, vy: 0 });
    drivePaddle(harness, "left", { cy: 300, vy: 200 });
    harness.debug.setAiMovement(false);
    harness.debug.setTitleIndex(2);
    harness.debug.setScore(5, 6);
    harness.debug.setSeed(77);
    await harness.engine.advance(5);

    harness.debug.reset();
    await harness.engine.advance(1);

    expect(harness.engine.world.level).toBe(LEVELS.title);
    const title = harness.snapshot();
    expect(title.screen).toBe("title");
    expect(title.mode).toBe("solo");
    expect(title.menuIndex).toBe(0);
    expect(title.titleIndex).toBe(0);
    expect(title.resumeScreen).toBe("playing");
    expect(title.score).toEqual({ p1: 0, p2: 0 });
    expect(title.winner).toBeNull();
    expect(title.seed).toBe(DEFAULT_SEED);
    expect(title.rngState).toBe(DEFAULT_SEED);
    expect(title.ai).toEqual({ tracking: true, movement: true });
    // Zeroed by the reset, and one frame has run since.
    expect(title.simTime).toBeCloseTo(FRAME_MS / 1000, 6);
    expect(title.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    title.balls.forEach((ball, index) => {
      expect(ball.x).toBe(BALL_HOMES[index].x);
      expect(ball.y).toBe(BALL_HOMES[index].y);
      expect(ball.speed).toBe(0);
      expect(ball.held).toBe(true);
      expect(ball.holdTimer).toBe(HOLD_TIME);
    });
    expect(title.obstacles).toHaveLength(OBSTACLE_CENTERS.length);

    // The keyboard works again: both paddles were handed back.
    harness.tap("Enter");
    await harness.engine.advance(1);
    harness.hold("KeyS");
    await harness.engine.advance(12);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("returns simTime to zero while the engine's frame counter runs on", async () => {
    await harness.engine.advance(60);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 6);

    harness.debug.reset();
    await harness.engine.advance(1);
    expect(harness.snapshot().simTime).toBeCloseTo(FRAME_MS / 1000, 6);
    expect(harness.engine.frame().count).toBe(61);
  });

  it("runs the real AI against a posed shot on the side it was handed back", async () => {
    await rally(harness, "solo", { x: 900, y: 600, vx: 300, vy: 0 });
    drivePaddle(harness, "left", { cy: FIELD_CY, vy: 0 });
    await harness.engine.advance(20);

    const { right, left } = harness.snapshot().paddles;
    expect(right.cy).toBeGreaterThan(FIELD_CY + 60); // chasing the low ball
    expect(left.cy).toBeCloseTo(FIELD_CY, 3); // driven, and at rest
  });

  it("stops the AI sensing the ball with tracking off", async () => {
    await rally(harness, "solo", { x: 900, y: 620, vx: 300, vy: 0 });
    harness.debug.setAiTracking(false);
    harness.debug.setPaddleCy("right", FIELD_CY);
    await harness.engine.advance(40);

    // No defended ball: it rests at AI_HOME_Y rather than chasing.
    const settled = harness.snapshot().paddles.right.cy;
    expect(Math.abs(settled - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  });

  it("stops the AI's paddle travelling with movement off", async () => {
    await rally(harness, "solo", { x: 900, y: 620, vx: 300, vy: 0 });
    harness.debug.setAiMovement(false);
    harness.debug.setPaddleCy("right", 200);
    await harness.engine.advance(40);

    const right = harness.snapshot().paddles.right;
    expect(right.cy).toBe(200);
    expect(right.vy).toBe(0);
  });

  it("returns the AI paddle home and stops within AI_HOME_DEADZONE", async () => {
    await rally(harness, "solo", { x: 900, y: 650, vx: 300, vy: 0 });
    await harness.engine.advance(40);
    expect(harness.snapshot().paddles.right.cy).toBeGreaterThan(500);

    // The ball turns away; nothing threatens the goal; the AI eases home.
    harness.debug.setBallPosition(0, 400, 650);
    harness.debug.setBallVelocity(0, -300, 0);
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

  it("poses each of the six screens", async () => {
    const screens: Screen[] = [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "matchover",
    ];
    for (const screen of screens) {
      harness.debug.setScreen(screen);
      await harness.engine.advance(1);
      expect(harness.snapshot().screen).toBe(screen);
    }
  });
});

// ---- Three independent balls --------------------------------------------

describe("three independent balls", () => {
  it("keeps the other two running while one respawns", async () => {
    await rally(
      harness,
      "versus",
      { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 },
      { balls: 2 },
    );
    poseBall(harness, 1, { x: 300, y: 300, vx: 300, vy: 0 });

    await harness.engine.advance(4);

    // Ball 0 scored and went home; ball 1 never paused.
    const snapshot = harness.snapshot();
    expect(snapshot.balls[0].held).toBe(true);
    expect(snapshot.balls[1].held).toBe(false);
    expect(snapshot.balls[1].x).toBeGreaterThan(300);
  });

  it("runs each ball's hold on its own clock", async () => {
    await rally(
      harness,
      "versus",
      { x: FIELD_W, y: FIELD_CY, vx: 600, vy: 0 },
      { balls: 3 },
    );
    poseBall(harness, 1, { x: 200, y: 60, vx: 0, vy: 0 });
    poseBall(harness, 2, { x: 1100, y: 60, vx: 0, vy: 0 });
    await harness.engine.advance(4);

    const holds = harness.snapshot().balls.map((ball) => ball.holdTimer);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[1]).toBe(0);
    expect(holds[2]).toBe(0);
  });

  it("bounces two balls off each other without changing either's spin", async () => {
    await rally(
      harness,
      "versus",
      { x: 600, y: 400, vx: 300, vy: 0, spin: 0 },
      { balls: 2 },
    );
    poseBall(harness, 1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });

    await harness.engine.advance(30);

    const [a, b] = harness.snapshot().balls;
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.spin).toBe(0);
    expect(b.spin).toBe(0);
  });

  it("plays the ball cue once for the pair, not once for each ball", async () => {
    await rally(
      harness,
      "versus",
      { x: 600, y: 400, vx: 300, vy: 0, spin: 0 },
      { balls: 2 },
    );
    poseBall(harness, 1, { x: 700, y: 400, vx: -300, vy: 0, spin: 0 });
    harness.cues.length = 0;

    await harness.engine.advance(30);

    // A collision is one event between two balls (specs/audio.md), so the
    // whole of this scenario is one cue. Playing it from a loop over the balls
    // would sound the same contact twice, once for each side of it.
    expect(played(harness)).toEqual([CUES.ballBounce]);
  });

  it("bounces a moving ball off one waiting at its home point", async () => {
    await openCountdown(harness, "versus");
    harness.debug.clearWorld();
    harness.debug.spawnBall(0);
    harness.debug.spawnBall(1);
    // Ball 1 keeps its hold on the field centre; ball 0 is driven into it.
    poseBall(harness, 0, {
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
    await openPlaying(harness, "versus", {
      balls: BALL_COUNT,
      obstacles: [0, 1],
    });
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
    await rally(
      harness,
      "solo",
      { x: 900, y: 180, vx: 400, vy: 0 },
      { balls: 2 },
    );
    // A second ball threatens the same goal, but from much further away.
    poseBall(harness, 1, { x: 200, y: 620, vx: 400, vy: 0 });
    harness.debug.setPaddleCy("right", FIELD_CY);

    await harness.engine.advance(20);

    // It tracks the near ball at y 180, not the far one at y 620.
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(FIELD_CY);
  });
});

// ---- Rendering ----------------------------------------------------------

describe("rendering", () => {
  it("fills each body in its own color at its own position", async () => {
    await rally(
      harness,
      "versus",
      { x: 400, y: 200, vx: 0, vy: 0 },
      { obstacles: [0] },
    );
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

  it("keeps the ball actors off the picture on the menu screens", async () => {
    await openTitle(harness);
    await harness.engine.advance(1);
    // The balls are on their home points, and the title draws none of them.
    expect(harness.pixel(BALL_HOMES[1].x, BALL_HOMES[1].y)).not.toEqual(
      rgba(COLOR.ball),
    );
    expect(ballsOf(harness.engine.world)).toHaveLength(BALL_COUNT);
  });
});
