import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstantClock, SequenceClock } from "./clocks";
import type {
  Engine,
  EngineOptions,
  Game,
  InitApi,
  RenderApi,
  SurfaceMetrics,
  UpdateApi,
} from "./contract";
import type { EngineHost } from "./host";
import { HOST_HANDLE, HOST_VERSION } from "./host";
import { createEngine } from "./index";

/**
 * Integration tests over the assembled engine — the wiring `createEngine` performs,
 * exercised the way a game and a validator actually meet it. The subsystems have
 * their own suites beside them, so what is checked here is only what the wiring
 * decides: what runs when, in which order, with which arguments, and what refuses.
 *
 * jsdom gives a document, events and an element tree but neither a canvas
 * implementation nor layout, so two things are stood in for: the 2D context (a stub
 * that records each operation *and the transform in force when it happened*, which
 * is how the ordering claims below are checked) and the element's laid-out size.
 * `requestAnimationFrame` is replaced by a queue the test drains by hand, because a
 * loop that re-arms itself would otherwise run for as long as the test process does.
 */

/** One recorded context operation, with the transform and fill in force for it. */
interface RecordedOp {
  op: string;
  transform: readonly number[];
  fill: string;
}

interface ContextStub {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  names(): string[];
}

/**
 * A 2D context that records rather than draws.
 *
 * It answers `measureText` with something proportional to the text so the overlay's
 * layout arithmetic has real numbers to work with, and it keeps `save`/`restore` in
 * the log so a subsystem that leaks state can be caught.
 */
function contextStub(canvas: HTMLCanvasElement): ContextStub {
  let transform: readonly number[] = [1, 0, 0, 1, 0, 0];
  const ops: RecordedOp[] = [];
  const stub = {
    canvas,
    fillStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      transform = [a, b, c, d, e, f];
      ops.push({ op: "setTransform", transform, fill: stub.fillStyle });
    },
    clearRect(): void {
      ops.push({ op: "clearRect", transform, fill: stub.fillStyle });
    },
    fillRect(): void {
      ops.push({ op: "fillRect", transform, fill: stub.fillStyle });
    },
    fillText(): void {
      ops.push({ op: "fillText", transform, fill: stub.fillStyle });
    },
    measureText(text: string): { width: number } {
      return { width: text.length * 7 };
    },
    save(): void {
      ops.push({ op: "save", transform, fill: stub.fillStyle });
    },
    restore(): void {
      ops.push({ op: "restore", transform, fill: stub.fillStyle });
    },
  };
  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    ops,
    names: () => ops.map((entry) => entry.op),
  };
}

/**
 * A canvas with a pretended laid-out size, since jsdom performs no layout and every
 * element it produces reports a client size of zero — which the viewport correctly
 * fits to a scale of zero, and which would make every assertion here vacuous.
 */
function mount(cssW = 800, cssH = 600): { canvas: HTMLCanvasElement; stub: ContextStub } {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: cssW, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: cssH, configurable: true });
  document.body.append(canvas);
  const stub = contextStub(canvas);
  canvas.getContext = (() => stub.ctx) as unknown as HTMLCanvasElement["getContext"];
  return { canvas, stub };
}

/** A canvas whose context cannot be had — the failure `createEngine` refuses. */
function contextlessCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  return canvas;
}

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

/** The host interface as a driver finds it, or `undefined` when none is installed. */
function installedHost(): EngineHost | undefined {
  const view = window as unknown as Record<string, unknown>;
  return view[HOST_HANDLE] as EngineHost | undefined;
}

/** The state every game below carries: a record of what its frames were handed. */
interface TestState {
  readonly dts: number[];
  readonly order: string[];
  updates: number;
  renders: number;
}

/** Anything a test wants to do at one of the three moments, with sane defaults. */
interface GameHooks {
  initialize?: (api: InitApi, state: TestState) => void | Promise<void>;
  update?: (state: TestState, api: UpdateApi, dt: number) => void;
  render?: (state: TestState, api: RenderApi) => void;
}

/** A game that records the calls it received and does whatever the test asked. */
function testGame(hooks: GameHooks = {}): Game<TestState> & { initializations: number } {
  const game = {
    initializations: 0,
    async initialize(api: InitApi): Promise<TestState> {
      game.initializations += 1;
      const state: TestState = { dts: [], order: [], updates: 0, renders: 0 };
      await hooks.initialize?.(api, state);
      return state;
    },
    update(state: TestState, api: UpdateApi, dt: number): void {
      state.updates += 1;
      state.dts.push(dt);
      state.order.push(`update:${state.updates}`);
      hooks.update?.(state, api, dt);
    },
    render(state: TestState, api: RenderApi): void {
      state.renders += 1;
      state.order.push(`render:${state.renders}`);
      hooks.render?.(state, api);
    },
  };
  return game;
}

const engines: Engine<unknown>[] = [];

/** Creates an engine the teardown disposes of, whatever the test does with it. */
function build(
  options: Partial<EngineOptions<TestState>> = {},
): { engine: Engine<TestState>; stub: ContextStub; canvas: HTMLCanvasElement } {
  const { canvas, stub } = mount();
  const created = createEngine<TestState>({
    canvas,
    width: 400,
    height: 200,
    game: options.game ?? testGame(),
    clock: options.clock ?? new ConstantClock(1000 / 60),
    ...options,
  });
  engines.push(created as Engine<unknown>);
  return { engine: created, stub, canvas };
}

let raf: { tick: (t: number) => void; pending: () => number };
let realRaf: typeof globalThis.requestAnimationFrame;
let realCancel: typeof globalThis.cancelAnimationFrame;

beforeEach(() => {
  realRaf = globalThis.requestAnimationFrame;
  realCancel = globalThis.cancelAnimationFrame;
  raf = fakeRaf();
  // A ratio of 2 rather than 1, so a bug that drops the device pixel ratio shows up
  // as a wrong number instead of the right one by coincidence.
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
});

afterEach(() => {
  for (const created of engines.splice(0)) created.destroy();
  document.body.replaceChildren();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
  vi.restoreAllMocks();
});

describe("construction", () => {
  it("runs no game code at all", () => {
    const game = testGame();
    build({ game });

    expect(game.initializations).toBe(0);
  });

  it("refuses a design size that is not finite and positive, naming it", () => {
    const { canvas } = mount();
    const game = testGame();
    for (const [width, height] of [
      [0, 200],
      [400, 0],
      [-400, 200],
      [400, Number.NaN],
      [Number.POSITIVE_INFINITY, 200],
    ] as const) {
      expect(() => createEngine({ canvas, width, height, game })).toThrow(
        new RegExp(`${String(width)}x${String(height)}`),
      );
    }
    expect(game.initializations).toBe(0);
  });

  it("refuses a canvas that yields no 2D context", () => {
    expect(() =>
      createEngine({ canvas: contextlessCanvas(), width: 400, height: 200, game: testGame() }),
    ).toThrow(/2D context/);
  });

  it("refuses a layout outside the catalogue, naming every valid one", () => {
    const { canvas } = mount();
    expect(() =>
      createEngine({ canvas, width: 400, height: 200, game: testGame(), layout: "nope" }),
    ).toThrow(/dpad-4-two-buttons/);
  });

  it("detaches the listeners it attached when a layout is refused", () => {
    // A refused build returns no engine, so nothing can be destroyed afterwards: the
    // only thing that can undo the input registry's listeners is `createEngine`
    // itself. Counting the pair is how a leak here is caught.
    const target = new EventTarget();
    const added = vi.spyOn(target, "addEventListener");
    const removed = vi.spyOn(target, "removeEventListener");
    const { canvas } = mount();

    expect(() =>
      createEngine({
        canvas,
        width: 400,
        height: 200,
        game: testGame(),
        layout: "not-a-layout",
        surface: fixedSurface(target),
      }),
    ).toThrow(/not-a-layout/);

    const types = (spy: typeof added): string[] =>
      [...spy.mock.calls.map((call) => String(call[0]))].sort();
    expect(types(added)).toEqual(["keydown", "keyup"]);
    expect(types(removed)).toEqual(types(added));
  });

  it("accepts a layout from the catalogue and reports it to the game", async () => {
    let seen: string | null = null;
    const game = testGame({
      initialize: (api) => {
        seen = api.input.layout()?.name ?? null;
      },
    });
    const { engine } = build({ game, layout: "dpad-4-two-buttons" });
    await engine.initialize();

    expect(seen).toBe("dpad-4-two-buttons");
  });

  it("publishes the host interface at the documented handle", () => {
    const { engine } = build();

    const host = installedHost();
    expect(host?.version).toBe(HOST_VERSION);
    expect(HOST_HANDLE).toBe("__tcabEngine");

    engine.destroy();
    expect(installedHost()).toBeUndefined();
  });

  it("sizes the canvas and reports the fit before any frame has run", () => {
    const { engine, canvas } = build();

    // 800x600 CSS at a ratio of 2 is a 1600x1200 backing store; a 400x200 field fits
    // it at 2 CSS pixels per unit, so 4 device pixels, with the spare height split.
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(engine.viewport()).toEqual({
      width: 400,
      height: 200,
      scale: 4,
      offsetX: 0,
      offsetY: 200,
    });
  });

  it("hands out a viewport copy rather than the fit it keeps", () => {
    const { engine } = build();
    const first = engine.viewport();
    first.scale = 999;

    expect(engine.viewport().scale).toBe(4);
  });
});

/** A surface reporting fixed figures over a caller-supplied event target. */
function fixedSurface(target: EventTarget, cssW = 800, cssH = 600, dpr = 2): SurfaceMetrics {
  return {
    cssWidth: (): number => cssW,
    cssHeight: (): number => cssH,
    dpr: (): number => dpr,
    events: (): EventTarget => target,
  };
}

describe("events", () => {
  it("is subscribable before the game has run, and sees the game's own loading fail", async () => {
    // The whole reason construction runs no game code: a caller subscribes first and
    // observes initialization as it happens rather than inferring it afterwards.
    const game = testGame({
      initialize: async (api) => {
        await expect(api.assets.load("/etc/passwd")).rejects.toThrow(/escapes the asset root/);
      },
    });
    const { engine } = build({ game });

    const failures: { path: string; url: string; reason: string }[] = [];
    engine.events.on("asset:failed", (payload) => failures.push(payload));

    await engine.initialize();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe("/etc/passwd");
    // A refused path never resolved to a URL, and the empty string is the signature
    // of a refusal rather than of a file that resolved and did not arrive.
    expect(failures[0]?.url).toBe("");
  });

  it("resolves asset paths under the configured root", async () => {
    let resolved = "";
    const game = testGame({
      initialize: (api) => {
        resolved = api.assets.resolve("sprites/ball.png");
      },
    });
    const { engine } = build({ game, assetRoot: "media" });
    await engine.initialize();

    expect(resolved).toBe("media/sprites/ball.png");
  });

  it("defaults the asset root to assets/", async () => {
    let resolved = "";
    const game = testGame({
      initialize: (api) => {
        resolved = api.assets.resolve("ball.png");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    expect(resolved).toBe("assets/ball.png");
  });

  it("stamps a cue with the frame loop's simulated time, not the wall clock", async () => {
    const game = testGame({
      initialize: (api) => {
        api.audio.define("blip", { freq: 440, durationMs: 20 });
      },
      update: (state, api) => {
        if (state.updates === 3) api.audio.play("blip");
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20) });

    const played: { cue: string; t: number; gain: number }[] = [];
    engine.events.on("cue:played", (payload) => played.push(payload));

    await engine.initialize();
    await engine.advance(4);

    expect(played).toHaveLength(1);
    // The third frame's update runs after that frame's delta has been accumulated,
    // so the cue belongs to simulated time 60 — which is what `frame().timeMs` said
    // at that moment.
    expect(played[0]?.t).toBe(60);
  });

  it("unlocks the audio context on the first gesture, once, and stops listening", () => {
    const target = new EventTarget();
    const { engine } = build({ surface: fixedSurface(target) });

    let unlocks = 0;
    engine.events.on("audio:unlocked", () => {
      unlocks += 1;
    });

    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }));

    expect(unlocks).toBe(1);
  });
});

describe("initialize", () => {
  it("runs the game's initialize and resolves to the state it built", async () => {
    const game = testGame();
    const { engine } = build({ game });

    const state = await engine.initialize();

    expect(game.initializations).toBe(1);
    expect(state).toEqual({ dts: [], order: [], updates: 0, renders: 0 });
    // The engine exposes the game's own value, live, rather than a copy of it.
    expect(engine.state).toBe(state);
  });

  it("is idempotent: a second call resolves to the state already built", async () => {
    const game = testGame();
    const { engine } = build({ game });

    const [first, second] = await Promise.all([engine.initialize(), engine.initialize()]);
    const third = await engine.initialize();

    expect(game.initializations).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("rejects with the game's own cause and leaves the engine uninitialized", async () => {
    const cause = new Error("no save file");
    const game: Game<TestState> = {
      initialize: (): Promise<TestState> => Promise.reject(cause),
      update: (): void => {},
      render: (): void => {},
    };
    const { engine } = build({ game });

    await expect(engine.initialize()).rejects.toBe(cause);
    expect(() => engine.state).toThrow(/initialize/);
  });

  it("hands the game a scoped API rather than the engine's own subsystems", async () => {
    let api: InitApi | undefined;
    const game = testGame({
      initialize: (given) => {
        api = given;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    expect([...Object.keys(api?.input ?? {})].sort()).toEqual(["layout", "register"]);
    expect([...Object.keys(api?.audio ?? {})].sort()).toEqual(["define", "load"]);
    expect(Object.keys(api?.diagnostics ?? {})).toEqual(["register"]);
  });
});

describe("the ordering rules", () => {
  it("refuses to read the state before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.state).toThrow(/initialize/);
  });

  it("refuses to run before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.run()).toThrow(/initialize/);
  });

  it("refuses to advance before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.advance(1)).toThrow(/initialize/);
  });

  it("refuses to run while the game's initialize is still in flight", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const game = testGame({ initialize: () => gate });
    const { engine } = build({ game });

    const starting = engine.initialize();
    expect(() => engine.advance(1)).toThrow(/initialize/);

    release();
    await starting;
    await expect(engine.advance(1)).resolves.toBeUndefined();
  });

  it("rejects a frame count that is not a whole, non-negative number, naming it", async () => {
    const { engine } = build();
    await engine.initialize();

    for (const frames of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => engine.advance(frames)).toThrow(RangeError);
      expect(() => engine.advance(frames)).toThrow(new RegExp(String(frames)));
    }
    expect(engine.frame().count).toBe(0);
  });
});

describe("advance", () => {
  it("runs update then render once per frame, with dt in seconds", async () => {
    const game = testGame();
    const { engine } = build({ game, clock: new ConstantClock(1000 / 60) });
    const state = await engine.initialize();

    await engine.advance(3);

    expect(state.order).toEqual([
      "update:1",
      "render:1",
      "update:2",
      "render:2",
      "update:3",
      "render:3",
    ]);
    // Seconds, not milliseconds: every quantity a 2D game writes down is per second.
    for (const dt of state.dts) expect(dt).toBeCloseTo(1 / 60, 12);
    expect(engine.frame()).toEqual({
      count: 3,
      timeMs: 50,
      lastDeltaMs: 1000 / 60,
    });
  });

  it("hands every frame the same live state the engine exposes", async () => {
    const seen: TestState[] = [];
    const game = testGame({ update: (state) => seen.push(state) });
    const { engine } = build({ game });
    const state = await engine.initialize();

    await engine.advance(2);

    expect(seen).toEqual([state, state]);
    expect(engine.state).toBe(state);
  });

  it("runs nothing for a count of zero", async () => {
    const game = testGame();
    const { engine } = build({ game });
    const state = await engine.initialize();

    await engine.advance(0);

    expect(state.order).toEqual([]);
    expect(engine.frame().count).toBe(0);
  });

  it("takes each frame's delta from the clock in force", async () => {
    const { engine } = build({ clock: new SequenceClock([8, 32]) });
    await engine.initialize();

    await engine.advance(3);
    expect(engine.frame().timeMs).toBe(48);

    // Replaced in place: the counters carry over, and the next frame takes the new
    // clock's delta.
    engine.setClock(new ConstantClock(100));
    await engine.advance(1);

    expect(engine.frame()).toEqual({ count: 4, timeMs: 148, lastDeltaMs: 100 });
  });

  it("rejects with the game's cause and abandons the frames after it", async () => {
    const cause = new Error("bad frame");
    const game = testGame({
      update: (state) => {
        if (state.updates === 2) throw cause;
      },
    });
    const { engine } = build({ game });
    const state = await engine.initialize();

    await expect(engine.advance(5)).rejects.toBe(cause);

    // The failing frame counted — it happened — and the three after it did not run.
    expect(engine.frame().count).toBe(2);
    expect(state.updates).toBe(2);
    expect(state.renders).toBe(1);
  });
});

describe("the frame's own work", () => {
  it("clears and transforms before the game draws, and resets for the overlay", async () => {
    const game = testGame({
      render: (_state, api) => {
        api.ctx.fillRect(0, 0, 10, 10);
      },
    });
    const { engine, stub } = build({ game });
    await engine.initialize();
    stub.ops.length = 0;

    await engine.advance(1);

    expect(stub.names()).toEqual([
      "setTransform", // identity, so the clear covers the whole backing store
      "clearRect",
      "setTransform", // the viewport, so the game draws in logical coordinates
      "fillRect", // the game's own draw
      "setTransform", // identity again, so the overlay is chrome in device pixels
    ]);
    // The game drew under the letterboxed, device-pixel-ratio-aware transform.
    expect(stub.ops[3]?.transform).toEqual([4, 0, 0, 4, 0, 200]);
    expect(stub.ops[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(stub.ops[4]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("fills the background colour when one was given, in place of clearing", async () => {
    const { engine, stub } = build({ background: "#101018" });
    await engine.initialize();
    stub.ops.length = 0;

    await engine.advance(1);

    expect(stub.names()).toEqual(["setTransform", "fillRect", "setTransform", "setTransform"]);
    expect(stub.ops[1]?.fill).toBe("#101018");
  });

  it("resyncs the canvas every frame, so a resize needs no handler", async () => {
    const { engine, canvas } = build();
    await engine.initialize();

    Object.defineProperty(canvas, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 400, configurable: true });
    await engine.advance(1);

    // 400x400 CSS at a ratio of 2: an 800x800 store, a 400x200 field fitted on the
    // width, and the spare height split into two bars.
    expect(canvas.width).toBe(800);
    expect(engine.viewport()).toEqual({
      width: 400,
      height: 200,
      scale: 2,
      offsetX: 0,
      offsetY: 200,
    });
  });

  it("consumes an input edge exactly once, in the frame it belongs to", async () => {
    const target = new EventTarget();
    const pressedIn: number[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("fire", { keys: ["KeyF"] });
      },
      update: (state, api) => {
        if (api.input.pressed("fire")) pressedIn.push(state.updates);
      },
    });
    const { engine } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    await engine.advance(3);

    expect(pressedIn).toEqual([1]);
  });

  it("closes the frame, so an edge the game did not poll does not surface later", async () => {
    const target = new EventTarget();
    const pressedIn: number[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("fire", { keys: ["KeyF"] });
      },
      update: (state, api) => {
        // Deliberately blind to the first frame: an edge armed during a frame the
        // game did not poll must be gone by the next one, or the press would arrive
        // out of order with the input that caused it.
        if (state.updates > 1 && api.input.pressed("fire")) pressedIn.push(state.updates);
      },
    });
    const { engine } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    await engine.advance(3);

    expect(pressedIn).toEqual([]);
  });

  it("keeps a held key reading as a value for as long as it is down", async () => {
    const target = new EventTarget();
    const values: number[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("thrust", { keys: ["KeyW"] });
      },
      update: (_state, api) => values.push(api.input.value("thrust")),
    });
    const { engine } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    await engine.advance(2);
    target.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    await engine.advance(1);

    expect(values).toEqual([1, 1, 0]);
  });

  it("draws the overlay over the finished picture once it is switched on", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("score", () => 7);
      },
    });
    const { engine, stub } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    await engine.advance(1);
    expect(stub.names()).not.toContain("fillText");

    // The engine owns the backtick key, and it is engine chrome rather than a
    // registered action, so the game's own vocabulary stays exactly its own.
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    stub.ops.length = 0;
    await engine.advance(1);

    const text = stub.ops.filter((entry) => entry.op === "fillText");
    expect(text.length).toBeGreaterThan(0);
    // Chrome is drawn in device pixels, on top of the frame, not in the game's
    // letterboxed coordinates.
    expect(text[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    stub.ops.length = 0;
    await engine.advance(1);
    expect(stub.names()).not.toContain("fillText");
  });

  it("ignores an auto-repeat of the overlay key, so holding it does not strobe", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const { engine, stub } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", repeat: true }));
    await engine.advance(1);

    expect(stub.names()).not.toContain("fillText");
  });
});

describe("run", () => {
  it("drives one frame per host callback and resolves when the signal aborts", async () => {
    const { engine } = build();
    await engine.initialize();
    const controller = new AbortController();

    const running = engine.run({ signal: controller.signal });
    raf.tick(16);
    raf.tick(32);
    expect(engine.frame().count).toBe(2);

    controller.abort();
    await expect(running).resolves.toBeUndefined();

    // Nothing is scheduled any more, and a stray callback runs no frame.
    expect(raf.pending()).toBe(0);
    raf.tick(48);
    expect(engine.frame().count).toBe(2);
  });

  it("resolves immediately for a signal that has already aborted", async () => {
    const { engine } = build();
    await engine.initialize();

    await expect(engine.run({ signal: AbortSignal.abort() })).resolves.toBeUndefined();
    expect(engine.frame().count).toBe(0);
  });

  it("waits on the same halt when called again rather than starting a second loop", async () => {
    const { engine } = build();
    await engine.initialize();

    const first = engine.run();
    const second = engine.run();
    raf.tick(16);

    // One pump, one frame: two loops over one clock would double every frame.
    expect(engine.frame().count).toBe(1);

    engine.destroy();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it("keeps the loop alive when a frame throws, so one bad frame is not fatal", async () => {
    const game = testGame({
      update: (state) => {
        if (state.updates === 1) throw new Error("one bad frame");
      },
    });
    const { engine } = build({ game });
    const state = await engine.initialize();
    void engine.run();

    expect(() => raf.tick(16)).toThrow(/one bad frame/);
    raf.tick(32);

    expect(state.updates).toBe(2);
    expect(engine.frame().count).toBe(2);
  });

  it("leaves the engine usable after an abort", async () => {
    const { engine } = build();
    await engine.initialize();
    const controller = new AbortController();

    const running = engine.run({ signal: controller.signal });
    raf.tick(16);
    controller.abort();
    await running;

    // An abort halts the loop; it does not tear the engine down.
    await engine.advance(2);
    expect(engine.frame().count).toBe(3);
  });
});

describe("destroy", () => {
  it("halts the loop and resolves the promise run returned", async () => {
    const { engine } = build();
    await engine.initialize();

    const running = engine.run();
    raf.tick(16);
    engine.destroy();

    await expect(running).resolves.toBeUndefined();
    expect(raf.pending()).toBe(0);
    raf.tick(32);
    expect(engine.frame().count).toBe(1);
  });

  it("is idempotent, because teardown races", async () => {
    const { engine } = build();
    await engine.initialize();

    engine.destroy();
    expect(() => {
      engine.destroy();
      engine.destroy();
    }).not.toThrow();
    expect(installedHost()).toBeUndefined();
  });

  it("detaches every listener it attached", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => {
        api.input.register("fire", { keys: ["KeyF"] });
        api.diagnostics.register("score", () => 7);
      },
    });
    const { engine, stub } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();
    engine.destroy();

    let unlocks = 0;
    engine.events.on("audio:unlocked", () => {
      unlocks += 1;
    });
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    stub.ops.length = 0;

    // Nothing reached the engine: no unlock, no overlay, and no frames to draw one.
    expect(unlocks).toBe(0);
    expect(stub.ops).toEqual([]);
  });

  it("drops every subscription, so a stale handler cannot observe a successor", async () => {
    const game = testGame({
      initialize: (api) => api.audio.define("blip", { freq: 440, durationMs: 10 }),
      update: (_state, api) => api.audio.play("blip"),
    });
    const { engine } = build({ game });
    let cues = 0;
    engine.events.on("cue:played", () => {
      cues += 1;
    });
    await engine.initialize();
    await engine.advance(1);
    expect(cues).toBe(1);

    engine.destroy();
    // The engine is destroyed, so nothing more should reach a handler that closed
    // over the caller's own scene.
    expect(cues).toBe(1);
  });

  it("leaves the host handle owned by whichever engine is running", async () => {
    // The order a page recreating its engine actually uses: build the replacement,
    // then dispose of the original.
    const first = build().engine;
    const second = build().engine;
    await second.initialize();
    await second.advance(2);

    expect(installedHost()?.frame().count).toBe(2);

    first.destroy();

    expect(installedHost()?.frame().count).toBe(2);
  });

  it("runs and advances nothing once destroyed, rather than failing a teardown race", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.destroy();

    await expect(engine.run()).resolves.toBeUndefined();
    await expect(engine.advance(5)).resolves.toBeUndefined();
    expect(engine.frame().count).toBe(0);
    expect(raf.pending()).toBe(0);
  });
});

describe("the host interface", () => {
  it("reports the frame counter a post-run check reads", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();
    await engine.advance(3);

    expect(installedHost()?.frame()).toEqual({ count: 3, timeMs: 60, lastDeltaMs: 20 });
  });

  it("reads the game's diagnostics whether or not the overlay is visible", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("score", () => 12);
        api.diagnostics.register("nested", () => ({ x: 1 }));
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    expect(installedHost()?.diagnostics()).toEqual({ score: 12, nested: { x: 1 } });
  });

  it("switches the overlay from outside without touching the toggle key", async () => {
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const { engine, stub } = build({ game });
    await engine.initialize();

    installedHost()?.setOverlay(true);
    stub.ops.length = 0;
    await engine.advance(1);

    expect(stub.names()).toContain("fillText");
  });
});
