// Kessler under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and
// a `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock` of one frame per tick. Keys are driven by dispatching
// keyboard-shaped events at the surface's event target — the same listener a
// player's key reaches — and what is read back is the game's own state, the
// debug surface `initialize` returned beside it, the engine's cue events,
// and the pixels the render produced.
//
// Nothing in this process can fetch or decode a file, so every produced
// asset fails to load here. That is deliberate: it is the check that a build
// whose assets are unavailable still initializes, still ticks, still takes
// input, and still draws a legible field.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUES, STAGE_H, STAGE_W } from "./constants";
import { BED_NAMES } from "./audio";
import {
  BACKGROUND,
  game,
  type KesslerDebugApi,
  type KesslerState,
} from "./game";
import { pointAt } from "./polar";
import type { DeepReadonly } from "ts-essentials";

const FRAME_MS = 1000 / 60;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

interface Harness {
  readonly engine: Engine<KesslerState, KesslerDebugApi>;
  readonly state: DeepReadonly<KesslerState>;
  readonly debug: KesslerDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: string[];
  readonly loops: string[];
  readonly stops: string[];
  tap(code: string, repeat?: boolean): void;
  down(code: string): void;
  up(code: string): void;
  pose(transition: (state: DeepReadonly<KesslerState>) => KesslerState): void;
  dispose(): void;
}

function surfaceOf(events: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };
}

function canvasOf(): { element: HTMLCanvasElement; ctx: SKRSContext2D } {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;
  return { element, ctx };
}

async function createHarness(): Promise<Harness> {
  const { element, ctx } = canvasOf();
  const events = new EventTarget();

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<KesslerState, KesslerDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(FRAME_MS),
    surface: surfaceOf(events),
  });

  const cues: string[] = [];
  const loops: string[] = [];
  const stops: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));
  engine.events.on("cue:stopped", ({ cue }) => stops.push(cue));

  await engine.initialize();

  return {
    engine,
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface beside its state fails here.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    stops,
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    down: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    up: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    pose: (transition) => void engine.apply(transition),
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

function snap() {
  return h.debug.snapshot(h.engine.state);
}

describe("initialization", () => {
  it("opens on the title with the surface beside the state", () => {
    expect(h.state.screen).toBe("title");
    expect(h.debug).toBeTruthy();
    expect(snap().screen).toBe("title");
    expect(snap().lives).toBe(3);
  });

  it("initializes and draws even though no produced file could load", async () => {
    expect(h.state.assets.planet).toBeNull();
    await h.engine.advance(1);
    // The title's own copy is drawn in code, so the stage is not blank.
    const painted = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    let lit = 0;
    for (let i = 0; i < painted.length; i += 4) {
      if (painted[i]! + painted[i + 1]! + painted[i + 2]! > 90) lit += 1;
    }
    expect(lit).toBeGreaterThan(0);
  });
});

describe("the keyboard", () => {
  it("moves the title highlight with wrap, playing menu-move", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(snap().menu.index).toBe(1);
    h.tap("KeyW");
    await h.engine.advance(1);
    expect(snap().menu.index).toBe(0);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(2);
  });

  it("raises nothing for an auto-repeat", async () => {
    h.tap("ArrowDown", true);
    await h.engine.advance(1);
    expect(snap().menu.index).toBe(0);
  });

  it("starts a session on START without launching the parked ball", async () => {
    // Space carries both confirm and launch; the press is routed against the
    // title screen it arrived on, so the ball it parks stays parked.
    h.tap("Space");
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    expect(snap().balls).toHaveLength(1);
    expect(snap().balls[0].parked).toBe(true);
    // A second press, arriving on playing, launches.
    h.tap("Space");
    await h.engine.advance(1);
    expect(snap().balls[0].parked).toBe(false);
  });

  it("turns the deflector while a rotation key is held", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    // Hold D for 60 frames: 270 deg/s over one second, wrapping mod 360.
    h.down("KeyD");
    await h.engine.advance(60);
    h.up("KeyD");
    expect(snap().paddle.angleDeg).toBeCloseTo(0, 6);
  });

  it("pauses with Escape, resumes with KeyP", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    h.tap("KeyP");
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
  });
});

describe("the clock the engine owns", () => {
  it("resolves sixty ticks in a second of game time", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.engine.advance(60);
    expect(snap().ticks).toBe(60);
  });

  it("advances a launched ball by its speed per tick", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.setPaddleAngle(s, 0));
    h.pose((s) => h.debug.launchBall(s));
    await h.engine.advance(30);
    const ball = snap().balls[0];
    const expected = pointAt(194 + 240 * 0.5, 0);
    expect(ball.x).toBeCloseTo(expected.x, 6);
    expect(ball.y).toBeCloseTo(expected.y, 6);
  });
});

describe("the cue bus", () => {
  it("loops the title bed at boot and swaps to the play bed on START", async () => {
    await h.engine.advance(1);
    expect(h.loops).toContain(BED_NAMES.title);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.stops).toContain(BED_NAMES.title);
    expect(h.loops).toContain(BED_NAMES.play);
  });

  it("plays field-bounce on the tick the containment reflects a ball", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.clearBalls(s));
    h.pose((s) => h.debug.clearTargets(s));
    h.pose((s) => h.debug.spawnBall(s, 900, 500, 480, 0));
    h.cues.length = 0;
    await h.engine.advance(30);
    expect(h.cues.filter((cue) => cue === CUES.fieldBounce)).toHaveLength(1);
  });

  it("plays the game-over cue on the last life", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.setLives(s, 1));
    h.pose((s) => h.debug.clearBalls(s));
    const at = pointAt(90, 90);
    h.pose((s) => h.debug.spawnBall(s, at.x, at.y, 0, -240));
    h.cues.length = 0;
    await h.engine.advance(10);
    expect(snap().screen).toBe("gameover");
    expect(h.cues).toContain(CUES.ballLost);
    expect(h.cues).toContain(CUES.gameOver);
  });
});

describe("drawing through the engine's context", () => {
  it("leaves the state exactly as update left it", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.engine.advance(1);
    const before = JSON.stringify(snap());
    game.render(h.engine.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
      frame: () => h.engine.frame(),
      viewport: () => h.engine.viewport(),
    });
    expect(JSON.stringify(snap())).toBe(before);
  });

  it("paints the paused overlay over the frozen field", async () => {
    h.tap("Enter");
    await h.engine.advance(5);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    const painted = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    let lit = 0;
    for (let i = 0; i < painted.length; i += 4) {
      if (painted[i]! + painted[i + 1]! + painted[i + 2]! > 90) lit += 1;
    }
    expect(lit).toBeGreaterThan(0);
  });
});
