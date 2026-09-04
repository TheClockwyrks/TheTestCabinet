// Coil under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// are driven by dispatching keyboard-shaped events at the surface's event target
// — the same listener a player's key reaches — and what is read back is the
// game's own state, the debug surface `initialize` returned beside it, the
// engine's cue events, and the pixels the render produced.
//
// Nothing in this process can fetch or decode an image, so every produced file
// fails to load here. That is deliberate: it is the check that a build whose
// assets are unavailable still initializes, still ticks, still takes input, and
// still draws a board.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellX, cellY } from "./board";
import {
  CELL,
  CUES,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_SECONDS,
  TITLE_ITEMS,
  type Cell,
} from "./constants";
import { BACKGROUND, game, type CoilDebugApi, type CoilState } from "./game";
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
  readonly engine: Engine<CoilState, CoilDebugApi>;
  readonly state: DeepReadonly<CoilState>;
  readonly debug: CoilDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: string[];
  readonly loops: string[];
  tap(code: string, repeat?: boolean): void;
  pose(transition: (state: DeepReadonly<CoilState>) => CoilState): void;
  pixel(cell: Cell): [number, number, number];
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
  const engine = createEngine<CoilState, CoilDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface: surfaceOf(events),
  });

  const cues: string[] = [];
  const loops: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));

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
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pose: (transition) => void engine.apply(transition),
    pixel: (cell) => {
      const data = ctx.getImageData(
        Math.round(cellX(cell.col) + CELL / 2),
        Math.round(cellY(cell.row) + CELL / 2),
        1,
        1,
      ).data;
      return [data[0]!, data[1]!, data[2]!];
    },
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

/**
 * Whole frames of the harness's clock covering at least `seconds` of game time.
 *
 * Rounded up rather than to nearest, so an interval that is not a whole number of
 * frames is always reached rather than stopping a fraction of a frame short.
 */
function frames(seconds: number): number {
  return Math.ceil((seconds * 1000) / FRAME_MS - 1e-9);
}

describe("initialization", () => {
  it("opens on the title with the surface beside the state", () => {
    expect(h.state.screen).toBe("title");
    expect(h.debug).toBeTruthy();
    expect(h.debug.snapshot(h.engine.state).screen).toBe("title");
  });

  it("initializes and draws even though no produced file could load", async () => {
    expect(h.state.sprites.body).toBeNull();
    await h.engine.advance(1);
    // The title's own copy is drawn in code, so the stage is not blank.
    const painted = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    let lit = 0;
    for (let i = 0; i < painted.length; i += 4) {
      if (painted[i]! + painted[i + 1]! + painted[i + 2]! > 90) lit += 1;
    }
    expect(lit).toBeGreaterThan(0);
  });

  it("refuses an engine without the layout it registers against", async () => {
    const { element } = canvasOf();
    const engine = createEngine<CoilState, CoilDebugApi>({
      canvas: element,
      width: STAGE_W,
      height: STAGE_H,
      game,
      clock: new ConstantClock(FRAME_MS),
      surface: surfaceOf(new EventTarget()),
    });
    await expect(engine.initialize()).rejects.toThrow(LAYOUT);
    engine.destroy();
  });
});

describe("the keyboard", () => {
  it("moves the title highlight and wraps it", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.state.menuIndex).toBe(1);
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.state.menuIndex).toBe(0);
  });

  it("consumes each press exactly once, however many frames follow it", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(20);
    expect(h.state.menuIndex).toBe(1);
  });

  it("raises nothing for an auto-repeat", async () => {
    h.tap("ArrowDown", true);
    await h.engine.advance(1);
    expect(h.state.menuIndex).toBe(0);
  });

  it("starts a round from the mode entry with either confirm key", async () => {
    h.tap("Space");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.snake.length).toBe(3);
    expect(h.state.pellet).not.toBeNull();
    expect(TITLE_ITEMS.length).toBeGreaterThan(1);
  });

  it("steers the snake with both key sets alike", async () => {
    for (const [code, dir] of [
      ["ArrowUp", "up"],
      ["KeyS", "down"],
    ] as const) {
      h.pose((state) => h.debug.setScreen(state, "playing"));
      h.pose((state) => h.debug.setDirection(state, "right"));
      h.pose((state) => h.debug.clearTurns(state));
      h.pose((state) => h.debug.setSnakeTravel(state, false));
      h.tap(code);
      await h.engine.advance(1);
      expect(h.state.turns).toEqual([dir]);
    }
  });

  it("pauses a live round with Escape and resumes it with KeyP", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("paused");
    h.tap("KeyP");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
  });

  it("toggles the engine's mute bit with KeyM, from any screen", async () => {
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(true);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(false);
  });
});

describe("the clock the engine owns", () => {
  it("resolves eight ticks in a second of game time", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) => h.debug.setSnakeTravel(state, false));
    await h.engine.advance(frames(1));
    expect(h.debug.snapshot(h.engine.state).ticks).toBe(8);
    expect(h.debug.snapshot(h.engine.state).simTime).toBeCloseTo(1, 6);
  });

  it("resolves no tick on a screen that is not playing", async () => {
    await h.engine.advance(frames(2));
    expect(h.debug.snapshot(h.engine.state).ticks).toBe(0);
    expect(h.debug.snapshot(h.engine.state).simTime).toBe(0);
  });

  it("advances the head one cell per tick", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) =>
      h.debug.setSnake(state, [
        { col: 10, row: 8 },
        { col: 9, row: 8 },
      ]),
    );
    h.pose((state) => h.debug.setDirection(state, "right"));
    h.pose((state) => h.debug.clearPellet(state));
    await h.engine.advance(frames(TICK_SECONDS));
    expect(h.debug.snapshot(h.engine.state).snake[0]).toEqual({
      col: 11,
      row: 8,
    });
  });
});

describe("the cue bus", () => {
  it("loops the music once a round is live", async () => {
    h.tap("Enter");
    await h.engine.advance(2);
    expect(h.loops).toContain(CUES.music);
  });

  it("plays the eat cue on the tick a pellet is eaten", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) => h.debug.setSnake(state, [{ col: 10, row: 8 }]));
    h.pose((state) => h.debug.setDirection(state, "right"));
    h.pose((state) => h.debug.setPellet(state, 11, 8));
    h.cues.length = 0;
    await h.engine.advance(frames(TICK_SECONDS));
    expect(h.cues.filter((cue) => cue === CUES.eat).length).toBe(1);
  });

  it("plays the death cue on the fatal tick", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) => h.debug.setSnake(state, [{ col: 28, row: 8 }]));
    h.pose((state) => h.debug.setDirection(state, "right"));
    h.pose((state) => h.debug.clearPellet(state));
    h.cues.length = 0;
    await h.engine.advance(frames(TICK_SECONDS));
    expect(h.cues).toEqual([CUES.death]);
    expect(h.state.screen).toBe("gameover");
  });
});

describe("drawing through the engine's context", () => {
  it("paints the board where a posed round put it", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) => h.debug.setSnakeTravel(state, false));
    h.pose((state) =>
      h.debug.setSnake(state, [
        { col: 14, row: 8 },
        { col: 13, row: 8 },
      ]),
    );
    h.pose((state) => h.debug.setPellet(state, 20, 4));
    await h.engine.advance(1);
    const field = h.pixel({ col: 24, row: 12 });
    expect(
      Math.hypot(
        ...(h.pixel({ col: 20, row: 4 }).map((v, i) => v - field[i]!) as [
          number,
          number,
          number,
        ]),
      ),
    ).toBeGreaterThan(50);
  });

  it("leaves the state exactly as update left it", async () => {
    h.pose((state) => h.debug.setScreen(state, "playing"));
    h.pose((state) => h.debug.setSnakeTravel(state, false));
    await h.engine.advance(1);
    const before = JSON.stringify(h.debug.snapshot(h.engine.state));
    game.render(h.engine.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
      frame: () => h.engine.frame(),
      viewport: () => h.engine.viewport(),
    });
    expect(JSON.stringify(h.debug.snapshot(h.engine.state))).toBe(before);
  });
});
