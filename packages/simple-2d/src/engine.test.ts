import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstantClock, SequenceClock } from "./clocks";
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
} from "./contract";
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
  /** The text drawn, for `fillText` alone. */
  text?: string;
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
    setTransform(
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ): void {
      transform = [a, b, c, d, e, f];
      ops.push({ op: "setTransform", transform, fill: stub.fillStyle });
    },
    clearRect(): void {
      ops.push({ op: "clearRect", transform, fill: stub.fillStyle });
    },
    fillRect(): void {
      ops.push({ op: "fillRect", transform, fill: stub.fillStyle });
    },
    fillText(text: string): void {
      ops.push({ op: "fillText", transform, fill: stub.fillStyle, text });
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
    beginPath(): void {
      ops.push({ op: "beginPath", transform, fill: stub.fillStyle });
    },
    rect(): void {
      ops.push({ op: "rect", transform, fill: stub.fillStyle });
    },
    clip(): void {
      ops.push({ op: "clip", transform, fill: stub.fillStyle });
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
function mount(
  cssW = 800,
  cssH = 600,
): { canvas: HTMLCanvasElement; stub: ContextStub } {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", {
    value: cssW,
    configurable: true,
  });
  Object.defineProperty(canvas, "clientHeight", {
    value: cssH,
    configurable: true,
  });
  document.body.append(canvas);
  const stub = contextStub(canvas);
  canvas.getContext = (() =>
    stub.ctx) as unknown as HTMLCanvasElement["getContext"];
  return { canvas, stub };
}

/** A canvas whose context cannot be had — the failure `createEngine` refuses. */
function contextlessCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() =>
    null) as unknown as HTMLCanvasElement["getContext"];
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

/**
 * The state every game below carries: a record of what its updates were handed.
 *
 * Nothing about renders lives here. A render is handed a read-only view and
 * returns nothing — that is the contract — so the interleaving of updates and
 * renders is logged on the game object instead (`testGame().log`), and a render
 * hook that wants to know which frame it is in reads `state.updates`, which the
 * frame's update has already counted by the time the render sees it.
 */
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
 * return a replacement for it; one that returns nothing leaves it as it is.
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
 * Every frame returns a fresh state — the value style the contract is written
 * for — so a test that holds the state `initialize` returned holds the opening
 * one, and reads the current one off `engine.state`. `log` is the order the
 * three functions ran in, kept on the game because a render cannot write it.
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
    update(state: DeepReadonly<TestState>, api: UpdateApi, dt: number): TestState {
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

const engines: Engine<unknown>[] = [];

/** Creates an engine the teardown disposes of, whatever the test does with it. */
function build(options: Partial<EngineOptions<TestState>> = {}): {
  engine: Engine<TestState>;
  stub: ContextStub;
  canvas: HTMLCanvasElement;
} {
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
  Object.defineProperty(window, "devicePixelRatio", {
    value: 2,
    configurable: true,
  });
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
      createEngine({
        canvas: contextlessCanvas(),
        width: 400,
        height: 200,
        game: testGame(),
      }),
    ).toThrow(/2D context/);
  });

  it("refuses a layout outside the catalogue, naming every valid one", () => {
    const { canvas } = mount();
    expect(() =>
      createEngine({
        canvas,
        width: 400,
        height: 200,
        game: testGame(),
        layout: "nope",
      }),
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
function fixedSurface(
  target: EventTarget,
  cssW = 800,
  cssH = 600,
  dpr = 2,
): SurfaceMetrics {
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
        await expect(api.assets.load("/etc/passwd")).rejects.toThrow(
          /escapes the asset root/,
        );
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
    expect(state).toEqual({ dts: [], updates: 0 });
    // The engine exposes the game's own value, live, rather than a copy of it.
    expect(engine.state).toBe(state);
  });

  it("is idempotent: a second call resolves to the state already built", async () => {
    const game = testGame();
    const { engine } = build({ game });

    const [first, second] = await Promise.all([
      engine.initialize(),
      engine.initialize(),
    ]);
    const third = await engine.initialize();

    expect(game.initializations).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("rejects with the game's own cause and leaves the engine uninitialized", async () => {
    const cause = new Error("no save file");
    const game: Game<TestState, null> = {
      initialize: (): Promise<[TestState, null]> => Promise.reject(cause),
      update: (state): TestState => state as TestState,
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

    expect([...Object.keys(api?.input ?? {})].sort()).toEqual([
      "layout",
      "register",
    ]);
    expect([...Object.keys(api?.audio ?? {})].sort()).toEqual([
      "define",
      "load",
    ]);
    expect(Object.keys(api?.diagnostics ?? {})).toEqual(["register"]);
    expect(api).not.toHaveProperty("debug");
  });

  it("refuses a game whose initialize returns anything but [state, debug]", async () => {
    // The shape is checked at runtime, since the game arrives as a built module
    // the type system never saw: a bare state where the pair belongs must not be
    // held as the state with nothing behind `engine.debug`.
    const fresh = (): TestState => ({
      dts: [],
      order: [],
      updates: 0,
      renders: 0,
    });
    const gameReturning = (value: unknown): Game<TestState, null> => ({
      initialize: () => value as [TestState, null],
      update: (state): TestState => state as TestState,
      render: (): void => {},
    });

    const bare = build({ game: gameReturning(fresh()) }).engine;
    await expect(bare.initialize()).rejects.toThrow(/\[state, debug\]/);
    expect(() => bare.state).toThrow(/initialize/);
    expect(() => bare.debug).toThrow(/initialize/);

    const tooLong = build({ game: gameReturning([fresh(), null, 1]) }).engine;
    await expect(tooLong.initialize()).rejects.toThrow(/\[state, debug\]/);
  });
});

describe("the debug surface", () => {
  /** A game that returns `surface` beside its state from its `initialize`. */
  function returning(
    surface: unknown,
  ): Game<TestState, unknown> & { initializations: number } {
    return testGame({ initialize: () => surface });
  }

  it("hands back the value the game returned, unchanged", async () => {
    const surface = { startMatch: (): void => {} };
    const { engine } = build({ game: returning(surface) });

    await engine.initialize();

    // Identity, not equality: a caller poses a scenario through the game's own
    // object, so an engine that copied it would drive a different one.
    expect(engine.debug).toBe(surface);
  });

  it("reads no member of the surface it holds", async () => {
    // Every read of the surface throws, so the engine touching one at any point
    // between construction and a drawn frame fails the test rather than passing
    // it quietly.
    const hostile = new Proxy(
      {},
      {
        get(_target, property): never {
          throw new Error(
            `the engine read ${String(property)} off the debug surface`,
          );
        },
      },
    );
    const { engine } = build({ game: returning(hostile) });

    await engine.initialize();
    await engine.advance(3);

    expect(engine.debug).toBe(hostile);
  });

  it("refuses to be read before initialize resolves, naming the pair", () => {
    const { engine } = build({ game: returning({}) });
    expect(() => engine.debug).toThrow(/initialize/);
    expect(() => engine.debug).toThrow(/\[state, debug\]/);
  });

  it("holds a null surface as the surface the game chose", async () => {
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      update: (state): TestState => state as TestState,
      render: (): void => {},
    };
    const { engine } = build({ game });

    await engine.initialize();

    // The engine holds what it was handed, so `null` is readable rather than a
    // refusal: a game with no surface says so, and a caller sees that it did.
    expect(engine.debug).toBeNull();
  });

  it("is readable the moment initialize resolves, before any frame", async () => {
    const surface = { poses: 0 };
    const { engine } = build({ game: returning(surface) });

    await engine.initialize();

    expect(engine.frame().count).toBe(0);
    expect(engine.debug).toBe(surface);
  });
});

describe("apply", () => {
  it("replaces the state with what the transition returns, and hands it back", async () => {
    const game = testGame();
    const { engine } = build({ game });
    const opening = await engine.initialize();

    const posed = engine.apply((state) => ({ ...state, updates: 40 }));

    expect(posed).toEqual({ dts: [], updates: 40 });
    expect(engine.state).toBe(posed);
    // The opening state is a value nothing wrote to.
    expect(opening).toEqual({ dts: [], updates: 0 });
  });

  it("is what the next frame's update receives", async () => {
    const handed: number[] = [];
    const game = testGame({
      update: (state) => {
        handed.push(state.updates);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(1);
    engine.apply((state) => ({ ...state, updates: 10 }));
    await engine.advance(1);

    // Frame 1 counted to 1; the pose set 10; frame 2 counted from there.
    expect(handed).toEqual([1, 11]);
    expect(engine.state.updates).toBe(11);
  });

  it("drives a debug surface written as transitions over the state", async () => {
    // The shape a case's surface takes under this contract: a pose is
    // `(state, ...args) => state`, a reading is `(state) => value`, and a caller
    // threads them through the engine rather than through a closure.
    const debug = {
      set: (state: DeepReadonly<TestState>, updates: number): TestState => ({
        ...state,
        updates,
      }),
      read: (state: DeepReadonly<TestState>): number => state.updates,
    };
    const game = testGame({ initialize: () => debug });
    const { engine } = build({ game });
    await engine.initialize();

    engine.apply((state) => engine.debug.set(state, 7));
    await engine.advance(2);

    expect(engine.debug.read(engine.state)).toBe(9);
  });

  it("refuses a transition that returns nothing, and holds the state it had", async () => {
    const game = testGame();
    const { engine } = build({ game });
    const opening = await engine.initialize();

    expect(() =>
      engine.apply(() => undefined as unknown as TestState),
    ).toThrow(/engine\.apply must return the next state/);
    expect(engine.state).toBe(opening);
  });

  it("refuses to be reached before initialize resolves, naming the ordering", () => {
    const { engine } = build();
    expect(() => engine.apply((state) => state as TestState)).toThrow(
      /initialize/,
    );
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
    // Seconds, not milliseconds: every quantity a 2D game writes down is per second.
    expect(engine.state.dts).toHaveLength(3);
    for (const dt of engine.state.dts) expect(dt).toBeCloseTo(1 / 60, 12);
    expect(engine.frame()).toEqual({
      count: 3,
      timeMs: 50,
      lastDeltaMs: 1000 / 60,
    });
  });

  it("hands each frame the state the previous one returned, and exposes the latest", async () => {
    const handed: DeepReadonly<TestState>[] = [];
    const returned: TestState[] = [];
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      update: (state, _api, dt) => {
        handed.push(state);
        const next = { updates: state.updates + 1, dts: [...state.dts, dt] };
        returned.push(next);
        return next;
      },
      render: (state) => {
        // The render sees the state this frame's update returned, not the one
        // it was handed.
        expect(state).toBe(returned[returned.length - 1]);
      },
    };
    const { engine } = build({ game });
    const opening = await engine.initialize();

    await engine.advance(2);

    // Frame 1 was handed the opening state; frame 2 was handed what frame 1
    // returned; the engine now exposes what frame 2 returned — and the opening
    // state is untouched, because nothing ever wrote to it.
    expect(handed[0]).toBe(opening);
    expect(handed[1]).toBe(returned[0]);
    expect(engine.state).toBe(returned[1]);
    expect(opening).toEqual({ dts: [], updates: 0 });
  });

  it("refuses an update that returns nothing, and holds the state it had", async () => {
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      // A game written against the old, mutating contract: it writes into the
      // state it was handed and returns nothing.
      update: (): TestState => undefined as unknown as TestState,
      render: () => {},
    };
    const { engine } = build({ game });
    const opening = await engine.initialize();

    await expect(engine.advance(1)).rejects.toThrow(/update must return the next state/);

    expect(engine.state).toBe(opening);
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
    await engine.initialize();

    await expect(engine.advance(5)).rejects.toBe(cause);

    // The failing frame counted — it happened — and the three after it did not
    // run. Its update threw before returning, so the state it was handed is the
    // state the engine still holds: one finished frame's worth.
    expect(engine.frame().count).toBe(2);
    expect(game.log).toEqual(["update:1", "render:1", "update:2"]);
    expect(engine.state.updates).toBe(1);
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

    expect(stub.names()).toEqual([
      "setTransform",
      "fillRect",
      "setTransform",
      "setTransform",
    ]);
    expect(stub.ops[1]?.fill).toBe("#101018");
  });

  it("resyncs the canvas every frame, so a resize needs no handler", async () => {
    const { engine, canvas } = build();
    await engine.initialize();

    Object.defineProperty(canvas, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientHeight", {
      value: 400,
      configurable: true,
    });
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
        if (state.updates > 1 && api.input.pressed("fire"))
          pressedIn.push(state.updates);
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
      update: (_state, api) => {
        values.push(api.input.value("thrust"));
      },
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

  it("hands each diagnostic source the state current at the read", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => {
        // A source reads the state it is handed — not the object `initialize`
        // built, which every frame since has replaced.
        api.diagnostics.register("updates", (state) => state.updates);
      },
    });
    const { engine, stub } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));

    await engine.advance(3);
    engine.apply((state) => ({ ...state, updates: 50 }));
    stub.ops.length = 0;
    await engine.advance(1);

    const drawn = stub.ops
      .filter((entry) => entry.op === "fillText")
      .map((entry) => entry.text);
    expect(drawn).toContain("updates: 51");
  });

  it("ignores an auto-repeat of the overlay key, so holding it does not strobe", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const { engine, stub } = build({ game, surface: fixedSurface(target) });
    await engine.initialize();

    target.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Backquote", repeat: true }),
    );
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

    await expect(
      engine.run({ signal: AbortSignal.abort() }),
    ).resolves.toBeUndefined();
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
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("keeps the loop alive when a frame throws, so one bad frame is not fatal", async () => {
    const game = testGame({
      update: (_state, api) => {
        if (api.frame().count === 1) throw new Error("one bad frame");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    void engine.run();

    expect(() => raf.tick(16)).toThrow(/one bad frame/);
    raf.tick(32);

    // Both frames ran. The first threw before returning a state, so the engine
    // kept the one it had, and only the second's update counted.
    expect(engine.frame().count).toBe(2);
    expect(engine.state.updates).toBe(1);
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
      initialize: (api) =>
        api.audio.define("blip", { freq: 440, durationMs: 10 }),
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

  it("stops every loop, so a cue cannot outlive the engine that started it", async () => {
    let audio: UpdateApi["audio"] | null = null;
    const game = testGame({
      initialize: (api) =>
        api.audio.define("hum", { freq: 110, durationMs: 10 }),
      update: (_state, api) => {
        audio = api.audio;
        api.audio.loop("hum");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);
    expect(audio!.looping("hum")).toBe(true);

    engine.destroy();

    expect(audio!.looping("hum")).toBe(false);
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

/**
 * One frame's operations, resolved through the table the recording shares.
 *
 * A frame names its operations by index, so a test that wants to read what a frame
 * drew resolves them the way a player does.
 */
function frameOps(recording: Recording, at: number): readonly DrawOp[] {
  return (recording.frames[at]?.ops ?? []).flatMap((index) => {
    const op = recording.ops[index];
    return op === undefined ? [] : [op];
  });
}

describe("draw-command recording", () => {
  it("records nothing until it is armed", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();
    await engine.advance(2);

    expect(engine.recording()).toBe(false);
    engine.startRecording();
    expect(engine.recording()).toBe(true);
    expect(engine.stopRecording().frames).toEqual([]);
  });

  it("captures one frame per advanced frame, with the clock's own deltas", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(3);
    const recording = engine.stopRecording();

    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(recording.frames.map((frame) => frame.deltaMs)).toEqual([
      20, 20, 20,
    ]);
    expect(recording.frames.map((frame) => frame.timeMs)).toEqual([20, 40, 60]);
  });

  it("records the engine's own frame preparation, so a replayed frame starts blank", async () => {
    const { engine } = build({
      clock: new ConstantClock(20),
      background: "#101018",
    });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    // `prepare` resets the transform, paints the background, then applies the
    // viewport — in that order, before anything the game draws.
    const names = frameOps(recording, 0).flatMap((op) =>
      op.op === "call" ? [op.method] : [],
    );
    expect(names.slice(0, 2)).toEqual(["setTransform", "fillRect"]);
  });

  it("records what the game drew", async () => {
    const game = testGame({
      render: (_state, api) => {
        api.ctx.fillStyle = "#7fd1ff";
        api.ctx.fillRect(1, 2, 3, 4);
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20) });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const ops = frameOps(recording, 0);
    expect(ops).toContainEqual({
      op: "set",
      property: "fillStyle",
      value: "#7fd1ff",
    });
    expect(ops).toContainEqual({
      op: "call",
      method: "fillRect",
      args: [1, 2, 3, 4],
    });
  });

  it("keeps the diagnostics overlay out of the recording", async () => {
    const target = new EventTarget();
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const { engine, stub } = build({
      game,
      clock: new ConstantClock(20),
      surface: fixedSurface(target),
    });
    await engine.initialize();

    // The overlay is off by default, so a recording taken without turning it on says
    // nothing about where the overlay is drawn. Switched on, its text reaches the
    // canvas and the recording holds none of it.
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const names = frameOps(recording, 0).flatMap((op) =>
      op.op === "call" ? [op.method] : [],
    );
    expect(stub.names()).toContain("fillText");
    expect(names).not.toContain("fillText");
  });

  it("carries the stack a frame left saved for the next one, outermost first", async () => {
    const game = testGame({
      render: (state, api) => {
        // A build that saves on one frame and restores on the next: the second
        // frame's operations run under the states the first frame saved, and a
        // player has no earlier frame to have pushed them.
        if (state.updates === 1) {
          api.ctx.fillStyle = "#outer";
          api.ctx.save();
          api.ctx.fillStyle = "#inner";
          api.ctx.save();
          api.ctx.fillStyle = "#current";
        } else api.ctx.restore();
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20) });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();

    // The order is the contract: a player applies each entry and saves, so a stack
    // written the other way round restores the frame to the wrong state.
    expect(recording.frames.map((frame) => frame.stack.length)).toEqual([0, 2]);
    const saved = (recording.frames[1]?.stack ?? []).map(
      (index) => recording.states[index]?.properties["fillStyle"],
    );
    expect(saved).toEqual(["#outer", "#inner"]);
    expect(
      recording.states[recording.frames[1]?.state ?? -1]?.properties[
        "fillStyle"
      ],
    ).toBe("#current");
  });

  it("survives the resize its own frame preparation performs", async () => {
    const target = new EventTarget();
    let cssWidth = 800;
    const surface: SurfaceMetrics = {
      cssWidth: (): number => cssWidth,
      cssHeight: (): number => 600,
      dpr: (): number => 2,
      events: (): EventTarget => target,
    };
    const game = testGame({
      render: (state, api) => {
        if (state.updates > 1) return;
        api.ctx.beginPath();
        api.ctx.rect(0, 0, 10, 10);
        api.ctx.clip();
        api.ctx.save();
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20), surface });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);

    // The display changed, so the next frame's preparation writes the backing store
    // — which resets the context completely, from inside the frame bracket.
    cssWidth = 400;
    await engine.advance(1);
    const recording = engine.stopRecording();

    const inherited = recording.states[recording.frames[1]?.state ?? -1];
    expect(recording.frames[1]?.surface.width).toBe(800);
    expect(inherited?.clip).toEqual([]);
    expect(inherited?.path).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
  });

  it("notices a game clearing its canvas by writing the size straight back", async () => {
    const game = testGame({
      render: (state, api) => {
        if (state.updates === 1) {
          api.ctx.beginPath();
          api.ctx.rect(0, 0, 10, 10);
          api.ctx.clip();
          api.ctx.save();
          return;
        }
        // The ordinary clear. It resets the context completely — transform,
        // properties, clip, current path, save stack — and changes no size, so
        // nothing about the backing store says it happened.
        const { canvas } = api.ctx;
        const size = canvas.width;
        canvas.width = size;
        api.ctx.fillRect(0, 0, 4, 4);
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20) });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();

    const inherited = recording.states[recording.frames[1]?.state ?? -1];
    expect(inherited?.clip).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
    // The wipe erased the pixels the frame's own preparation had already drawn, so
    // the frame holds only what the game issued after it.
    expect(
      frameOps(recording, 1).flatMap((op) =>
        op.op === "call" ? [op.method] : [],
      ),
    ).toEqual(["fillRect"]);
  });

  it("reports the design size and background the engine was built with", async () => {
    const { engine } = build({
      clock: new ConstantClock(20),
      background: "#101018",
    });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(recording.width).toBe(400);
    expect(recording.height).toBe(200);
    expect(recording.background).toBe("#101018");
  });

  it("records only the frames between arming and disarming", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();
    await engine.advance(5);
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();
    await engine.advance(3);

    expect(recording.frames.map((frame) => frame.count)).toEqual([6, 7]);
  });

  it("refuses an unbalanced call rather than discarding or inventing frames", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();

    expect(() => engine.stopRecording()).toThrow(/while not recording/);
    engine.startRecording();
    expect(() => engine.startRecording()).toThrow(/while already recording/);
  });
});
