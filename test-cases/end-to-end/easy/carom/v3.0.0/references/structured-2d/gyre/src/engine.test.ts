// Carom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` —
// which makes a duration a frame count and the arithmetic asserted here the
// arithmetic specs/ names. What is read back is the engine's own object model —
// the world, its tagged actors, its game state — the debug surface the game
// instance returned from `initialize`, the engine's events, and the pixels the
// pipeline produced.
//
// The surface is read off `engine.debug`, never built here, so these checks hold
// the same seam a scenario driven from outside holds: a pose is a method call
// that arranges the live world, a screen change lands no later than the end of
// the next advanced frame, and a reading is `engine.debug.snapshot()`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/structured-2d";
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
  MATCHOVER_ITEMS,
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
  OBSTACLES,
  P1_X1,
  PADDLE_MAX_CY,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_ANGLE,
  SERVE_SPEED,
  SPEED_MULT,
  SPIN_FROM_PADDLE,
  TAGS,
  TITLE_ITEMS,
  TRAIL_TIME,
  WIN_SCORE,
} from "./constants";
import type { CaromDebug, CaromSnapshot } from "./debug";
import { BACKGROUND, game } from "./game";
import { HOWTO_ITEMS } from "./menus";
import { obstaclePose } from "./obstacles";
import { CaromState, type Screen } from "./state";
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

/** Which pointer a dispatched event comes from, and what it is holding. */
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
  advance(count: number): Promise<void>;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): Promise<void>;
  pointerMove(x: number, y: number, options?: PointerOptions): void;
  pointerDown(x: number, y: number, options?: PointerOptions): void;
  pointerUp(x: number, y: number, options?: PointerOptions): void;
  itemCenter(index: number): { x: number; y: number };
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

/** A `PointerEvent`-shaped event: the engine reads exactly these six fields. */
class PointerShapedEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: string,
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

  const point = (
    type: string,
    x: number,
    y: number,
    options: PointerOptions,
    button: number,
    buttons: number,
  ): void => {
    // A CSS pixel is a logical unit here: the surface is exactly the design
    // size at a device pixel ratio of one.
    events.dispatchEvent(
      new PointerShapedEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: options.id ?? 0,
        pointerType: options.device ?? "mouse",
        isPrimary: options.primary ?? true,
        button,
        buttons,
      }),
    );
  };

  const debug = engine.debug;

  return {
    engine,
    // Read off the engine rather than built here: `initialize` returned the
    // surface, the engine holds it, and reaching it this way is what makes that
    // return load-bearing.
    debug,
    ctx,
    cues,
    assetFailures,
    snapshot: () => debug.snapshot(),
    state: () => {
      const state = engine.world.state;
      if (!(state instanceof CaromState)) throw new Error("no Carom state");
      return state;
    },
    advance: (count) => engine.advance(count),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },
    pointerMove: (x, y, options = {}) =>
      point("pointermove", x, y, options, -1, 0),
    pointerDown: (x, y, options = {}) =>
      point("pointerdown", x, y, options, 0, 1),
    pointerUp: (x, y, options = {}) => point("pointerup", x, y, options, 0, 0),
    itemCenter: (index) => {
      const rect = debug.menuItemRect(index);
      if (rect === null) throw new Error(`no region for item ${index}`);
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
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

/** The ball, which every scenario below keeps on the field. */
function ball(snapshot: CaromSnapshot): NonNullable<CaromSnapshot["ball"]> {
  const one = snapshot.ball;
  if (one === null) throw new Error("no ball on the field");
  return one;
}

/**
 * Put the game on `screen`, through the surface alone.
 *
 * A screen change may ride a level transition the engine honors as the frame
 * ends, so one frame is advanced before anything else is posed or read.
 */
async function show(h: Harness, screen: Screen): Promise<void> {
  h.debug.setScreen(screen);
  await h.advance(1);
}

/** A fresh title screen, the way every scenario starts. */
async function title(h: Harness): Promise<void> {
  h.debug.reset();
  await h.advance(1);
}

/** A match on its opening countdown, posed rather than played into. */
async function countdown(
  h: Harness,
  mode: "solo" | "versus" = "versus",
): Promise<void> {
  await title(h);
  await show(h, "countdown");
  h.debug.setMode(mode);
  h.debug.spawnBall();
}

/** A live rally with the ball posed exactly as asked, on an empty field. */
async function rally(
  h: Harness,
  mode: "solo" | "versus",
  pose: { x: number; y: number; vx: number; vy: number; spin?: number },
  options: { obstacles?: readonly number[] } = {},
): Promise<void> {
  await countdown(h, mode);
  h.debug.clearWorld();
  h.debug.spawnBall();
  for (const index of options.obstacles ?? []) h.debug.spawnObstacle(index);
  // The build's own rule serves the ball on the first frame the hold elapses.
  h.debug.setBallHoldTimer(0);
  await h.advance(2);
  h.debug.setPaddleDriven("left", true);
  h.debug.setPaddleDriven("right", true);
  h.debug.setPaddleCy("left", 60);
  h.debug.setPaddleCy("right", 60);
  h.debug.setBallPosition(pose.x, pose.y);
  h.debug.setBallVelocity(pose.vx, pose.vy);
  h.debug.setBallSpin(pose.spin ?? 0);
}

/**
 * Advance a frame at a time until `done` answers, and report the frames it
 * took. A point is resolved on whichever frame the ball crosses the goal edge,
 * so a check about what a point LEAVES BEHIND stops on that frame rather than
 * running on into the countdown that follows.
 */
async function until(
  h: Harness,
  done: (snapshot: CaromSnapshot) => boolean,
  maxFrames = 180,
): Promise<number> {
  for (let frame = 1; frame <= maxFrames; frame++) {
    await h.advance(1);
    if (done(h.snapshot())) return frame;
  }
  throw new Error(`nothing happened within ${maxFrames} frames`);
}

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- Boot ---------------------------------------------------------------

describe("initialization", () => {
  it("opens the title level with the court posed behind the menu", () => {
    const { engine } = harness;
    expect(engine.world.level).toBe(LEVELS.title);

    // The tagged field bodies are in place (specs/state.md).
    expect(engine.world.byTag(TAGS.paddleLeft)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.paddleRight)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.ball)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.obstacle)).toHaveLength(OBSTACLES.length);
  });

  it("holds every title-screen figure specs/state.md tabulates", () => {
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
    expect(Math.abs(snapshot.ball?.serveSign ?? 0)).toBe(1);
    expect(snapshot.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(snapshot.paddles.right).toEqual(snapshot.paddles.left);
    expect(snapshot.ai).toEqual({ tracking: true, movement: true });
    expect(ball(snapshot)).toEqual({
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
    // The title shows the clock-zero pose a match will open on: both obstacles
    // upright at their base centers.
    expect(snapshot.obstacles).toEqual(
      OBSTACLE_CENTERS.map((center, index) => ({
        index,
        cx: center.x,
        cy: center.y,
        theta: 0,
      })),
    );
    expect(snapshot.obstacleClock).toBe(0);
    expect(snapshot.obstacleClockRunning).toBe(true);
    expect(snapshot.simTime).toBe(0);
  });

  it("loads no assets, so nothing can fail to arrive", async () => {
    await harness.advance(30);
    expect(harness.assetFailures).toEqual([]);
  });

  it("accumulates simulation time on every screen", async () => {
    await harness.advance(60);
    expect(harness.engine.frame().count).toBe(60);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 6);

    // The menus and the pause screen count too (specs/state.md): the frame
    // `show` advances is one more frame of simulation time like any other.
    await show(harness, "paused");
    await harness.advance(60);
    expect(harness.snapshot().simTime).toBeCloseTo(121 / 60, 6);
  });

  it("refuses to start without the layout it registers against", async () => {
    const failure = await createHarness({ layout: null }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(LAYOUT);
  });
});

// ---- The menus, from the keyboard ---------------------------------------

describe("the menus, from the keyboard", () => {
  it("moves the selection with either side's slider, wrapping both ways", async () => {
    await harness.tap("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(1);

    await harness.tap("KeyW");
    expect(harness.snapshot().menuIndex).toBe(0);

    await harness.tap("KeyW");
    expect(harness.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    await harness.tap("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("moves up alone when both edges arrive on one frame", async () => {
    harness.hold("KeyS");
    harness.release("KeyS");
    harness.hold("KeyW");
    harness.release("KeyW");
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
  });

  it("starts a Solo match from the first item", async () => {
    await harness.tap("Enter");

    expect(harness.engine.world.level).toBe(LEVELS.match);
    const snapshot = harness.snapshot();
    expect(snapshot.screen).toBe("countdown");
    expect(snapshot.mode).toBe("solo");
    expect(snapshot.titleIndex).toBe(0);
    expect(snapshot.score).toEqual({ p1: 0, p2: 0 });
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.resumeScreen).toBe("playing");
    expect(snapshot.obstacleClock).toBe(0);
    expect(ball(snapshot).holdTimer).toBeCloseTo(HOLD_TIME, 6);
  });

  it("starts a Versus match from the second item, with Space", async () => {
    await harness.tap("ArrowDown");
    await harness.tap("Space");
    expect(harness.snapshot().mode).toBe("versus");
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("opens the how-to page and returns to the item that led there", async () => {
    await harness.tap("ArrowDown");
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().menuIndex).toBe(0);
    expect(harness.snapshot().titleIndex).toBe(2);

    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("title");
    // The entry that led away from the title is selected again (specs/ui.md).
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("leaves the how-to page on confirm as well as on back", async () => {
    await show(harness, "howto");
    harness.debug.setTitleIndex(1);
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("does nothing for back on the title", async () => {
    await harness.tap("ArrowDown");
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

// ---- The menus, from a mouse and a finger --------------------------------

describe("the menus, from a pointer", () => {
  it("selects the item a pointer moves onto", async () => {
    const at = harness.itemCenter(2);
    harness.pointerMove(at.x, at.y);
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("selects nothing while the pointer is outside every region", async () => {
    harness.pointerMove(20, 20);
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("confirms an item pressed and released inside one region", async () => {
    const at = harness.itemCenter(1);
    harness.pointerMove(at.x, at.y);
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.advance(1);

    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("versus");
    // A pointer confirm remembers the title item exactly as the keyboard does.
    expect(harness.snapshot().titleIndex).toBe(1);
  });

  it("confirms nothing when the press and the release fall on different items", async () => {
    const from = harness.itemCenter(0);
    const to = harness.itemCenter(1);
    harness.pointerDown(from.x, from.y);
    await harness.advance(1);
    harness.pointerMove(to.x, to.y);
    await harness.advance(1);
    harness.pointerUp(to.x, to.y);
    await harness.advance(1);

    expect(harness.snapshot().screen).toBe("title");
    // The travel still selected what it crossed onto.
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("confirms nothing when an edge falls outside every region", async () => {
    const at = harness.itemCenter(0);
    harness.pointerDown(20, 20);
    await harness.advance(1);
    harness.pointerUp(at.x, at.y);
    await harness.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("selects and confirms from a touch contact that lands and lifts", async () => {
    const at = harness.itemCenter(2);
    // No move in front of it: a finger does not hover, so the landing selects.
    harness.pointerDown(at.x, at.y, { device: "touch" });
    harness.pointerUp(at.x, at.y, { device: "touch" });
    await harness.advance(1);
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().titleIndex).toBe(2);
  });

  it("selects the item a touch contact travels onto", async () => {
    const from = harness.itemCenter(0);
    const to = harness.itemCenter(2);
    harness.pointerDown(from.x, from.y, { device: "touch" });
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
    harness.pointerMove(to.x, to.y, { device: "touch" });
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(2);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("ignores a second, non-primary contact", async () => {
    const at = harness.itemCenter(1);
    harness.pointerDown(at.x, at.y, {
      device: "touch",
      id: 7,
      primary: false,
    });
    harness.pointerUp(at.x, at.y, { device: "touch", id: 7, primary: false });
    await harness.advance(1);
    expect(harness.snapshot().menuIndex).toBe(0);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("leaves the selection where a pointer put it when a key moved it too", async () => {
    const at = harness.itemCenter(2);
    harness.hold("ArrowDown");
    harness.release("ArrowDown");
    harness.pointerMove(at.x, at.y);
    await harness.advance(1);
    // The pointer is applied after the frame's keyboard edges (specs/ui.md).
    expect(harness.snapshot().menuIndex).toBe(2);
  });

  it("confirms the keyboard's item alone when both confirm on one frame", async () => {
    const at = harness.itemCenter(2);
    harness.hold("Enter");
    harness.release("Enter");
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.advance(1);
    // Enter confirmed SOLO, the item the keyboard had highlighted.
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("solo");
    expect(harness.snapshot().titleIndex).toBe(0);
  });

  it("drives the pause menu the same way", async () => {
    await countdown(harness, "versus");
    await show(harness, "paused");
    const at = harness.itemCenter(PAUSE_ITEMS.length - 1);
    harness.pointerMove(at.x, at.y);
    harness.pointerDown(at.x, at.y);
    harness.pointerUp(at.x, at.y);
    await harness.advance(1);
    expect(harness.snapshot().screen).toBe("title");
  });

  it("reports no region on the screens that show no menu", async () => {
    await countdown(harness, "versus");
    expect(harness.debug.menuItemRect(0)).toBeNull();
    await show(harness, "matchover");
    expect(harness.debug.menuItemRect(0)).not.toBeNull();
    expect(harness.debug.menuItemRect(MATCHOVER_ITEMS.length)).toBeNull();
  });

  it("reports the region the how-to page's one item occupies", async () => {
    await show(harness, "howto");
    expect(harness.debug.menuItemRect(0)).not.toBeNull();
    expect(harness.debug.menuItemRect(HOWTO_ITEMS.length)).toBeNull();
  });
});

// ---- Pause ---------------------------------------------------------------

describe("pause", () => {
  it("opens the pause menu from Escape and from P, on both live screens", async () => {
    for (const [key, from] of [
      ["Escape", "countdown"],
      ["KeyP", "playing"],
    ] as const) {
      await countdown(harness, "versus");
      if (from === "playing") {
        harness.debug.setBallHoldTimer(0);
        await harness.advance(2);
      }
      expect(harness.snapshot().screen).toBe(from);

      await harness.tap(key);
      expect(harness.snapshot().screen).toBe("paused");
      expect(harness.snapshot().resumeScreen).toBe(from);
      expect(harness.snapshot().menuIndex).toBe(0);

      // One Escape opens it and leaves it open: `back` is not read on a live
      // screen, so the edge it armed is discarded (specs/ui.md).
      await harness.advance(2);
      expect(harness.snapshot().screen).toBe("paused");
    }
  });

  it("resumes from Escape and from P alike", async () => {
    for (const key of ["Escape", "KeyP"] as const) {
      await countdown(harness, "versus");
      await show(harness, "paused");
      harness.debug.setResumeScreen("countdown");
      await harness.tap(key);
      expect(harness.snapshot().screen).toBe("countdown");
    }
  });

  it("resumes once for one Escape, which arms both pause and back", async () => {
    await countdown(harness, "versus");
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("paused");
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("countdown");
    // And the resumed screen is not paused again by a leftover edge.
    await harness.advance(3);
    expect(harness.snapshot().screen).toBe("countdown");
  });

  it("resumes and does nothing else on a frame carrying a menu edge too", async () => {
    await countdown(harness, "versus");
    await show(harness, "paused");
    harness.hold("ArrowDown");
    harness.release("ArrowDown");
    harness.hold("KeyP");
    harness.release("KeyP");
    await harness.advance(1);
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().menuIndex).toBe(0);
  });

  it("freezes the field behind the menu", async () => {
    await rally(harness, "versus", { x: 400, y: 300, vx: 300, vy: 0 });
    await harness.advance(6);
    await show(harness, "paused");
    const frozen = harness.snapshot();
    await harness.advance(90);
    const later = harness.snapshot();
    expect(ball(later).x).toBe(ball(frozen).x);
    expect(ball(later).y).toBe(ball(frozen).y);
    expect(later.obstacleClock).toBe(frozen.obstacleClock);
    // Time itself still runs (specs/state.md).
    expect(later.simTime).toBeGreaterThan(frozen.simTime);
  });

  it("restarts and quits from its own items", async () => {
    await countdown(harness, "solo");
    harness.debug.setScore(5, 3);
    await show(harness, "paused");
    harness.debug.setMenuIndex(1); // RESTART
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("solo");
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });

    await show(harness, "paused");
    harness.debug.setTitleIndex(2);
    harness.debug.setMenuIndex(PAUSE_ITEMS.length - 1); // QUIT TO MENU
    await harness.tap("Enter");
    const back = harness.snapshot();
    expect(back.screen).toBe("title");
    expect(back.mode).toBe("solo");
    expect(back.menuIndex).toBe(2);
    expect(back.titleIndex).toBe(2);
  });
});

// ---- The paddles ---------------------------------------------------------

describe("the paddles", () => {
  it("moves player one at PADDLE_SPEED while a movement action is held", async () => {
    await countdown(harness, "versus");
    harness.hold("KeyS");
    await harness.advance(12);
    harness.release("KeyS");

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("drives player one from either slider in Solo", async () => {
    await countdown(harness, "solo");
    harness.hold("ArrowDown");
    await harness.advance(12);
    harness.release("ArrowDown");
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY + PADDLE_SPEED * 0.2,
      3,
    );
  });

  it("stands still when opposite sliders are held in Solo", async () => {
    await countdown(harness, "solo");
    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.advance(12);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY, 3);
  });

  it("gives the second slider its own paddle in Versus", async () => {
    await countdown(harness, "versus");
    harness.hold("KeyW");
    harness.hold("ArrowDown");
    await harness.advance(12);

    const { left, right } = harness.snapshot().paddles;
    expect(left.cy).toBeCloseTo(FIELD_CY - PADDLE_SPEED * 0.2, 3);
    expect(right.cy).toBeCloseTo(FIELD_CY + PADDLE_SPEED * 0.2, 3);
  });

  it("hands the right paddle to the AI in Solo and back in Versus", async () => {
    await countdown(harness, "solo");
    harness.debug.setPaddleCy("right", PADDLE_MAX_CY - 20);
    // Nothing held: in Solo the AI eases the right paddle home anyway.
    await harness.advance(60);
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(
      PADDLE_MAX_CY - 60,
    );

    // Posed into Versus on the SAME open match, the paddle answers player two.
    harness.debug.setMode("versus");
    harness.debug.setPaddleCy("right", 400);
    await harness.advance(30);
    expect(harness.snapshot().paddles.right.cy).toBeCloseTo(400, 3);
  });

  it("reports zero velocity while pinned against a bound", async () => {
    await countdown(harness, "versus");
    harness.hold("KeyS");
    await harness.advance(60);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(PADDLE_MAX_CY, 6);
    expect(harness.snapshot().paddles.left.vy).toBe(0);
  });
});

// ---- The debug surface ---------------------------------------------------

describe("the debug surface", () => {
  it("carries the version and every operation as a method", () => {
    const api = harness.debug as unknown as Record<string, unknown>;
    expect(api.version).toBe(1);
    for (const op of [
      "clearWorld",
      "spawnBall",
      "spawnObstacle",
      "reset",
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
      "setBallServeSign",
      "drawBallServeSign",
      "setAiTracking",
      "setAiMovement",
      "setMuted",
      "setObstacleClock",
      "setObstacleClockRunning",
      "snapshot",
      "menuItemRect",
    ]) {
      expect(typeof api[op]).toBe("function");
    }
  });

  it("is the object the engine hands back, and reading it changes nothing", () => {
    expect(harness.engine.debug).toBe(harness.debug);
    const first = harness.snapshot();
    expect(harness.snapshot()).toEqual(first);
  });

  it("sets each declared field and reads it straight back", async () => {
    await countdown(harness, "versus");
    const d = harness.debug;

    d.setMode("solo");
    d.setMenuIndex(2);
    d.setTitleIndex(1);
    d.setResumeScreen("countdown");
    d.setScore(4, 7);
    d.setWinner("right");
    d.setReceiver("right");
    d.setPaddleCy("left", 200);
    d.setPaddleVy("left", -120);
    d.setPaddleDriven("left", true);
    d.setPaddleCy("right", 500);
    d.setAiTracking(false);
    d.setAiMovement(false);
    d.setObstacleClockRunning(false);
    d.setObstacleClock(0.75);
    d.setBallPosition(300, 250);
    d.setBallVelocity(120, -40);
    d.setBallSpin(66);
    d.setBallHeld(false);
    d.setBallHoldTimer(0.25);
    d.setBallServeSign(-1);

    const s = harness.snapshot();
    expect(s.mode).toBe("solo");
    expect(s.menuIndex).toBe(2);
    expect(s.titleIndex).toBe(1);
    expect(s.resumeScreen).toBe("countdown");
    expect(s.score).toEqual({ p1: 4, p2: 7 });
    expect(s.winner).toBe("right");
    expect(s.receiver).toBe("right");
    expect(s.paddles.left).toEqual({
      cy: 200,
      vy: 0,
      drivenVy: -120,
      driven: true,
    });
    // Driving one side leaves the other exactly as it was.
    expect(s.paddles.right).toEqual({
      cy: 500,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(s.ai).toEqual({ tracking: false, movement: false });
    expect(s.obstacleClock).toBe(0.75);
    expect(s.obstacleClockRunning).toBe(false);
    expect(ball(s).serveSign).toBe(-1);
    expect(ball(s).x).toBe(300);
    expect(ball(s).y).toBe(250);
    expect(ball(s).vx).toBe(120);
    expect(ball(s).vy).toBe(-40);
    expect(ball(s).speed).toBeCloseTo(Math.hypot(120, -40), 9);
    expect(ball(s).spin).toBe(66);
    expect(ball(s).held).toBe(false);
    expect(ball(s).holdTimer).toBe(0.25);
  });

  it("carries a set drivenVy into vy on the first driven frame", async () => {
    await countdown(harness, "versus");
    harness.debug.setPaddleVy("left", -300);
    await harness.advance(3);
    // Not driven yet: the velocity is held but unused.
    expect(harness.snapshot().paddles.left.vy).toBe(0);
    expect(harness.snapshot().paddles.left.drivenVy).toBe(-300);

    harness.debug.setPaddleDriven("left", true);
    await harness.advance(1);
    expect(harness.snapshot().paddles.left.vy).toBe(-300);

    // And it holds across frames rather than being a one-frame nudge.
    await harness.advance(11);
    expect(harness.snapshot().paddles.left.cy).toBeCloseTo(
      FIELD_CY - 300 * 0.2,
      3,
    );
  });

  it("leaves a driven paddle alone when its keys are held", async () => {
    await countdown(harness, "versus");
    harness.debug.setPaddleDriven("left", true);
    harness.debug.setPaddleVy("left", 0);
    harness.hold("KeyS");
    await harness.advance(20);
    expect(harness.snapshot().paddles.left.cy).toBe(FIELD_CY);
    harness.release("KeyS");
  });

  it("empties the field and puts each body back on its own", async () => {
    await countdown(harness, "versus");
    harness.debug.clearWorld();
    expect(harness.snapshot().ball).toBeNull();
    expect(harness.snapshot().obstacles).toEqual([]);

    // An absent ball takes no part in a frame.
    await harness.advance(90);
    expect(harness.snapshot().ball).toBeNull();
    expect(harness.snapshot().screen).toBe("countdown");

    harness.debug.spawnObstacle(1);
    expect(harness.snapshot().obstacles.map((o) => o.index)).toEqual([1]);
    harness.debug.spawnBall();
    const s = harness.snapshot();
    expect(ball(s).x).toBe(FIELD_CX);
    expect(ball(s).held).toBe(true);
    expect(ball(s).holdTimer).toBeCloseTo(HOLD_TIME, 6);
    expect(ball(s).trail).toEqual([]);
  });

  it("does nothing to a ball that is not there", async () => {
    await countdown(harness, "versus");
    harness.debug.clearWorld();
    harness.debug.setBallPosition(10, 10);
    harness.debug.setBallVelocity(1, 1);
    harness.debug.setBallSpin(1);
    harness.debug.setBallHeld(false);
    harness.debug.setBallHoldTimer(0);
    expect(harness.snapshot().ball).toBeNull();
  });

  it("changes the screen and nothing else, across the level split", async () => {
    harness.debug.setScore(3, 4);
    harness.debug.setMenuIndex(2);
    harness.debug.setTitleIndex(1);
    harness.debug.setReceiver("right");
    await show(harness, "matchover");

    const s = harness.snapshot();
    expect(s.screen).toBe("matchover");
    expect(s.score).toEqual({ p1: 3, p2: 4 });
    expect(s.menuIndex).toBe(2);
    expect(s.titleIndex).toBe(1);
    expect(s.receiver).toBe("right");
    expect(s.obstacles).toHaveLength(OBSTACLES.length);

    // And back the other way, still carrying the scores and the indices.
    await show(harness, "title");
    const back = harness.snapshot();
    expect(back.screen).toBe("title");
    expect(back.score).toEqual({ p1: 3, p2: 4 });
    expect(back.menuIndex).toBe(2);
  });

  it("returns the whole game to the title, leaving the mute bit alone", async () => {
    await countdown(harness, "solo");
    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(true);
    harness.debug.setScore(6, 2);
    harness.debug.setTitleIndex(2);
    harness.debug.setAiTracking(false);
    harness.debug.setPaddleDriven("right", true);
    harness.debug.clearWorld();
    await harness.advance(30);

    harness.debug.reset();
    await harness.advance(1);
    const s = harness.snapshot();
    expect(s.screen).toBe("title");
    expect(s.mode).toBe("solo");
    expect(s.menuIndex).toBe(0);
    expect(s.titleIndex).toBe(0);
    expect(s.score).toEqual({ p1: 0, p2: 0 });
    expect(s.winner).toBeNull();
    expect(s.receiver).toBe("left");
    expect(s.ai).toEqual({ tracking: true, movement: true });
    expect(s.paddles.right.driven).toBe(false);
    expect(s.obstacles).toHaveLength(OBSTACLES.length);
    expect(ball(s).held).toBe(true);
    // The engine owns the mute bit, so a reset does not touch it.
    expect(s.muted).toBe(true);
  });
});

// ---- Serving -------------------------------------------------------------

describe("serving", () => {
  it("holds the ball for HOLD_TIME and then launches it toward player one", async () => {
    await countdown(harness, "versus");
    expect(ball(harness.snapshot()).held).toBe(true);

    await harness.advance(frames(HOLD_TIME) - 2);
    expect(harness.snapshot().screen).toBe("countdown");
    expect(ball(harness.snapshot()).speed).toBe(0);

    await harness.advance(3);
    const s = harness.snapshot();
    expect(s.screen).toBe("playing");
    expect(ball(s).held).toBe(false);
    expect(ball(s).holdTimer).toBe(0);
    expect(ball(s).speed).toBeCloseTo(SERVE_SPEED, 6);
    expect(ball(s).vx).toBeLessThan(0);
    expect(Math.abs(Math.atan2(ball(s).vy, ball(s).vx))).toBeCloseTo(
      Math.PI - SERVE_ANGLE,
      6,
    );
  });

  it("serves toward the receiver, with the sign the ball holds", async () => {
    await countdown(harness, "versus");
    harness.debug.setReceiver("right");
    harness.debug.setBallHoldTimer(0);
    await harness.advance(2);
    expect(ball(harness.snapshot()).vx).toBeGreaterThan(0);

    // A posed sign is the sign the serve takes, and the serve leaves it as it is.
    for (const sign of [-1, 1] as const) {
      harness.debug.spawnBall();
      harness.debug.setBallServeSign(sign);
      harness.debug.setBallHoldTimer(0);
      harness.debug.setScreen("countdown");
      await harness.advance(2);
      expect(Math.sign(ball(harness.snapshot()).vy)).toBe(sign);
      expect(ball(harness.snapshot()).serveSign).toBe(sign);
    }
  });

  it("draws the serve sign afresh whenever the ball is parked", async () => {
    await countdown(harness, "versus");
    const signs = new Set<number>();
    for (let i = 0; i < 200 && signs.size < 2; i++) {
      harness.debug.spawnBall();
      signs.add(ball(harness.snapshot()).serveSign);
    }
    expect(signs).toEqual(new Set([1, -1]));
  });
});

// ---- The rally -----------------------------------------------------------

describe("the rally", () => {
  it("reflects off the top wall and keeps its speed", async () => {
    await rally(harness, "versus", { x: FIELD_CX, y: 60, vx: 0, vy: -300 });
    await harness.advance(20);
    const s = harness.snapshot();
    expect(ball(s).vy).toBeGreaterThan(0);
    expect(ball(s).speed).toBeCloseTo(300, 6);
    expect(played(harness)).toContain(CUES.wallBounce);
  });

  it("bounces off a paddle, gains speed, and takes spin from its motion", async () => {
    await rally(harness, "versus", {
      x: P1_X1 + BALL_R + 40,
      y: 300,
      vx: -400,
      vy: 0,
    });
    harness.debug.setPaddleCy("left", 300);
    harness.debug.setPaddleVy("left", 300);
    // Stopped on the frame of the contact, before the spin has had time to
    // decay away from what the paddle's motion put on the ball.
    await until(harness, (snap) => (snap.ball?.vx ?? 0) > 0);

    const s = harness.snapshot();
    // Sent back toward the opponent, one notch faster than it arrived.
    expect(ball(s).vx).toBeGreaterThan(0);
    expect(ball(s).speed).toBeCloseTo(400 * SPEED_MULT, 6);
    // A paddle moving downward adds positive spin, which then decays.
    const fresh = 300 * SPIN_FROM_PADDLE;
    expect(ball(s).spin).toBeLessThanOrEqual(fresh);
    expect(ball(s).spin).toBeGreaterThan(fresh * 0.97);
    expect(played(harness)).toContain(CUES.paddleHit);
  });

  it("banks off an obstacle without changing speed", async () => {
    await rally(
      harness,
      "versus",
      { x: 300, y: OBSTACLE_CENTERS[0].y, vx: 400, vy: 0 },
      { obstacles: [0] },
    );
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0);
    await harness.advance(30);

    const s = harness.snapshot();
    expect(ball(s).vx).toBeLessThan(0);
    expect(ball(s).speed).toBeCloseTo(400, 6);
    expect(played(harness)).toContain(CUES.obstacleBounce);
  });

  it("records a trail of the last TRAIL_TIME seconds of travel", async () => {
    await rally(harness, "versus", { x: 300, y: 300, vx: 400, vy: 0 });
    await harness.advance(30);
    const trail = ball(harness.snapshot()).trail;
    expect(trail.length).toBeGreaterThan(2);
    const span = trail[trail.length - 1].t - trail[0].t;
    expect(span).toBeLessThanOrEqual(TRAIL_TIME + 1e-9);
    // Oldest first, and the newest sample is where the ball is now.
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i].t).toBeGreaterThan(trail[i - 1].t);
    }
    expect(trail[trail.length - 1].x).toBeCloseTo(
      ball(harness.snapshot()).x,
      6,
    );
  });
});

// ---- Scoring -------------------------------------------------------------

describe("scoring", () => {
  it("gives player one the point past the right goal and re-serves", async () => {
    await rally(harness, "versus", {
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 900,
      vy: 0,
    });
    await until(harness, (snap) => snap.screen !== "playing");

    const s = harness.snapshot();
    expect(s.score).toEqual({ p1: 1, p2: 0 });
    expect(s.screen).toBe("countdown");
    expect(s.receiver).toBe("right");
    expect(ball(s).x).toBe(FIELD_CX);
    expect(ball(s).held).toBe(true);
    expect(ball(s).holdTimer).toBeCloseTo(HOLD_TIME, 6);
    expect(played(harness)).toContain(CUES.score);
  });

  it("gives player two the point past the left goal", async () => {
    await rally(harness, "versus", {
      x: FIELD_CX,
      y: FIELD_CY,
      vx: -900,
      vy: 0,
    });
    await until(harness, (snap) => snap.screen !== "playing");
    const s = harness.snapshot();
    expect(s.score).toEqual({ p1: 0, p2: 1 });
    expect(s.receiver).toBe("left");
  });

  it("ends the match at WIN_SCORE with a two-point lead", async () => {
    await rally(harness, "versus", {
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 900,
      vy: 0,
    });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 2);
    await until(harness, (snap) => snap.screen !== "playing");

    const s = harness.snapshot();
    expect(s.score).toEqual({ p1: WIN_SCORE, p2: WIN_SCORE - 2 });
    expect(s.winner).toBe("left");
    expect(s.screen).toBe("matchover");
    expect(s.menuIndex).toBe(0);
  });

  it("plays on at deuce until someone leads by two", async () => {
    await rally(harness, "versus", {
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 900,
      vy: 0,
    });
    harness.debug.setScore(WIN_SCORE - 1, WIN_SCORE - 1);
    await until(harness, (snap) => snap.screen !== "playing");
    expect(harness.snapshot().winner).toBeNull();
    expect(harness.snapshot().screen).toBe("countdown");

    harness.debug.setBallPosition(FIELD_CX, FIELD_CY);
    harness.debug.setBallVelocity(900, 0);
    harness.debug.setBallHeld(false);
    harness.debug.setScreen("playing");
    await until(harness, (snap) => snap.screen === "matchover");
    const s = harness.snapshot();
    expect(s.score).toEqual({ p1: WIN_SCORE + 1, p2: WIN_SCORE - 1 });
    expect(s.winner).toBe("left");
    expect(s.screen).toBe("matchover");
  });

  it("plays again and returns to the menu from the match-over screen", async () => {
    await countdown(harness, "solo");
    harness.debug.setScore(WIN_SCORE, 3);
    harness.debug.setWinner("left");
    await show(harness, "matchover");

    await harness.tap("Enter"); // PLAY AGAIN
    expect(harness.snapshot().screen).toBe("countdown");
    expect(harness.snapshot().mode).toBe("solo");
    expect(harness.snapshot().score).toEqual({ p1: 0, p2: 0 });
    expect(harness.snapshot().winner).toBeNull();

    await show(harness, "matchover");
    harness.debug.setTitleIndex(1);
    await harness.tap("Escape"); // back leaves for the title
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

// ---- The AI's faculties, in the running game -----------------------------

describe("the AI opponent", () => {
  it("defends a ball coming toward it, and stops when tracking is off", async () => {
    await rally(harness, "solo", { x: FIELD_CX, y: 200, vx: 300, vy: 0 });
    harness.debug.setPaddleDriven("right", false);
    harness.debug.setPaddleCy("right", FIELD_CY);
    await harness.advance(30);
    expect(harness.snapshot().paddles.right.cy).toBeLessThan(260);

    // Blind, it eases home instead, whatever the ball is doing.
    harness.debug.setBallPosition(FIELD_CX, 200);
    harness.debug.setBallVelocity(300, 0);
    harness.debug.setAiTracking(false);
    await harness.advance(120);
    // Home, and stopped inside the wider home deadzone rather than jittering
    // onto a perfect line (specs/modes/single-player.md).
    expect(
      Math.abs(harness.snapshot().paddles.right.cy - AI_HOME_Y),
    ).toBeLessThanOrEqual(AI_HOME_DEADZONE);
    expect(harness.snapshot().paddles.right.vy).toBe(0);
  });

  it("stays exactly where it is when movement is off", async () => {
    await rally(harness, "solo", { x: FIELD_CX, y: 200, vx: 300, vy: 0 });
    harness.debug.setPaddleDriven("right", false);
    harness.debug.setPaddleCy("right", 500);
    harness.debug.setAiMovement(false);
    await harness.advance(60);
    expect(harness.snapshot().paddles.right.cy).toBe(500);
    expect(harness.snapshot().paddles.right.vy).toBe(0);
  });
});

// ---- The obstacle clock --------------------------------------------------

describe("the obstacle clock", () => {
  it("winds through the countdown and on into play", async () => {
    await countdown(harness, "versus");
    const opened = harness.snapshot();
    expect(opened.obstacleClock).toBeCloseTo(0, 6);

    await harness.advance(30);
    const later = harness.snapshot();
    expect(later.screen).toBe("countdown");
    expect(later.obstacleClock).toBeCloseTo(opened.obstacleClock + 0.5, 6);
    for (const obstacle of later.obstacles) {
      const expected = obstaclePose(obstacle.index, later.obstacleClock);
      expect(obstacle.cx).toBeCloseTo(expected.cx, 6);
      expect(obstacle.cy).toBeCloseTo(expected.cy, 6);
      expect(obstacle.theta).toBeCloseTo(expected.theta, 6);
    }
    expect(later.obstacles[0].theta).toBeCloseTo(
      OBSTACLE_SPIN_RATE * later.obstacleClock,
      6,
    );
  });

  it("sways the pair in anti-phase about their base centers", async () => {
    await countdown(harness, "versus");
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(OBSTACLE_SPIN_RATE > 0 ? 0.9 : 0.9);

    const [a, b] = harness.snapshot().obstacles;
    expect(a.cx).toBe(OBSTACLE_CENTERS[0].x);
    expect(b.cx).toBe(OBSTACLE_CENTERS[1].x);
    const upA = a.cy - OBSTACLE_CENTERS[0].y;
    const upB = b.cy - OBSTACLE_CENTERS[1].y;
    expect(Math.abs(upA)).toBeGreaterThan(1);
    expect(upA).toBeCloseTo(-upB, 9);
  });

  it("holds still while it is not running, and while the game is paused", async () => {
    await countdown(harness, "versus");
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0.4);
    const held = harness.snapshot();
    await harness.advance(60);
    expect(harness.snapshot().obstacleClock).toBe(0.4);
    expect(harness.snapshot().obstacles).toEqual(held.obstacles);

    harness.debug.setObstacleClockRunning(true);
    await harness.advance(30);
    expect(harness.snapshot().obstacleClock).toBeCloseTo(0.9, 6);
  });

  it("starts every match over at zero", async () => {
    await countdown(harness, "versus");
    await harness.advance(60);
    expect(harness.snapshot().obstacleClock).toBeGreaterThan(0.5);

    await show(harness, "paused");
    harness.debug.setMenuIndex(1); // RESTART
    await harness.tap("Enter");
    expect(harness.snapshot().obstacleClock).toBeCloseTo(0, 6);
    expect(harness.snapshot().obstacles[0].theta).toBeCloseTo(0, 6);
  });

  it("deflects a level shot off a tilted face, and returns it off an upright one", async () => {
    const shoot = async (t: number): Promise<number> => {
      await rally(
        harness,
        "versus",
        { x: 0, y: 0, vx: 0, vy: 0 },
        { obstacles: [0] },
      );
      harness.debug.setObstacleClockRunning(false);
      harness.debug.setObstacleClock(t);
      const pose = harness.snapshot().obstacles[0];
      harness.debug.setBallPosition(pose.cx - 120, pose.cy);
      harness.debug.setBallVelocity(400, 0);
      await harness.advance(30);
      const s = ball(harness.snapshot());
      return Math.atan2(s.vy, s.vx);
    };

    const upright = await shoot(0);
    expect(Math.abs(upright)).toBeCloseTo(Math.PI, 2); // straight back

    const tilted = await shoot(Math.PI / 4 / OBSTACLE_SPIN_RATE);
    // The tilted face throws it well off the axis it came in on.
    expect(Math.abs(Math.abs(tilted) - Math.PI)).toBeGreaterThan(0.5);
  });
});

// ---- Audio ---------------------------------------------------------------

describe("audio", () => {
  it("mutes and unmutes from any screen", async () => {
    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(true);
    await countdown(harness, "versus");
    expect(harness.snapshot().muted).toBe(true);
    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(false);
  });
});

// ---- Rendering -----------------------------------------------------------

describe("rendering", () => {
  it("fills each body in its own color at its own position", async () => {
    await rally(
      harness,
      "versus",
      { x: 400, y: 200, vx: 0, vy: 0 },
      { obstacles: [0, 1] },
    );
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(0);
    harness.debug.setPaddleCy("left", 500);
    await harness.advance(1);

    expect(harness.pixel(P1_X1 - 8, 500)).toEqual(rgba(COLOR.p1));
    expect(harness.pixel(400, 200)).toEqual(rgba(COLOR.ball));
    const [a] = OBSTACLES;
    expect(harness.pixel((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2)).toEqual(
      rgba(COLOR.obstacle),
    );
  });

  it("draws the letterboxed field over the background color", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    await harness.advance(1);
    expect(harness.pixel(180, 620)).toEqual(rgba(BACKGROUND));
  });

  it("draws each obstacle rotated and shifted to its posed angle", async () => {
    await countdown(harness, "versus");
    const t90 = Math.PI / 2 / OBSTACLE_SPIN_RATE;
    harness.debug.setObstacleClockRunning(false);
    harness.debug.setObstacleClock(t90);
    await harness.advance(1);

    const pose = obstaclePose(0, t90);
    // Half a bar-length ALONG the turned long axis (leftward, clear of the
    // countdown chrome): inside the drawn bar now, open field when upright.
    expect(harness.pixel(pose.cx - 40, pose.cy)).toEqual(rgba(COLOR.obstacle));
    // Half a bar-length BELOW the center — inside the upright bar — is not the
    // obstacle any more.
    expect(harness.pixel(pose.cx, pose.cy + 60)).not.toEqual(
      rgba(COLOR.obstacle),
    );
  });

  it("honors the renderer's wireframe switch", async () => {
    await rally(harness, "versus", { x: 400, y: 200, vx: 0, vy: 0 });
    // Long enough for the trail of the serve to age out, so what is at the
    // ball's center is the ball alone.
    await harness.advance(frames(TRAIL_TIME) + 2);
    harness.engine.renderer.setMode("wireframe");
    await harness.advance(1);

    expect(harness.engine.renderer.mode()).toBe("wireframe");
    // Outlines alone: the ball's interior is no longer filled.
    expect(harness.pixel(400, 200)).toEqual(rgba(BACKGROUND));
  });

  it("keeps the whole field on screen at any window size", async () => {
    const view = harness.engine.viewport();
    expect(view.offsetX).toBeGreaterThanOrEqual(0);
    expect(view.offsetY).toBeGreaterThanOrEqual(0);
    expect(view.scale * FIELD_W).toBeLessThanOrEqual(FIELD_W + 1e-6);
    expect(view.scale * FIELD_H).toBeLessThanOrEqual(FIELD_H + 1e-6);
  });
});
