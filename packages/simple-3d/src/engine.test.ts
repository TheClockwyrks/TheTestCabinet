import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@test-cabinet/headless-webgl2";
import type { Canvas } from "@test-cabinet/headless-webgl2";
import {
  ConstantClock,
  RECORDING_FORMAT,
  SequenceClock,
  TOUCH_LAYOUTS,
  createEngine,
  projectPoint,
} from "./index";
import type {
  DeepReadonly,
  DrawOp,
  Engine,
  EngineOptions,
  Game,
  InitApi,
  Recording,
  RenderApi,
  SurfaceMetrics,
  UpdateApi,
} from "./index";

/**
 * Integration tests over the assembled engine — the wiring `createEngine`
 * performs, exercised the way a game and a validator actually meet it. Every
 * subsystem has its own suite beside it, so what is checked here is only what the
 * wiring decides: what runs when, in which order, with which arguments, what
 * refuses, and what the picture and the recording come out as.
 *
 * Everything is imported from `./index` rather than from the modules behind it,
 * deliberately: the entry point's export surface is part of what this suite
 * checks, and a type a game names that stopped being re-exported would fail here
 * rather than in a build a case ships.
 *
 * The environment is plain Node, exactly as the validator docs prescribe: the
 * canvas is `@test-cabinet/headless-webgl2`'s, so the engine renders for real and
 * a claim about the picture is a claim about pixels, and every measurement
 * arrives through an injected `SurfaceMetrics`. Two things are stood in for.
 * `requestAnimationFrame` becomes a queue the test drains by hand, because a loop
 * that re-arms itself would otherwise run for as long as the test process does.
 * And the overlay — which is inert in Node, where no 2D surface can be made — is
 * given one by grafting a minimal document onto the canvas, so the claims about
 * chrome staying out of the picture have something to observe.
 */

const DESIGN_W = 160;
const DESIGN_H = 120;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The rAF replacement: frames queue, and only a `tick` runs them. */
function fakeRaf(): { tick: (t: number) => void; pending: () => number } {
  const queued = new Map<number, (t: number) => void>();
  let next = 1;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void): number => {
    const handle = next++;
    queued.set(handle, cb);
    return handle;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (handle: number): void => {
    queued.delete(handle);
  };
  return {
    tick: (t) => {
      const due = [...queued.values()];
      queued.clear();
      for (const cb of due) cb(t);
    },
    pending: () => queued.size,
  };
}

/**
 * An event target that knows how many listeners are live on it.
 *
 * Counted by identity — type, handler, and capture flag — rather than by
 * counting calls, because teardown paths legitimately remove a listener that is
 * already gone and a call counter would read those as listeners going negative.
 */
function countingTarget(): EventTarget & { live(): number } {
  const target = new EventTarget();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  /** Every live registration, keyed the way the platform keys them. */
  const live = new Set<string>();
  const ids = new Map<unknown, number>();
  const key = (type: string, handler: unknown, options: unknown): string => {
    let id = ids.get(handler);
    if (id === undefined) {
      id = ids.size;
      ids.set(handler, id);
    }
    return `${type}:${String(options === true)}:${String(id)}`;
  };
  const counted = target as EventTarget & { live(): number };
  counted.addEventListener = (type, handler, options): void => {
    live.add(key(type, handler, options));
    add(type, handler, options);
  };
  counted.removeEventListener = (type, handler, options): void => {
    live.delete(key(type, handler, options));
    remove(type, handler, options);
  };
  counted.live = (): number => live.size;
  return counted;
}

/** A `KeyboardEvent`-shaped event, which is all the engine's listeners read. */
function keyEvent(
  type: "keydown" | "keyup",
  code: string,
  repeat = false,
): Event {
  return Object.assign(new Event(type), { code, repeat });
}

/** A `PointerEvent`-shaped event, which is all the engine's listeners read. */
function pointerEvent(type: string, x: number, y: number): Event {
  return Object.assign(new Event(type), {
    clientX: x,
    clientY: y,
    isPrimary: true,
  });
}

/**
 * A 2D context that records rather than draws, so the overlay's work is
 * observable without a canvas implementation behind it.
 *
 * `measureText` answers something proportional to the text, because the panel's
 * layout arithmetic asks and zero-width text would collapse it.
 */
function overlayContext(ops: string[]): CanvasRenderingContext2D {
  const stub = {
    canvas: null,
    fillStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    setTransform: () => ops.push("setTransform"),
    clearRect: () => ops.push("clearRect"),
    fillRect: () => ops.push("fillRect"),
    fillText: (text: string) => ops.push(`fillText:${text}`),
    measureText: (text: string) => ({ width: text.length * 6 }),
    beginPath: () => ops.push("beginPath"),
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => ops.push("stroke"),
    closePath: () => {},
  };
  return stub as unknown as CanvasRenderingContext2D;
}

/**
 * The headless canvas, optionally wearing just enough of a document for the
 * overlay to find a 2D surface.
 *
 * The engine's own rendering still goes to the real WebGL2 context underneath —
 * only `ownerDocument.createElement` is invented, and only so the overlay has
 * somewhere of its own to draw. That is the whole point of the claim being
 * tested: whatever the overlay does, it does not do it to the picture.
 */
function canvasFor(
  raw: Canvas,
  overlayOps: string[] | null,
): HTMLCanvasElement {
  if (overlayOps === null) return raw as unknown as HTMLCanvasElement;
  const context = overlayContext(overlayOps);
  const element = {
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: (kind: string): unknown => (kind === "2d" ? context : null),
    parentNode: null,
  };
  const grafted = {
    get width(): number {
      return raw.width;
    },
    set width(value: number) {
      raw.width = value;
    },
    get height(): number {
      return raw.height;
    },
    set height(value: number) {
      raw.height = value;
    },
    getContext: (id: string): unknown => raw.getContext(id as "webgl2"),
    ownerDocument: { createElement: (): unknown => element },
    parentNode: null,
    offsetLeft: 0,
    offsetTop: 0,
    clientWidth: 0,
    clientHeight: 0,
  };
  return grafted as unknown as HTMLCanvasElement;
}

/** The state every game below carries: a record of what its updates were handed. */
interface TestState {
  readonly dts: readonly number[];
  readonly updates: number;
}

/**
 * Anything a test wants to do at one of the three moments, with sane defaults.
 *
 * An `initialize` hook may return the debug surface the game should hand back
 * beside its state; one that returns nothing leaves the game with `null` there.
 * An `update` hook is handed the frame's NEXT state, already counted, and may
 * return a replacement for it.
 */
interface GameHooks {
  initialize?: (api: InitApi<TestState>, state: TestState) => unknown;
  update?: (
    state: TestState,
    api: UpdateApi,
    dt: number,
  ) => TestState | undefined | void;
  render?: (state: DeepReadonly<TestState>, api: RenderApi) => void;
}

/**
 * A game that records the calls it received and does whatever the test asked.
 *
 * Every frame returns a fresh state — the value style the contract is written for
 * — so a test holding the state `initialize` returned holds the opening one and
 * reads the current one off `engine.state`. `log` is the order the three
 * functions ran in, kept on the game because a render cannot write it.
 */
function testGame(
  hooks: GameHooks = {},
): Game<TestState, unknown> & { initializations: number; log: string[] } {
  const game = {
    initializations: 0,
    log: [] as string[],
    async initialize(api: InitApi<TestState>): Promise<[TestState, unknown]> {
      game.initializations += 1;
      const state: TestState = { dts: [], updates: 0 };
      // Only a real promise is awaited: `await` reads `.then` off whatever it is
      // handed, and a surface test may hand one that refuses every read.
      const returned = hooks.initialize?.(api, state);
      const debug =
        (returned instanceof Promise ? await returned : returned) ?? null;
      return [state, debug];
    },
    update(
      state: DeepReadonly<TestState>,
      api: UpdateApi,
      dt: number,
    ): TestState {
      const updates = state.updates + 1;
      game.log.push(`update:${updates}`);
      const next: TestState = { updates, dts: [...state.dts, dt] };
      return hooks.update?.(next, api, dt) ?? next;
    },
    render(state: DeepReadonly<TestState>, api: RenderApi): void {
      game.log.push(`render:${state.updates}`);
      hooks.render?.(state, api);
    },
  };
  return game;
}

interface Rig {
  engine: Engine<TestState, unknown>;
  /** The canvas underneath, for the backing-store figures a test reads back. */
  raw: Canvas;
  events: EventTarget & { live(): number };
  /** One pixel as RGBA bytes, addressed top-down in device coordinates. */
  pixel(x: number, y: number): number[];
  /** What the overlay drew on its own surface, in order. */
  overlayOps: string[];
}

const engines: Engine<unknown>[] = [];

/** Creates an engine the teardown disposes of, whatever the test does with it. */
function build({
  cssWidth = DESIGN_W,
  cssHeight = DESIGN_H,
  dpr = 1,
  overlay = false,
  ...options
}: Partial<EngineOptions<TestState>> & {
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
  overlay?: boolean;
} = {}): Rig {
  const raw = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const overlayOps: string[] = [];
  const events = countingTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  // Spread last, so a test that names a canvas, a size, or a surface of its own
  // gets exactly that one and the defaults stand for everything else.
  const engine = createEngine<TestState>({
    canvas: canvasFor(raw, overlay ? overlayOps : null),
    width: DESIGN_W,
    height: DESIGN_H,
    game: testGame(),
    clock: new ConstantClock(1000 / 60),
    surface,
    ...options,
  });
  engines.push(engine as Engine<unknown>);

  const gl = raw.getContext("webgl2") as unknown as WebGL2RenderingContext;
  return {
    engine,
    raw,
    events,
    overlayOps,
    pixel(x, y) {
      const out = new Uint8Array(4);
      gl.readPixels(
        x,
        raw.height - 1 - y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      return [...out];
    },
  };
}

let raf: { tick: (t: number) => void; pending: () => number };
let realRaf: typeof globalThis.requestAnimationFrame;
let realCancel: typeof globalThis.cancelAnimationFrame;

beforeEach(() => {
  realRaf = globalThis.requestAnimationFrame;
  realCancel = globalThis.cancelAnimationFrame;
  raf = fakeRaf();
});

afterEach(() => {
  for (const created of engines.splice(0)) created.destroy();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

describe("construction", () => {
  it("runs no game code at all", () => {
    const game = testGame();
    build({ game });
    expect(game.initializations).toBe(0);
    expect(game.log).toEqual([]);
  });

  it("refuses a design size that is not finite and positive, naming it", () => {
    for (const [width, height] of [
      [0, 120],
      [160, -1],
      [Number.NaN, 120],
      [160, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => build({ width, height })).toThrow(Error);
      expect(() => build({ width, height })).toThrow(
        new RegExp(`got ${String(width)}x${String(height)}`),
      );
    }
  });

  it("refuses a canvas that yields no WebGL2 context", () => {
    const canvas = {
      getContext: (): null => null,
    } as unknown as HTMLCanvasElement;
    expect(() => build({ canvas })).toThrow(/WebGL2/);
  });

  it("refuses a layout outside the catalogue, naming every valid one", () => {
    expect(() => build({ layout: "gamepad" })).toThrow(Error);
    for (const name of Object.keys(TOUCH_LAYOUTS)) {
      expect(() => build({ layout: "gamepad" })).toThrow(new RegExp(name));
    }
  });

  it("detaches the listeners it attached when a layout is refused", () => {
    const events = countingTarget();
    const surface: SurfaceMetrics = {
      cssWidth: () => DESIGN_W,
      cssHeight: () => DESIGN_H,
      dpr: () => 1,
      events: () => events,
    };
    expect(() => build({ layout: "gamepad", surface })).toThrow(Error);
    expect(events.live()).toBe(0);
  });

  it("accepts a layout from the catalogue and reports it to the game", async () => {
    let layout: { name: string; actions: string[] } | null = null;
    const game = testGame({
      initialize: (api) => {
        layout = api.input.layout();
      },
    });
    const { engine } = build({ game, layout: "stick-move" });
    await engine.initialize();
    expect(layout).toEqual(TOUCH_LAYOUTS["stick-move"]);
  });

  it("reports no layout to a game built without one", async () => {
    let layout: unknown = "unset";
    const game = testGame({
      initialize: (api) => {
        layout = api.input.layout();
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    expect(layout).toBeNull();
  });

  it("sizes the canvas and reports the fit before any frame has run", () => {
    const { engine, raw } = build({ cssWidth: 320, cssHeight: 240, dpr: 2 });
    expect(raw.width).toBe(640);
    expect(raw.height).toBe(480);
    expect(engine.viewport()).toEqual({
      width: DESIGN_W,
      height: DESIGN_H,
      scale: 4,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("hands out a viewport copy rather than the fit it keeps", () => {
    const { engine } = build();
    const first = engine.viewport();
    first.scale = 99;
    expect(engine.viewport().scale).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

describe("events", () => {
  it("is subscribable before the game has run, and sees the game's own loading fail", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const game = testGame({
      initialize: async (api) => {
        await api.assets.loadTexture("missing.png").catch(() => null);
      },
    });
    const { engine } = build({ game });

    const failed: Array<{ path: string; url: string; reason: string }> = [];
    engine.events.on("asset:failed", (event) => failed.push(event));

    await engine.initialize();
    expect(failed).toEqual([
      { path: "missing.png", url: "assets/missing.png", reason: "offline" },
    ]);
  });

  it("resolves asset paths under the configured root", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    let resolved = "";
    const game = testGame({
      initialize: (api) => {
        resolved = api.assets.resolve("models/ship.glb");
      },
    });
    const { engine } = build({ game, assetRoot: "media/" });
    await engine.initialize();
    expect(resolved).toBe("media/models/ship.glb");
  });

  it("defaults the asset root to assets/", async () => {
    let resolved = "";
    const game = testGame({
      initialize: (api) => {
        resolved = api.assets.resolve("models/ship.glb");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    expect(resolved).toBe("assets/models/ship.glb");
  });

  it("stamps a cue with the frame loop's simulated time, not the wall clock", async () => {
    const game = testGame({
      initialize: (api) => {
        api.audio.define("beep", { freq: 440, durationMs: 50 });
      },
      update: (_state, api) => {
        api.audio.play("beep");
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(16) });
    const played: number[] = [];
    engine.events.on("cue:played", ({ t }) => played.push(t));

    await engine.initialize();
    await engine.advance(3);
    expect(played).toEqual([16, 32, 48]);
  });

  it("unlocks the audio on the first gesture, once, and stops listening after it", () => {
    const { events } = build();
    const before = events.live();
    events.dispatchEvent(pointerEvent("pointerdown", 0, 0));
    events.dispatchEvent(pointerEvent("pointerdown", 1, 1));
    events.dispatchEvent(keyEvent("keydown", "Space"));
    // Both unlock listeners came off with the first gesture, and nothing else did.
    expect(events.live()).toBe(before - 2);
  });

  it("announces the unlock exactly once", () => {
    const { engine, events } = build();
    let unlocks = 0;
    engine.events.on("audio:unlocked", () => (unlocks += 1));
    events.dispatchEvent(pointerEvent("pointerdown", 0, 0));
    events.dispatchEvent(keyEvent("keydown", "Space"));
    expect(unlocks).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Initialize                                                                 */
/* -------------------------------------------------------------------------- */

describe("initialize", () => {
  it("runs the game's initialize and resolves to the state it built", async () => {
    const game = testGame();
    const { engine } = build({ game });
    const opening = await engine.initialize();
    expect(game.initializations).toBe(1);
    expect(opening).toEqual({ dts: [], updates: 0 });
    expect(engine.state).toEqual(opening);
  });

  it("is idempotent: a second call resolves to the state already built", async () => {
    const game = testGame();
    const { engine } = build({ game });
    const first = await engine.initialize();
    const second = await engine.initialize();
    expect(game.initializations).toBe(1);
    expect(second).toBe(first);
  });

  it("rejects with the game's own cause and leaves the engine uninitialized", async () => {
    const cause = new Error("the mesh is missing");
    const game = testGame({
      initialize: () => {
        throw cause;
      },
    });
    const { engine } = build({ game });
    await expect(engine.initialize()).rejects.toBe(cause);
    expect(() => engine.state).toThrow(/await engine.initialize\(\) first/);
  });

  it("refuses a game whose initialize returns anything but [state, debug]", async () => {
    const game = {
      initialize: (): [TestState, null] =>
        ({ dts: [], updates: 0 }) as unknown as [TestState, null],
      update: (state: DeepReadonly<TestState>): TestState => state as TestState,
      render: (): void => {},
    };
    const { engine } = build({ game });
    await expect(engine.initialize()).rejects.toThrow(/\[state, debug\]/);
  });

  it("hands the game a scoped API rather than the engine's own subsystems", async () => {
    let init: InitApi<TestState> | null = null;
    let update: UpdateApi | null = null;
    let render: RenderApi | null = null;
    const game = testGame({
      initialize: (api) => {
        init = api;
      },
      update: (_state, api) => {
        update = api;
      },
      render: (_state, api) => {
        render = api;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);

    expect(Object.keys(init ?? {}).sort()).toEqual([
      "assets",
      "audio",
      "diagnostics",
      "events",
      "input",
      "viewport",
    ]);
    expect(Object.keys((init as unknown as InitApi<TestState>).input)).toEqual([
      "register",
      "layout",
    ]);
    expect(Object.keys((update as unknown as UpdateApi).input)).toEqual([
      "value",
      "pressed",
      "pointer",
      "pointerPressed",
      "pointerReleased",
      "pointerSamples",
    ]);
    expect(Object.keys(render ?? {}).sort()).toEqual([
      "frame",
      "scene",
      "viewport",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The debug surface                                                          */
/* -------------------------------------------------------------------------- */

describe("the debug surface", () => {
  interface Surface {
    version: number;
    bump(state: DeepReadonly<TestState>): TestState;
  }

  const surfaceGame = (): Game<TestState, Surface> =>
    testGame({
      initialize: (): Surface => ({
        version: 2,
        bump: (state) => ({ ...state, updates: state.updates + 10 }),
      }),
    }) as unknown as Game<TestState, Surface>;

  it("hands back the value the game returned, unchanged", async () => {
    const { engine } = build({
      game: surfaceGame() as unknown as Game<TestState>,
    });
    await engine.initialize();
    expect((engine.debug as Surface).version).toBe(2);
    expect(engine.debug).toBe(engine.debug);
  });

  it("reads no member of the surface it holds", async () => {
    const reads: string[] = [];
    const spy = new Proxy(
      { version: 1 },
      {
        get(target, key): unknown {
          reads.push(String(key));
          return Reflect.get(target, key);
        },
      },
    );
    const game = testGame({ initialize: () => spy });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(2);
    expect(reads).toEqual([]);
  });

  it("refuses to be read before initialize resolves, naming the pair", () => {
    const { engine } = build();
    expect(() => engine.debug).toThrow(/\[state, debug\]/);
  });

  it("holds a null surface as the surface the game chose", async () => {
    const { engine } = build({ game: testGame() });
    await engine.initialize();
    expect(engine.debug).toBeNull();
  });

  it("is in place the moment initialize resolves, before any frame", async () => {
    const { engine } = build({
      game: surfaceGame() as unknown as Game<TestState>,
    });
    await engine.initialize();
    expect(engine.frame().count).toBe(0);
    expect((engine.debug as Surface).version).toBe(2);
  });

  it("drives a pose written as a transition over the state", async () => {
    const { engine } = build({
      game: surfaceGame() as unknown as Game<TestState>,
    });
    await engine.initialize();
    const posed = engine.apply((state) =>
      (engine.debug as Surface).bump(state),
    );
    expect(posed.updates).toBe(10);
    expect(engine.state.updates).toBe(10);
  });
});

/* -------------------------------------------------------------------------- */
/* State and apply                                                            */
/* -------------------------------------------------------------------------- */

describe("apply", () => {
  it("replaces the state with what the transition returns, and hands it back", async () => {
    const { engine } = build();
    await engine.initialize();
    const next = engine.apply((state) => ({ ...state, updates: 7 }));
    expect(next.updates).toBe(7);
    expect(engine.state.updates).toBe(7);
  });

  it("is what the next frame's update receives", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.apply((state) => ({ ...state, updates: 41 }));
    await engine.advance(1);
    expect(engine.state.updates).toBe(42);
  });

  it("refuses a transition that returns nothing, and holds the state it had", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.apply((state) => ({ ...state, updates: 3 }));
    expect(() => engine.apply(() => undefined as unknown as TestState)).toThrow(
      /must return the next state/,
    );
    expect(engine.state.updates).toBe(3);
  });

  it("refuses to be reached before initialize resolves, naming the ordering", () => {
    const { engine } = build();
    expect(() => engine.apply((state) => state as TestState)).toThrow(
      /await engine.initialize\(\) first/,
    );
  });
});

describe("the ordering rules", () => {
  it("refuses to read the state before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.state).toThrow(/engine.state was reached before/);
  });

  it("refuses to run before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.run()).toThrow(/engine.run was reached before/);
  });

  it("refuses to advance before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.advance(1)).toThrow(
      /engine.advance was reached before/,
    );
  });

  it("refuses to run while the game's initialize is still in flight", async () => {
    let release = (): void => {};
    const game = testGame({
      initialize: () =>
        new Promise<null>((resolve) => {
          release = (): void => resolve(null);
        }),
    });
    const { engine } = build({ game });
    const starting = engine.initialize();
    expect(() => engine.advance(1)).toThrow(/before/);
    release();
    await starting;
    await expect(engine.advance(1)).resolves.toBeUndefined();
  });

  it("rejects a frame count that is not a whole, non-negative number, naming it", async () => {
    const { engine } = build();
    await engine.initialize();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => engine.advance(bad)).toThrow(RangeError);
      expect(() => engine.advance(bad)).toThrow(
        new RegExp(`got ${String(bad)}`),
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Advance                                                                    */
/* -------------------------------------------------------------------------- */

describe("advance", () => {
  it("runs update then render once per frame, with dt in seconds", async () => {
    const game = testGame();
    const { engine } = build({ game, clock: new ConstantClock(1000 / 60) });
    await engine.initialize();
    await engine.advance(3);
    expect(game.log).toEqual([
      "update:1",
      "render:1",
      "update:2",
      "render:2",
      "update:3",
      "render:3",
    ]);
    expect(engine.state.dts).toEqual([1 / 60, 1 / 60, 1 / 60]);
  });

  it("hands each frame the state the previous one returned, and exposes the latest", async () => {
    const { engine } = build();
    await engine.initialize();
    await engine.advance(4);
    expect(engine.state.updates).toBe(4);
    const held = engine.state;
    await engine.advance(1);
    // The state is a value: the view taken before the frame is not the one after.
    expect(held.updates).toBe(4);
    expect(engine.state.updates).toBe(5);
  });

  it("refuses an update that returns nothing, and holds the state it had", async () => {
    // Written out rather than hooked: `testGame` fills an absent return in for
    // the caller, and the whole point here is the game that returns nothing.
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      update: (): TestState => undefined as unknown as TestState,
      render: (): void => {},
    };
    const { engine } = build({ game });
    await engine.initialize();
    await expect(engine.advance(1)).rejects.toThrow(
      /must return the next state/,
    );
    expect(engine.state.updates).toBe(0);
  });

  it("runs nothing for a count of zero", async () => {
    const game = testGame();
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(0);
    expect(game.log).toEqual([]);
    expect(engine.frame().count).toBe(0);
  });

  it("takes each frame's delta from the clock in force", async () => {
    const { engine } = build({ clock: new SequenceClock([10, 20, 30]) });
    await engine.initialize();
    await engine.advance(3);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 60, lastDeltaMs: 30 });
  });

  it("carries the counter and the simulated time over a clock replaced mid-run", async () => {
    const { engine } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(2);
    engine.setClock(new ConstantClock(100));
    await engine.advance(1);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 120, lastDeltaMs: 100 });
  });

  it("rejects with the game's cause and abandons the frames after it", async () => {
    const cause = new Error("bad frame");
    const game = testGame({
      update: (state) => {
        if (state.updates === 2) throw cause;
        return state;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await expect(engine.advance(5)).rejects.toBe(cause);
    expect(engine.frame().count).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* The frame's own work                                                       */
/* -------------------------------------------------------------------------- */

describe("the frame's own work", () => {
  it("renders what the game drew, letterboxing the picture onto the device", async () => {
    const game = testGame({
      render: (_state, api) => {
        api.scene.setMode("unlit");
        api.scene.drawGeometry(
          api.scene.createBox({ x: 8, y: 8, z: 1 }),
          "#ff8040",
          {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        );
      },
    });
    // Wider than the design aspect, so there are bars to find on the sides.
    const rig = build({
      game,
      background: "#101820",
      cssWidth: 240,
      cssHeight: 120,
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);

    expect(rig.pixel(120, 60)).toEqual([255, 128, 64, 255]);
    expect(rig.pixel(2, 60)).toEqual([16, 24, 32, 255]);
    expect(rig.pixel(238, 60)).toEqual([16, 24, 32, 255]);
  });

  it("puts a projected world point where projectPoint says it will", async () => {
    const rig = build({
      game: testGame({
        render: (_state, api) => {
          api.scene.setMode("unlit");
          api.scene.drawGeometry(
            api.scene.createBox({ x: 1, y: 1, z: 1 }),
            "#00ff00",
            {
              position: { x: 2, y: 1, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
          );
        },
      }),
      background: "#000000",
    });
    await rig.engine.initialize();
    await rig.engine.advance(1);

    const viewport = rig.engine.viewport();
    const point = projectPoint(
      {
        position: { x: 0, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: Math.PI / 3,
        near: 0.1,
        far: 1000,
      },
      viewport,
      { x: 2, y: 1, z: 0 },
    );
    expect(point).not.toBeNull();
    const device = point as { x: number; y: number };
    expect(rig.pixel(Math.round(device.x), Math.round(device.y))).toEqual([
      0, 255, 0, 255,
    ]);
  });

  it("clears to transparency when the build named no background", async () => {
    const rig = build({ game: testGame() });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(rig.pixel(80, 60)).toEqual([0, 0, 0, 0]);
  });

  it("resyncs the canvas every frame, so a resize needs no handler", async () => {
    let cssWidth = 160;
    const events = countingTarget();
    const surface: SurfaceMetrics = {
      cssWidth: () => cssWidth,
      cssHeight: () => 120,
      dpr: () => 1,
      events: () => events,
    };
    const rig = build({ surface });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(rig.raw.width).toBe(160);

    cssWidth = 320;
    await rig.engine.advance(1);
    expect(rig.raw.width).toBe(320);
    expect(rig.engine.viewport().scale).toBe(1);
    expect(rig.engine.viewport().offsetX).toBe(80);
  });

  it("consumes an input edge exactly once, in the frame it belongs to", async () => {
    const presses: boolean[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("jump", { keys: ["Space"] });
      },
      update: (_state, api) => {
        presses.push(api.input.pressed("jump"));
      },
    });
    const rig = build({ game });
    await rig.engine.initialize();

    rig.events.dispatchEvent(keyEvent("keydown", "Space"));
    await rig.engine.advance(2);
    expect(presses).toEqual([true, false]);
  });

  it("closes the input frame after the render, so an unpolled edge does not surface later", async () => {
    const values: number[] = [];
    const presses: boolean[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("jump", { keys: ["Space"] });
      },
      update: (state, api) => {
        // The first frame reads the value alone, leaving the edge unconsumed.
        if (state.updates === 1) values.push(api.input.value("jump"));
        else presses.push(api.input.pressed("jump"));
      },
    });
    const rig = build({ game });
    await rig.engine.initialize();

    rig.events.dispatchEvent(keyEvent("keydown", "Space"));
    await rig.engine.advance(2);
    expect(values).toEqual([1]);
    expect(presses).toEqual([false]);
  });

  it("keeps a held key reading as a value for as long as it is down", async () => {
    const values: number[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("thrust", { keys: ["KeyW"] });
      },
      update: (_state, api) => {
        values.push(api.input.value("thrust"));
      },
    });
    const rig = build({ game });
    await rig.engine.initialize();

    rig.events.dispatchEvent(keyEvent("keydown", "KeyW"));
    await rig.engine.advance(2);
    rig.events.dispatchEvent(keyEvent("keyup", "KeyW"));
    await rig.engine.advance(1);
    expect(values).toEqual([1, 1, 0]);
  });

  it("maps the pointer into the game's own logical coordinates", async () => {
    const seen: Array<{ x: number; y: number; down: boolean }> = [];
    const game = testGame({
      update: (_state, api) => {
        seen.push(api.input.pointer());
      },
    });
    const rig = build({ game, cssWidth: 320, cssHeight: 240, dpr: 2 });
    await rig.engine.initialize();

    rig.events.dispatchEvent(pointerEvent("pointerdown", 160, 120));
    await rig.engine.advance(1);
    expect(seen).toEqual([{ x: 80, y: 60, down: true }]);
  });

  it("refuses a scene call from update, naming the rule", async () => {
    let held: RenderApi | null = null;
    const game = testGame({
      render: (_state, api) => {
        held = api;
      },
      update: (state) => state,
    });
    const rig = build({ game });
    await rig.engine.initialize();
    await rig.engine.advance(1);
    expect(() =>
      (held as unknown as RenderApi).scene.drawHudRect(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        "#fff",
      ),
    ).toThrow(/render/);
  });
});

/* -------------------------------------------------------------------------- */
/* The overlay                                                                */
/* -------------------------------------------------------------------------- */

describe("the diagnostics overlay", () => {
  it("is inert where no 2D surface can be made, and the frames still run", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("updates", (state) => state.updates);
      },
    });
    const rig = build({ game });
    await rig.engine.initialize();
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));
    await rig.engine.advance(2);
    expect(rig.engine.frame().count).toBe(2);
  });

  it("draws on its own surface once the toggle key switches it on", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("updates", (state) => state.updates);
      },
    });
    const rig = build({ game, overlay: true });
    await rig.engine.initialize();

    await rig.engine.advance(1);
    expect(rig.overlayOps.filter((op) => op.startsWith("fillText:"))).toEqual(
      [],
    );

    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));
    await rig.engine.advance(1);
    expect(rig.overlayOps).toContain("fillText:updates: 2");
  });

  it("hands each diagnostic source the state current at the read", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("updates", (state) => state.updates);
      },
    });
    const rig = build({ game, overlay: true });
    await rig.engine.initialize();
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));

    await rig.engine.advance(3);
    const lines = rig.overlayOps.filter((op) =>
      op.startsWith("fillText:updates:"),
    );
    expect(lines).toEqual([
      "fillText:updates: 1",
      "fillText:updates: 2",
      "fillText:updates: 3",
    ]);
  });

  it("ignores an auto-repeat of the overlay key, so holding it does not strobe", async () => {
    const rig = build({ overlay: true });
    await rig.engine.initialize();
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote", true));
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote", true));
    // Two frames, because the first frame's own sample is recorded after the
    // overlay has drawn, so the metrics line has nothing to report until the
    // second.
    await rig.engine.advance(2);
    // Still on: the repeats toggled nothing.
    expect(rig.overlayOps.some((op) => op.startsWith("fillText:frame:"))).toBe(
      true,
    );
  });

  it("never draws into the picture the game rendered", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("updates", (state) => state.updates);
      },
      render: (_state, api) => {
        api.scene.setMode("unlit");
        api.scene.drawGeometry(
          api.scene.createBox({ x: 40, y: 40, z: 1 }),
          "#00ff00",
          {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        );
      },
    });
    const rig = build({ game, overlay: true, background: "#000000" });
    await rig.engine.initialize();
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));
    await rig.engine.advance(1);

    // The panel drew — and every pixel of the frame is still the game's.
    expect(rig.overlayOps.length).toBeGreaterThan(0);
    expect(rig.pixel(80, 60)).toEqual([0, 255, 0, 255]);
    expect(rig.pixel(4, 4)).toEqual([0, 255, 0, 255]);
  });
});

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

describe("run", () => {
  it("drives one frame per host callback and resolves when the signal aborts", async () => {
    const game = testGame();
    const { engine } = build({ game });
    await engine.initialize();

    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    raf.tick(16);
    raf.tick(32);
    expect(
      game.log.filter((entry) => entry.startsWith("update:")),
    ).toHaveLength(2);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("resolves immediately for a signal that has already aborted", async () => {
    const { engine } = build();
    await engine.initialize();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.run({ signal: controller.signal }),
    ).resolves.toBeUndefined();
  });

  it("waits on the same halt when called again rather than starting a second loop", async () => {
    const game = testGame();
    const { engine } = build({ game });
    await engine.initialize();

    const controller = new AbortController();
    const first = engine.run({ signal: controller.signal });
    const second = engine.run();
    raf.tick(16);
    expect(
      game.log.filter((entry) => entry.startsWith("update:")),
    ).toHaveLength(1);

    controller.abort();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("keeps the loop alive when a frame throws, so one bad frame is not fatal", async () => {
    let frames = 0;
    const game = testGame({
      update: (state) => {
        frames += 1;
        if (frames === 1) throw new Error("one bad frame");
        return state;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    expect(() => raf.tick(16)).toThrow(/one bad frame/);
    raf.tick(32);
    expect(engine.frame().count).toBe(2);

    controller.abort();
    await running;
  });

  it("leaves the engine usable after an abort", async () => {
    const { engine } = build();
    await engine.initialize();
    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    raf.tick(16);
    controller.abort();
    await running;

    await engine.advance(2);
    expect(engine.frame().count).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Destroy                                                                    */
/* -------------------------------------------------------------------------- */

describe("destroy", () => {
  it("halts the loop and resolves the promise run returned", async () => {
    const { engine } = build();
    await engine.initialize();
    const running = engine.run();
    engine.destroy();
    await expect(running).resolves.toBeUndefined();
    expect(raf.pending()).toBe(0);
  });

  it("is idempotent, because teardown races", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
  });

  it("detaches every listener it attached", async () => {
    const rig = build();
    await rig.engine.initialize();
    expect(rig.events.live()).toBeGreaterThan(0);
    rig.engine.destroy();
    expect(rig.events.live()).toBe(0);
  });

  it("drops every subscription, so a stale handler cannot observe a successor", async () => {
    const game = testGame({
      initialize: (api) => {
        api.audio.define("beep", { freq: 440, durationMs: 40 });
      },
      update: (_state, api) => {
        api.audio.play("beep");
      },
    });
    const { engine } = build({ game });
    let heard = 0;
    engine.events.on("cue:played", () => (heard += 1));
    await engine.initialize();
    await engine.advance(1);
    expect(heard).toBe(1);

    engine.destroy();
    const second = build({ game: testGame() });
    await second.engine.initialize();
    await second.engine.advance(1);
    expect(heard).toBe(1);
  });

  it("stops every loop, so a cue cannot outlive the engine that started it", async () => {
    const game = testGame({
      initialize: (api) => {
        api.audio.define("hum", { freq: 220, durationMs: 40 });
      },
      update: (_state, api) => {
        api.audio.loop("hum");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);
    const looping: string[] = [];
    engine.events.on("cue:stopped", ({ cue }) => looping.push(cue));

    engine.destroy();
    // Silencing announces nothing — the subscriptions go with it — so what is
    // checked is that the destroy did not leave the loop running.
    expect(looping).toEqual([]);
  });

  it("runs and advances nothing once destroyed, rather than failing a teardown race", async () => {
    const game = testGame();
    const { engine } = build({ game });
    await engine.initialize();
    engine.destroy();
    await expect(engine.advance(3)).resolves.toBeUndefined();
    await expect(engine.run()).resolves.toBeUndefined();
    expect(game.log).toEqual([]);
  });

  it("closes the scene context for good, so a stored render api draws nothing after teardown", async () => {
    let held: RenderApi | null = null;
    const game = testGame({
      render: (_state, api) => {
        held = api;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);
    engine.destroy();
    expect(() =>
      (held as unknown as RenderApi).scene.drawHudRect(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        "#fff",
      ),
    ).toThrow(Error);
  });
});

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/** The op behind one of a frame's indices, as a `call`. */
function callAt(
  recording: Recording,
  frame: number,
  index: number,
): DrawOp | undefined {
  const at = recording.frames[frame]?.ops[index];
  return at === undefined ? undefined : recording.ops[at];
}

describe("draw-command recording", () => {
  const drawingGame = (): Game<TestState, unknown> =>
    testGame({
      render: (state, api) => {
        api.scene.drawHudText(`f${state.updates}`, { x: 4, y: 4 });
      },
    });

  it("records nothing until it is armed", async () => {
    const { engine } = build({ game: drawingGame() });
    await engine.initialize();
    expect(engine.recording()).toBe(false);
    await engine.advance(2);

    engine.startRecording();
    expect(engine.recording()).toBe(true);
    const recording = engine.stopRecording();
    expect(recording.frames).toEqual([]);
    expect(engine.recording()).toBe(false);
  });

  it("captures one frame per advanced frame, with the clock's own figures", async () => {
    const { engine } = build({
      game: drawingGame(),
      clock: new ConstantClock(20),
    });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(3);
    const recording = engine.stopRecording();

    expect(recording.frames).toHaveLength(3);
    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(recording.frames.map((frame) => frame.timeMs)).toEqual([20, 40, 60]);
    expect(recording.frames.map((frame) => frame.deltaMs)).toEqual([
      20, 20, 20,
    ]);
  });

  it("records what the game drew, in issue order", async () => {
    const { engine } = build({ game: drawingGame() });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(callAt(recording, 0, 0)).toEqual({
      op: "call",
      method: "drawHudText",
      args: ["f1", { x: 4, y: 4 }],
    });
  });

  it("carries the format, the space, and the design figures fixed at arm time", async () => {
    const { engine } = build({ game: drawingGame(), background: "#101820" });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.space).toBe("3d");
    expect(recording.width).toBe(DESIGN_W);
    expect(recording.height).toBe(DESIGN_H);
    expect(recording.background).toBe("#101820");
    expect(recording.frames[0]?.surface).toEqual({
      width: DESIGN_W,
      height: DESIGN_H,
    });
  });

  it("reports a null background for a build that named none", async () => {
    const { engine } = build({ game: drawingGame() });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    expect(engine.stopRecording().background).toBeNull();
  });

  it("records only the frames between arming and disarming", async () => {
    const { engine } = build({ game: drawingGame() });
    await engine.initialize();
    await engine.advance(2);
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();
    await engine.advance(2);

    expect(recording.frames.map((frame) => frame.count)).toEqual([3, 4]);
  });

  it("keeps the diagnostics overlay out of the recording", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("updates", (state) => state.updates);
      },
      render: (_state, api) => {
        api.scene.drawHudRect({ x: 0, y: 0 }, { x: 8, y: 8 }, "#ffffff");
      },
    });
    const rig = build({ game, overlay: true });
    await rig.engine.initialize();
    rig.events.dispatchEvent(keyEvent("keydown", "Backquote"));
    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();

    expect(rig.overlayOps.length).toBeGreaterThan(0);
    expect(recording.frames[0]?.ops).toHaveLength(1);
    expect(callAt(recording, 0, 0)).toMatchObject({ method: "drawHudRect" });
  });

  it("shares one resource between frames that produced it with the same arguments", async () => {
    const game = testGame({
      render: (_state, api) => {
        api.scene.drawGeometry(api.scene.createSphere(2), "#ffffff", {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        });
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(3);
    const recording = engine.stopRecording();

    expect(recording.resources).toHaveLength(1);
    expect(recording.resources[0]?.make.method).toBe("createSphere");
  });

  it("refuses an unbalanced arm or disarm, naming the call", async () => {
    const { engine } = build({ game: drawingGame() });
    await engine.initialize();
    expect(() => engine.stopRecording()).toThrow(/stopRecording/);
    engine.startRecording();
    expect(() => engine.startRecording()).toThrow(/startRecording/);
    engine.stopRecording();
  });
});
