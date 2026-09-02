import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstantClock, SequenceClock } from "./clocks";
import type {
  CameraSnapshot,
  DeepReadonly,
  Engine,
  EngineOptions,
  Game,
  InitApi,
  RenderApi,
  SurfaceMetrics,
  UpdateApi,
  Viewport,
} from "./contract";
import { createEngine } from "./index";
import type {
  Context2dStub,
  InstalledContexts,
  Stage,
  SurfaceStub,
} from "./testing/canvas";
import {
  createContextlessCanvas,
  createStage,
  createSurface,
  installCanvasContexts,
} from "./testing/canvas";
import type { InstalledCodecs } from "./testing/codecs";
import { installCodecs } from "./testing/codecs";
import type { GlStub } from "./testing/gl";

/**
 * Integration tests over the assembled engine — the wiring `createEngine` performs,
 * exercised the way a game and a validator actually meet it. Every subsystem has its
 * own suite beside it, so what is checked here is only what the wiring decides: what
 * runs when, in which order, with which arguments, and what refuses.
 *
 * The eleven steps of a frame are the centre of it. Each one is asserted through a
 * *consequence* of its position rather than by watching the engine call something,
 * because the position is what a game and a validator depend on and a call order is
 * only how it happens to be implemented: the screen layer is blank when the game's
 * render starts because the clear precedes it, the view answers with the camera the
 * game just posed because the reading follows the render, a recording holds no
 * overlay because the capture precedes the panel, and an edge is news for exactly
 * one frame because the input frame closes last.
 *
 * jsdom gives a document, events and an element tree but neither a GPU nor layout,
 * so three things are stood in for, all of them from `src/testing/`: a WebGL2 context
 * a real `THREE.WebGLRenderer` is built over and renders through, a 2D context that
 * records each operation *and the transform in force when it happened*, and the
 * element's laid-out size and device pixel ratio. `requestAnimationFrame` is replaced
 * by a queue the test drains by hand, because a loop that re-arms itself would
 * otherwise run for as long as the test process does.
 */

/** The design field every engine below is built at. */
const DESIGN_WIDTH = 400;
const DESIGN_HEIGHT = 200;

/**
 * The fit that field takes in the rig's canvas, written out rather than computed.
 *
 * 800x600 CSS at a ratio of 2 is a 1600x1200 backing store; a 400x200 field fits it
 * on the width at 4 device pixels per logical unit, with the spare 400 device pixels
 * of height split into two 200-pixel bars.
 */
const FIT: Viewport = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  scale: 4,
  offsetX: 0,
  offsetY: 200,
};

/** The transform that fit puts on the screen layer, and the identity beside it. */
const VIEWPORT_TRANSFORM = [FIT.scale, 0, 0, FIT.scale, FIT.offsetX, FIT.offsetY];
const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * The state every game below carries: a record of what its updates were handed.
 *
 * Nothing about renders lives here. A render is handed a read-only view and returns
 * nothing — that is the contract — so the interleaving of updates and renders is
 * logged on the game object instead (`testGame().log`), and a render hook that wants
 * to know which frame it is in reads `state.updates`, which the frame's update has
 * already counted by the time the render sees it.
 */
interface TestState {
  readonly dts: readonly number[];
  readonly updates: number;
}

/**
 * Anything a test wants to do at one of the three moments, with sane defaults.
 *
 * An `initialize` hook may return the debug surface the game should hand back beside
 * its state; one that returns nothing leaves the game with `null` there. An `update`
 * hook is handed the frame's NEXT state, already counted, and may return a
 * replacement for it; one that returns nothing leaves it as it is.
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

/** A game with its call log, as every test below drives one. */
type TestGame = Game<TestState, unknown> & {
  initializations: number;
  log: string[];
};

/**
 * A game that records the calls it received and does whatever the test asked.
 *
 * Every frame returns a fresh state — the value style the contract is written for —
 * so a test that holds the state `initialize` returned holds the opening one, and
 * reads the current one off `engine.state`. `log` is the order the three functions
 * ran in, kept on the game because a render cannot write it.
 */
function testGame(hooks: GameHooks = {}): TestGame {
  const game: TestGame = {
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

/** A cube, for the frames that need the renderer to have something to draw. */
function box(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
}

const engines: Engine<never>[] = [];

/** Undo for whatever a test installed on the document or the global object. */
const teardown: (() => void)[] = [];

/** Everything a test holds onto: the engine, and the rig it was built over. */
interface Rig {
  engine: Engine<TestState, unknown>;
  /** The canvas the scene is rendered through. */
  canvas: HTMLCanvasElement;
  /** The GL calls the renderer issued through it. */
  gl: GlStub;
  /** The operations the screen layer recorded, with the transform in force for each. */
  screen: Context2dStub;
  /** The canvas the screen layer is drawn on. */
  screenCanvas: HTMLCanvasElement;
  /** The surface every measurement went through, and the target its events go on. */
  surface: SurfaceStub;
  target: EventTarget;
  stage: Stage;
}

/** Creates an engine the teardown disposes of, whatever the test does with it. */
function build(
  options: Partial<EngineOptions<TestState, unknown>> = {},
  stageOptions: { surface?: SurfaceStub } = {},
): Rig {
  const stage = createStage();
  const surface = stageOptions.surface ?? stage.surface;
  const engine = createEngine<TestState, unknown>({
    canvas: stage.stage.canvas,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    game: options.game ?? testGame(),
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface: surface.surface,
    screen: stage.screen.canvas,
    ...options,
  });
  engines.push(engine as unknown as Engine<never>);
  return {
    engine,
    canvas: stage.stage.canvas,
    gl: stage.stage.gl,
    screen: stage.screen.context2d,
    screenCanvas: stage.screen.canvas,
    surface,
    target: surface.target,
    stage,
  };
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
 * A surface whose reported CSS size a test can change between frames.
 *
 * jsdom performs no layout, so this is the only way to say "the element was
 * resized" — which is the whole of what the engine's every-frame resync exists for.
 */
function mutableSurface(base: SurfaceStub): {
  surface: SurfaceStub;
  resize: (cssWidth: number, cssHeight: number) => void;
} {
  let cssWidth = 800;
  let cssHeight = 600;
  const metrics: SurfaceMetrics = {
    ...base.surface,
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
  };
  return {
    surface: { ...base, surface: metrics },
    resize: (w, h) => {
      cssWidth = w;
      cssHeight = h;
    },
  };
}

/** The engine's own toggle key, as a build's player presses it. */
function pressOverlayKey(target: EventTarget, repeat = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Backquote", repeat }),
  );
}

/** Every string the overlay drew this frame, in the order it drew them. */
function overlayText(screen: Context2dStub): string[] {
  return screen.opsOf("fillText").map((entry) => String(entry.text));
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
  while (teardown.length > 0) teardown.pop()?.();
  document.body.replaceChildren();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
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
  });

  it("refuses a design size that is not finite and positive, naming it", () => {
    const stage = createStage();
    const game = testGame();
    for (const [width, height] of [
      [0, 200],
      [400, 0],
      [-400, 200],
      [400, Number.NaN],
      [Number.POSITIVE_INFINITY, 200],
    ] as const) {
      expect(() =>
        createEngine({
          canvas: stage.stage.canvas,
          width,
          height,
          game,
          screen: stage.screen.canvas,
          surface: stage.surface.surface,
        }),
      ).toThrow(new RegExp(`${String(width)}x${String(height)}`));
    }
    expect(game.initializations).toBe(0);
  });

  it("refuses a canvas that yields no webgl2 context, naming the canvas", () => {
    const stage = createStage();
    expect(() =>
      createEngine({
        canvas: createContextlessCanvas(),
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        game: testGame(),
        screen: stage.screen.canvas,
        surface: stage.surface.surface,
      }),
    ).toThrow(/webgl2 context from the canvas/);
  });

  it("refuses a stage canvas with no owning document and no screen canvas, naming screen", () => {
    const stage = createStage();
    Object.defineProperty(stage.stage.canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });

    expect(() =>
      createEngine({
        canvas: stage.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        game: testGame(),
        surface: stage.surface.surface,
      }),
    ).toThrow(/screen/);
  });

  it("refuses a projection outside the pair, naming both values", () => {
    const stage = createStage();
    expect(() =>
      createEngine({
        canvas: stage.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        game: testGame(),
        screen: stage.screen.canvas,
        surface: stage.surface.surface,
        projection: "isometric" as "perspective",
      }),
    ).toThrow(/"perspective".*"orthographic"/);
  });

  it("refuses a layout outside the catalogue, naming every valid one", () => {
    const stage = createStage();
    expect(() =>
      createEngine({
        canvas: stage.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        game: testGame(),
        screen: stage.screen.canvas,
        surface: stage.surface.surface,
        layout: "nope",
      }),
    ).toThrow(/dpad-4-two-buttons/);
  });

  it("gives back the listeners it attached when a layout is refused", () => {
    // A refused build returns no engine, so nothing can be destroyed afterwards: the
    // only thing that can undo the input registry's listeners is `createEngine`
    // itself. Counting the pair is how a leak here is caught. The renderer built
    // before the refusal is disposed on the same path, which the `destroy` suite
    // pins against the GL context.
    const target = new EventTarget();
    const added = vi.spyOn(target, "addEventListener");
    const removed = vi.spyOn(target, "removeEventListener");
    const stage = createStage();
    const surface = createSurface({ events: target });

    expect(() =>
      createEngine({
        canvas: stage.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        game: testGame(),
        screen: stage.screen.canvas,
        surface: surface.surface,
        layout: "not-a-layout",
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
    const { engine } = build({ game, layout: "dual-stick-two-buttons" });
    await engine.initialize();

    expect(seen).toBe("dual-stick-two-buttons");
  });

  it("sizes both canvases and reports the fit before any frame has run", () => {
    const { engine, canvas, screenCanvas } = build();

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    // The screen layer copies the stage rather than measuring the surface a second
    // time, so the composite is a pixel-for-pixel lift with nothing resampled.
    expect(screenCanvas.width).toBe(canvas.width);
    expect(screenCanvas.height).toBe(canvas.height);
    expect(engine.viewport()).toEqual(FIT);
  });

  it("hands out a viewport copy rather than the fit it keeps", () => {
    const { engine } = build();
    const first = engine.viewport();
    first.scale = 999;

    expect(engine.viewport()).toEqual(FIT);
  });

  it("creates the screen canvas from the stage canvas's document when none is given", async () => {
    const installed: InstalledContexts = installCanvasContexts();
    teardown.push(() => {
      installed.uninstall();
    });
    const stage = createStage();
    let screen: CanvasRenderingContext2D | undefined;
    const game = testGame({
      render: (_state, api) => {
        screen = api.screen;
      },
    });
    const engine = createEngine<TestState, unknown>({
      canvas: stage.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game,
      clock: new ConstantClock(16),
      surface: stage.surface.surface,
    });
    engines.push(engine as unknown as Engine<never>);

    await engine.initialize();
    await engine.advance(1);

    expect(screen).toBeDefined();
    expect(screen?.canvas).not.toBe(stage.stage.canvas);
    expect(screen?.canvas.ownerDocument).toBe(stage.stage.canvas.ownerDocument);
    expect(screen?.canvas.width).toBe(stage.stage.canvas.width);
  });

  it("passes the screen canvas's own context through, whatever the canvas returned", async () => {
    // The substitution seam a validator uses to read the drawing operations rather
    // than the pixels: it overrides `getContext` on the canvas it supplies, and the
    // engine hands the game exactly what came back.
    const stage = createStage();
    const calls: string[] = [];
    const proxy = new Proxy(stage.screen.context2d.ctx, {
      get(target, property, receiver): unknown {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]): unknown => {
          calls.push(String(property));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    stage.screen.canvas.getContext = ((): unknown =>
      proxy) as HTMLCanvasElement["getContext"];

    let handed: CanvasRenderingContext2D | undefined;
    const game = testGame({
      render: (_state, api) => {
        handed = api.screen;
        api.screen.fillText("PRACTICE", 8, 8);
      },
    });
    const engine = createEngine<TestState, unknown>({
      canvas: stage.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game,
      clock: new ConstantClock(16),
      surface: stage.surface.surface,
      screen: stage.screen.canvas,
    });
    engines.push(engine as unknown as Engine<never>);

    await engine.initialize();
    await engine.advance(1);

    expect(handed).toBe(proxy);
    expect(calls).toContain("fillText");
  });
});

/* -------------------------------------------------------------------------- */
/* The scene and the camera                                                   */
/* -------------------------------------------------------------------------- */

describe("the scene and the camera", () => {
  it("exist from construction, before any game code has run", () => {
    const { engine } = build();

    expect(engine.scene).toBeInstanceOf(THREE.Scene);
    expect(engine.scene.children).toEqual([]);
    expect(engine.camera).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it("starts a perspective camera at the documented defaults", () => {
    const { engine } = build();
    const camera = engine.camera as THREE.PerspectiveCamera;

    expect(camera.fov).toBe(60);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
    // The *design* aspect rather than the canvas's, which is what makes the picture
    // keep the shape the game was written for.
    expect(camera.aspect).toBeCloseTo(DESIGN_WIDTH / DESIGN_HEIGHT, 12);
  });

  it("builds an orthographic camera spanning the design field when asked", () => {
    const { engine } = build({ projection: "orthographic" });
    const camera = engine.camera as THREE.OrthographicCamera;

    expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([
      -DESIGN_WIDTH / 2,
      DESIGN_WIDTH / 2,
      DESIGN_HEIGHT / 2,
      -DESIGN_HEIGHT / 2,
    ]);
    expect(engine.view().camera().projection).toBe("orthographic");
  });

  it("hands the game the engine's own scene from initialize onwards", async () => {
    let fromInit: THREE.Scene | undefined;
    let fromRender: THREE.Scene | undefined;
    const light = new THREE.AmbientLight();
    const game = testGame({
      initialize: (api) => {
        fromInit = api.scene;
        api.scene.add(light);
      },
      render: (_state, api) => {
        fromRender = api.scene;
      },
    });
    const { engine } = build({ game });

    await engine.initialize();
    await engine.advance(1);

    // One object, reachable three ways, and what initialization placed in it is
    // still there when the first render runs.
    expect(fromInit).toBe(engine.scene);
    expect(fromRender).toBe(engine.scene);
    expect(engine.scene.children).toContain(light);
  });

  it("retains what a render added, and lets a validator find it by name", async () => {
    const game = testGame({
      render: (state, api) => {
        if (state.updates > 1) return;
        const mesh = box();
        mesh.name = "hook";
        api.scene.add(mesh);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(4);

    const hook = engine.scene.getObjectByName("hook");
    expect(hook).toBeDefined();
    expect(engine.scene.children).toHaveLength(1);
  });

  it("leaves the scene standing after the engine is destroyed", async () => {
    const game = testGame({
      initialize: (api) => {
        api.scene.add(box());
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);

    engine.destroy();

    // The objects are the game's, not the engine's, so a caller that reads the
    // scene after teardown still finds what the last frame left.
    expect(engine.scene.children).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

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
        resolved = api.assets.resolve("models/crane.glb");
      },
    });
    const { engine } = build({ game, assetRoot: "media" });
    await engine.initialize();

    expect(resolved).toBe("media/models/crane.glb");
  });

  it("defaults the asset root to assets/", async () => {
    let resolved = "";
    const game = testGame({
      initialize: (api) => {
        resolved = api.assets.resolve("crate.png");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    expect(resolved).toBe("assets/crate.png");
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

    const played: { cue: string; t: number; at: unknown }[] = [];
    engine.events.on("cue:played", (payload) => played.push(payload));

    await engine.initialize();
    await engine.advance(4);

    expect(played).toHaveLength(1);
    // The third frame's update runs after that frame's delta has been accumulated,
    // so the cue belongs to simulated time 60 — which is what `frame().timeMs` said
    // at that moment.
    expect(played[0]?.t).toBe(60);
    // A cue played with no point is announced with none, rather than at the origin.
    expect(played[0]?.at).toBeNull();
  });

  it("carries the world point a positioned cue was played at", async () => {
    const game = testGame({
      initialize: (api) => {
        api.audio.define("clank", { freq: 220, durationMs: 20 });
      },
      update: (state, api) => {
        if (state.updates === 1) api.audio.play("clank", { at: { x: 1, y: 2, z: 3 } });
      },
    });
    const { engine } = build({ game, clock: new ConstantClock(20) });

    const played: { at: unknown }[] = [];
    engine.events.on("cue:played", (payload) => played.push(payload));

    await engine.initialize();
    await engine.advance(1);

    expect(played[0]?.at).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("unlocks the audio context on the first gesture, once, and stops listening", () => {
    const { engine, target } = build();

    let unlocks = 0;
    engine.events.on("audio:unlocked", () => {
      unlocks += 1;
    });

    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }));

    expect(unlocks).toBe(1);
  });

  it("contains a handler that throws, and still delivers to the rest", () => {
    const { engine, target } = build();
    const seen: string[] = [];
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    engine.events.on("audio:unlocked", () => {
      seen.push("first");
      throw new Error("a subscriber's own bug");
    });
    engine.events.on("audio:unlocked", () => seen.push("second"));

    target.dispatchEvent(new Event("pointerdown"));

    // A subscriber's bug is still a bug — it reaches the console — but it is not
    // the emitting subsystem's problem and costs the handlers after it nothing.
    expect(seen).toEqual(["first", "second"]);
    expect(reported).toHaveBeenCalled();
  });

  it("removes a handler when its own unsubscribe is called", () => {
    const { engine, target } = build();
    let unlocks = 0;
    const off = engine.events.on("audio:unlocked", () => {
      unlocks += 1;
    });

    off();
    target.dispatchEvent(new Event("pointerdown"));

    expect(unlocks).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* initialize                                                                 */
/* -------------------------------------------------------------------------- */

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

  it("runs no frame before it resolves", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const game = testGame({ initialize: () => gate });
    const { engine } = build({ game });

    const starting = engine.initialize();
    expect(engine.frame().count).toBe(0);
    expect(game.log).toEqual([]);

    release();
    await starting;
    await engine.advance(1);
    expect(game.log).toEqual(["update:1", "render:1"]);
  });

  it("hands the game a scoped API rather than the engine's own subsystems", async () => {
    let api: InitApi<TestState> | undefined;
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
    expect([...Object.keys(api?.assets ?? {})].sort()).toEqual([
      "load",
      "loadAudio",
      "loadImage",
      "loadModel",
      "loadTexture",
      "resolve",
    ]);
    expect(Object.keys(api?.diagnostics ?? {})).toEqual(["register"]);
    // Nothing that draws, and nothing that reads input: those belong to the other
    // two moments.
    expect(api).not.toHaveProperty("screen");
    expect(api).not.toHaveProperty("camera");
    expect(api).not.toHaveProperty("debug");
  });

  it("refuses a game whose initialize returns anything but [state, debug]", async () => {
    // The shape is checked at runtime, since the game arrives as a built module the
    // type system never saw: a bare state where the pair belongs must not be held as
    // the state with nothing behind `engine.debug`.
    const fresh = (): TestState => ({ dts: [], updates: 0 });
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

/* -------------------------------------------------------------------------- */
/* The debug surface                                                          */
/* -------------------------------------------------------------------------- */

describe("the debug surface", () => {
  /** A game that returns `surface` beside its state from its `initialize`. */
  function returning(surface: unknown): TestGame {
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
    // between construction and a drawn frame fails the test rather than passing it
    // quietly.
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

/* -------------------------------------------------------------------------- */
/* apply                                                                      */
/* -------------------------------------------------------------------------- */

describe("apply", () => {
  it("replaces the state with what the transition returns, and hands it back", async () => {
    const { engine } = build();
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

    engine.apply((state) => (engine.debug as typeof debug).set(state, 7));
    await engine.advance(2);

    expect((engine.debug as typeof debug).read(engine.state)).toBe(9);
  });

  it("refuses a transition that returns nothing, and holds the state it had", async () => {
    const { engine } = build();
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

/* -------------------------------------------------------------------------- */
/* The ordering rules                                                         */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* advance                                                                    */
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
    // Seconds, not milliseconds: every quantity a 3D game writes down is per second.
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
        // The render sees the state this frame's update returned, not the one it
        // was handed.
        expect(state).toBe(returned[returned.length - 1]);
      },
    };
    const { engine } = build({ game });
    const opening = await engine.initialize();

    await engine.advance(2);

    expect(handed[0]).toBe(opening);
    expect(handed[1]).toBe(returned[0]);
    expect(engine.state).toBe(returned[1]);
    expect(opening).toEqual({ dts: [], updates: 0 });
  });

  it("refuses an update that returns nothing, and holds the state it had", async () => {
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      // A game written against a mutating contract: it writes into the state it was
      // handed and returns nothing.
      update: (): TestState => undefined as unknown as TestState,
      render: () => {},
    };
    const { engine } = build({ game });
    const opening = await engine.initialize();

    await expect(engine.advance(1)).rejects.toThrow(
      /update must return the next state/,
    );

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

    // The failing frame counted — it happened — and the three after it did not run.
    // Its update threw before returning, so the state it was handed is the state the
    // engine still holds: one finished frame's worth.
    expect(engine.frame().count).toBe(2);
    expect(game.log).toEqual(["update:1", "render:1", "update:2"]);
    expect(engine.state.updates).toBe(1);
  });

  it("rejects with a render's cause too, and abandons the frames after it", async () => {
    const cause = new Error("bad picture");
    const game = testGame({
      render: (state) => {
        if (state.updates === 2) throw cause;
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await expect(engine.advance(5)).rejects.toBe(cause);

    expect(engine.frame().count).toBe(2);
    // The update of the failing frame did return, so its state stands.
    expect(engine.state.updates).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* One frame, in order                                                        */
/* -------------------------------------------------------------------------- */

describe("one frame, in order", () => {
  it("clears and transforms the screen layer before the game draws, and resets for the overlay", async () => {
    const game = testGame({
      render: (_state, api) => {
        api.screen.fillRect(0, 0, 10, 10);
      },
    });
    const { engine, screen } = build({ game });
    await engine.initialize();
    screen.forget();

    await engine.advance(1);

    expect(screen.names()).toEqual([
      "setTransform", // identity, so the clear covers the whole backing store
      "clearRect",
      "setTransform", // the viewport, so the game draws in logical coordinates
      "fillRect", // the game's own draw
      "setTransform", // identity again, so the overlay is chrome in device pixels
    ]);
    expect(screen.ops[0]?.transform).toEqual(IDENTITY);
    // The game drew under the letterboxed, device-pixel-ratio-aware transform.
    expect(screen.ops[3]?.transform).toEqual(VIEWPORT_TRANSFORM);
    expect(screen.ops[4]?.transform).toEqual(IDENTITY);
  });

  it("clears the screen layer rather than filling it, whatever the background is", async () => {
    // The background belongs to the canvas the scene is drawn on. A screen layer
    // filled with it would be an opaque sheet drawn over the picture at the end of
    // the frame, and the game would appear to render nothing at all.
    const { engine, screen } = build({ background: "#101018" });
    await engine.initialize();
    screen.forget();

    await engine.advance(1);

    expect(screen.names()).toEqual(["setTransform", "clearRect", "setTransform", "setTransform"]);
    expect(screen.opsOf("fillRect")).toEqual([]);
  });

  it("clears the whole canvas to the background, letterbox bars included", async () => {
    const { engine, gl } = build({ background: "#102030" });
    await engine.initialize();
    gl.forget();

    await engine.advance(1);

    const cleared = gl.callsTo("clearColor")[0]?.args as number[];
    expect(cleared[0]).toBeCloseTo(0x10 / 0xff, 4);
    expect(cleared[3]).toBe(1);
  });

  it("clears to transparency when the build named no background", async () => {
    const { engine, gl } = build();
    await engine.initialize();
    gl.forget();

    await engine.advance(1);

    expect((gl.callsTo("clearColor")[0]?.args as number[])[3]).toBe(0);
  });

  it("resyncs both canvases every frame, so a resize needs no handler", async () => {
    const base = createStage();
    const { surface, resize } = mutableSurface(base.surface);
    const engine = createEngine<TestState, unknown>({
      canvas: base.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game: testGame(),
      clock: new ConstantClock(16),
      surface: surface.surface,
      screen: base.screen.canvas,
    });
    engines.push(engine as unknown as Engine<never>);
    await engine.initialize();

    resize(400, 400);
    await engine.advance(1);

    // 400x400 CSS at a ratio of 2: an 800x800 store, a 400x200 field fitted on the
    // width, and the spare height split into two bars.
    expect(base.stage.canvas.width).toBe(800);
    expect(base.screen.canvas.width).toBe(800);
    expect(base.screen.canvas.height).toBe(base.stage.canvas.height);
    expect(engine.viewport()).toEqual({
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      scale: 2,
      offsetX: 0,
      offsetY: 200,
    });
  });

  it("reports the new fit to the game's own update, in the frame it changed", async () => {
    const base = createStage();
    const { surface, resize } = mutableSurface(base.surface);
    const seen: number[] = [];
    const game = testGame({
      update: (_state, api) => {
        seen.push(api.viewport().scale);
      },
    });
    const engine = createEngine<TestState, unknown>({
      canvas: base.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game,
      clock: new ConstantClock(16),
      surface: surface.surface,
      screen: base.screen.canvas,
    });
    engines.push(engine as unknown as Engine<never>);
    await engine.initialize();

    await engine.advance(1);
    resize(400, 400);
    await engine.advance(1);

    // The resync is step 3 and the update is step 5, so the frame the element
    // changed on is already fitted to it.
    expect(seen).toEqual([4, 2]);
  });

  it("renders the scene through the camera the game posed on the same frame", async () => {
    const game = testGame({
      render: (state, api) => {
        api.camera.position.set(state.updates, 0, 5);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(2);

    // Step 7 follows step 6, so the reading the view answers from is the pose the
    // frame's own render wrote — not the one before it.
    expect(engine.view().camera().position).toEqual({ x: 2, y: 0, z: 5 });
    expect(engine.camera.position.toArray()).toEqual([2, 0, 5]);
  });

  it("answers a render's own view() from the previous frame's camera", async () => {
    const seen: CameraSnapshot[] = [];
    const game = testGame({
      render: (state, api) => {
        seen.push(api.view().camera());
        api.camera.position.set(state.updates, 0, 10);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(3);

    // The engine takes its reading after `render` returns, so the first frame reads
    // the defaults and each later frame reads what its predecessor posed.
    expect(seen.map((camera) => camera.position.x)).toEqual([0, 1, 2]);
  });

  it("answers an update's view() from the camera the player is looking through", async () => {
    const seen: number[] = [];
    const game = testGame({
      update: (_state, api) => {
        seen.push(api.view().camera().position.x);
      },
      render: (state, api) => {
        api.camera.position.set(state.updates * 10, 0, 10);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(3);

    // A pick made in step 5 is resolved against the picture on the screen, which is
    // the one the previous frame drew.
    expect(seen).toEqual([0, 10, 20]);
  });

  it("updates world matrices before the reading, so a moved parent is not a frame behind", async () => {
    const parent = new THREE.Group();
    const child = box();
    child.name = "child";
    child.position.set(1, 0, 0);
    parent.add(child);
    const game = testGame({
      initialize: (api) => {
        api.scene.add(parent);
      },
      render: (state) => {
        parent.position.set(state.updates * 2, 0, 0);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(1);

    const world = new THREE.Vector3();
    engine.scene.getObjectByName("child")?.getWorldPosition(world);
    expect(world.toArray()).toEqual([3, 0, 0]);
  });

  it("holds a perspective camera's aspect at the design aspect whatever the element's shape", async () => {
    const base = createStage();
    const { surface, resize } = mutableSurface(base.surface);
    const engine = createEngine<TestState, unknown>({
      canvas: base.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game: testGame({
        render: (_state, api) => {
          (api.camera as THREE.PerspectiveCamera).aspect = 0.25;
        },
      }),
      clock: new ConstantClock(16),
      surface: surface.surface,
      screen: base.screen.canvas,
    });
    engines.push(engine as unknown as Engine<never>);
    await engine.initialize();

    resize(300, 900);
    await engine.advance(1);

    expect((engine.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(
      DESIGN_WIDTH / DESIGN_HEIGHT,
      12,
    );
  });

  it("moves the audio listener to the camera the frame drew through", async () => {
    let audio: UpdateApi["audio"] | null = null;
    const game = testGame({
      initialize: (api) => {
        api.audio.define("hum", { freq: 110, durationMs: 10 });
      },
      update: (_state, api) => {
        audio = api.audio;
      },
      render: (state, api) => {
        api.camera.position.set(0, state.updates, 0);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    await engine.advance(2);

    // The bus is silent under jsdom, so what is asserted is the pose reaching it:
    // the listener follows the same reading the view answers from, which the frame
    // took after the render that posed the camera.
    expect(audio).not.toBeNull();
    expect(engine.view().camera().position).toEqual({ x: 0, y: 2, z: 0 });
  });

  it("draws the overlay over the finished picture once it is switched on", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("score", () => 7);
      },
    });
    const { engine, screen, target } = build({ game });
    await engine.initialize();

    await engine.advance(1);
    expect(screen.names()).not.toContain("fillText");

    // The engine owns the backtick key, and it is engine chrome rather than a
    // registered action, so the game's own vocabulary stays exactly its own.
    pressOverlayKey(target);
    screen.forget();
    await engine.advance(1);

    const text = screen.opsOf("fillText");
    expect(text.length).toBeGreaterThan(0);
    // Chrome is drawn in device pixels, on top of the frame, not in the game's
    // letterboxed coordinates.
    expect(text[0]?.transform).toEqual(IDENTITY);
    expect(overlayText(screen)).toContain("score: 7");

    pressOverlayKey(target);
    screen.forget();
    await engine.advance(1);
    expect(screen.names()).not.toContain("fillText");
  });

  it("reports the scene's draw counts on the overlay, not the composite's quad", async () => {
    const game = testGame({
      initialize: (api) => {
        api.scene.add(box());
      },
    });
    const { engine, screen, target } = build({ game });
    await engine.initialize();
    pressOverlayKey(target);

    await engine.advance(1);
    screen.forget();
    await engine.advance(1);

    // three resets `renderer.info` at the top of every `render` call and the engine
    // makes two per frame, so a panel reading the renderer live would say one draw
    // and two triangles for every frame however much the game submitted.
    const metrics = overlayText(screen).find((line) => line.startsWith("frame:"));
    expect(metrics).toContain("1 draws · 12 tris");
  });

  it("composites the screen layer after the overlay has drawn on it", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("score", () => 7);
      },
    });
    const { engine, screen, gl, target } = build({ game });
    await engine.initialize();
    pressOverlayKey(target);

    let drawsWhenOverlayDrew = -1;
    const ctx = screen.ctx;
    const realFillText = ctx.fillText.bind(ctx);
    ctx.fillText = ((text: string, x: number, y: number): void => {
      if (drawsWhenOverlayDrew < 0) {
        drawsWhenOverlayDrew = gl.callsTo("drawElements").length;
      }
      realFillText(text, x, y);
    }) as CanvasRenderingContext2D["fillText"];

    gl.forget();
    await engine.advance(1);

    // The scene is empty, so the only geometry drawn all frame is the composite's
    // full-canvas quad — and it had not been drawn yet when the overlay wrote its
    // first line.
    expect(drawsWhenOverlayDrew).toBe(0);
    expect(gl.callsTo("drawElements").length).toBe(1);
  });

  it("hands each diagnostic source the state current at the read", async () => {
    const game = testGame({
      initialize: (api) => {
        // A source reads the state it is handed — not the object `initialize`
        // built, which every frame since has replaced.
        api.diagnostics.register("updates", (state) => state.updates);
      },
    });
    const { engine, screen, target } = build({ game });
    await engine.initialize();
    pressOverlayKey(target);

    await engine.advance(3);
    engine.apply((state) => ({ ...state, updates: 50 }));
    screen.forget();
    await engine.advance(1);

    expect(overlayText(screen)).toContain("updates: 51");
  });

  it("ignores an auto-repeat of the overlay key, so holding it does not strobe", async () => {
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const { engine, screen, target } = build({ game });
    await engine.initialize();

    pressOverlayKey(target, true);
    await engine.advance(1);

    expect(screen.names()).not.toContain("fillText");
  });

  it("consumes an input edge exactly once, in the frame it belongs to", async () => {
    const pressedIn: number[] = [];
    const game = testGame({
      initialize: (api) => {
        api.input.register("fire", { keys: ["KeyF"] });
      },
      update: (state, api) => {
        if (api.input.pressed("fire")) pressedIn.push(state.updates);
      },
    });
    const { engine, target } = build({ game });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    await engine.advance(3);

    expect(pressedIn).toEqual([1]);
  });

  it("closes the frame, so an edge the game did not poll does not surface later", async () => {
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
    const { engine, target } = build({ game });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    await engine.advance(3);

    expect(pressedIn).toEqual([]);
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
    const { engine, target } = build({ game });
    await engine.initialize();

    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    await engine.advance(2);
    target.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    await engine.advance(1);

    expect(values).toEqual([1, 1, 0]);
  });

  it("maps a pointer into the game's own logical coordinates through the live fit", async () => {
    const seen: { x: number; y: number }[] = [];
    const game = testGame({
      update: (_state, api) => {
        const pointer = api.input.pointer();
        seen.push({ x: pointer.x, y: pointer.y });
      },
    });
    const { engine, target } = build({ game });
    await engine.initialize();

    // 800x600 CSS, a 400x200 field at 4 device pixels per unit with a 200-device
    // pixel bar: the centre of the element is the centre of the field.
    // A plain event carrying the pointer fields, since jsdom implements no
    // `PointerEvent` constructor and the engine reads the fields rather than the
    // class.
    target.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 400, clientY: 300 }),
    );
    await engine.advance(1);

    expect(seen[0]?.x).toBeCloseTo(DESIGN_WIDTH / 2, 6);
    expect(seen[0]?.y).toBeCloseTo(DESIGN_HEIGHT / 2, 6);
  });

  it("gives update no way to draw and render no way to read input or play a cue", async () => {
    let update: UpdateApi | undefined;
    let render: RenderApi | undefined;
    const game = testGame({
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

    expect([...Object.keys(update ?? {})].sort()).toEqual([
      "audio",
      "frame",
      "input",
      "view",
      "viewport",
    ]);
    expect([...Object.keys(render ?? {})].sort()).toEqual([
      "camera",
      "frame",
      "scene",
      "screen",
      "view",
      "viewport",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* engine.view                                                                */
/* -------------------------------------------------------------------------- */

describe("engine.view", () => {
  it("answers from the camera defaults before the first render", () => {
    const { engine } = build();
    const camera = engine.view().camera();

    expect(camera).toMatchObject({
      projection: "perspective",
      position: { x: 0, y: 0, z: 10 },
      fov: 60,
      near: 0.1,
      far: 1000,
      zoom: 1,
    });
  });

  it("does not follow a pose until the frame that drew with it ends", async () => {
    const { engine } = build();
    await engine.initialize();

    engine.camera.position.set(9, 9, 9);

    // A pose reaches the view when the frame that drew with it ends, not when it is
    // written, so a validator that poses the camera and reads the view without
    // advancing is told the reading the engine actually last drew through.
    expect(engine.view().camera().position).toEqual({ x: 0, y: 0, z: 10 });
    await engine.advance(1);
    expect(engine.view().camera().position).toEqual({ x: 9, y: 9, z: 9 });
  });

  it("hands back a snapshot rather than the camera, so a later frame cannot rewrite it", async () => {
    const game = testGame({
      render: (state, api) => {
        api.camera.position.set(state.updates, 0, 10);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);

    const held = engine.view().camera();
    await engine.advance(1);

    expect(held.position).toEqual({ x: 1, y: 0, z: 10 });
    expect(engine.view().camera().position).toEqual({ x: 2, y: 0, z: 10 });
  });

  it("projects a world point onto the logical field through the camera it read", async () => {
    const { engine } = build();
    await engine.initialize();
    await engine.advance(1);

    // The default camera sits at `+Z` looking at the origin, so the origin lands in
    // the middle of the field and is in view.
    const projected = engine.view().project({ x: 0, y: 0, z: 0 });
    expect(projected.x).toBeCloseTo(DESIGN_WIDTH / 2, 6);
    expect(projected.y).toBeCloseTo(DESIGN_HEIGHT / 2, 6);
    expect(projected.visible).toBe(true);

    // A point behind the camera is reported with a position and marked out of view.
    expect(engine.view().project({ x: 0, y: 0, z: 100 }).visible).toBe(false);
  });

  it("picks into the world along a ray from the stage point", async () => {
    const { engine } = build();
    await engine.initialize();
    await engine.advance(1);

    const ray = engine.view().ray(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    // Straight down `-Z`, which is where the default camera is looking.
    expect(ray.direction.x).toBeCloseTo(0, 6);
    expect(ray.direction.y).toBeCloseTo(0, 6);
    expect(ray.direction.z).toBeCloseTo(-1, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* engine.diagnostics                                                         */
/* -------------------------------------------------------------------------- */

describe("engine.diagnostics", () => {
  it("reports every registered source against the current state, in registration order", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("phase", () => "rally");
        api.diagnostics.register("updates", (state) => state.updates);
        api.diagnostics.register("started", (state) => state.updates > 0);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    expect(engine.diagnostics()).toEqual([
      { name: "phase", value: "rally" },
      { name: "updates", value: 0 },
      { name: "started", value: false },
    ]);

    // The state each source is handed is the one the most recent frame left, not the
    // object `initialize` built.
    await engine.advance(2);
    expect(engine.diagnostics()).toEqual([
      { name: "phase", value: "rally" },
      { name: "updates", value: 2 },
      { name: "started", value: true },
    ]);

    engine.apply((state) => ({ ...state, updates: 50 }));
    expect(engine.diagnostics()).toEqual([
      { name: "phase", value: "rally" },
      { name: "updates", value: 50 },
      { name: "started", value: true },
    ]);
  });

  it("reads a hidden overlay, and reading draws nothing and advances nothing", async () => {
    const game = testGame({
      initialize: (api) =>
        api.diagnostics.register("updates", (state) => state.updates),
    });
    const { engine, screen } = build({ game });
    await engine.initialize();
    await engine.advance(3);

    const before = engine.frame();
    const state = engine.state;
    screen.forget();

    expect(engine.diagnostics()).toEqual([{ name: "updates", value: 3 }]);
    expect(engine.diagnostics()).toEqual([{ name: "updates", value: 3 }]);

    // The overlay was never switched on, and a read neither switches it on nor
    // draws: what a check reads is what the game registered, not what a panel
    // happened to draw.
    expect(screen.ops).toEqual([]);
    expect(engine.frame()).toEqual(before);
    expect(engine.state).toEqual(state);
  });

  it("reports a throwing source as an error with no value, and reads the rest", async () => {
    const game = testGame({
      initialize: (api) => {
        api.diagnostics.register("ok", () => "fine");
        api.diagnostics.register("boom", () => {
          throw new Error("no crate yet");
        });
        api.diagnostics.register("after", (state) => state.updates);
      },
    });
    const { engine } = build({ game });
    await engine.initialize();

    const readings = engine.diagnostics();

    expect(readings).toEqual([
      { name: "ok", value: "fine" },
      { name: "boom", error: "no crate yet" },
      { name: "after", value: 0 },
    ]);
    expect(readings[1]).not.toHaveProperty("value");
  });

  it("reports nothing for a game that registered nothing", async () => {
    const { engine } = build();
    await engine.initialize();
    await engine.advance(1);

    expect(engine.diagnostics()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* run                                                                        */
/* -------------------------------------------------------------------------- */

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

    // Both frames ran. The first threw before returning a state, so the engine kept
    // the one it had, and only the second's update counted.
    expect(engine.frame().count).toBe(2);
    expect(engine.state.updates).toBe(1);
  });

  it("propagates a missing state to the host and keeps the state it had", async () => {
    const game: Game<TestState, null> = {
      initialize: () => [{ dts: [], updates: 0 }, null],
      update: (state) =>
        (state.updates === 0
          ? undefined
          : state) as unknown as TestState,
      render: () => {},
    };
    const { engine } = build({ game });
    const opening = await engine.initialize();
    void engine.run();

    expect(() => raf.tick(16)).toThrow(/must return the next state/);

    expect(engine.state).toBe(opening);
    // The loop scheduled the next frame regardless, which is what keeps one bad
    // frame from freezing the game permanently.
    expect(raf.pending()).toBe(1);
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

/* -------------------------------------------------------------------------- */
/* destroy                                                                    */
/* -------------------------------------------------------------------------- */

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
    const game = testGame({
      initialize: (api) => {
        api.input.register("fire", { keys: ["KeyF"] });
        api.diagnostics.register("score", () => 7);
      },
    });
    const { engine, screen, target } = build({ game });
    await engine.initialize();
    engine.destroy();

    let unlocks = 0;
    engine.events.on("audio:unlocked", () => {
      unlocks += 1;
    });
    target.dispatchEvent(new Event("pointerdown"));
    pressOverlayKey(target);
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    screen.forget();

    // Nothing reached the engine: no unlock, no overlay, and no frames to draw one.
    expect(unlocks).toBe(0);
    expect(screen.ops).toEqual([]);
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

  it("stops every loop, so a cue cannot outlive the engine that started it", async () => {
    let audio: UpdateApi["audio"] | null = null;
    const game = testGame({
      initialize: (api) => api.audio.define("hum", { freq: 110, durationMs: 10 }),
      update: (_state, api) => {
        audio = api.audio;
        api.audio.loop("hum");
      },
    });
    const { engine } = build({ game });
    await engine.initialize();
    await engine.advance(1);
    const bus = audio as unknown as UpdateApi["audio"];
    expect(bus.looping("hum")).toBe(true);

    engine.destroy();

    expect(bus.looping("hum")).toBe(false);
  });

  it("disposes the renderer, giving the browser back what it lent", async () => {
    // Recording everything the stub was asked, rather than the handful of drawing
    // calls the other tests read, because what disposal looks like from outside a
    // renderer is precisely the deletions it issues on the way out.
    const rig = createStage({ gl: { record: "all", maxCalls: 100_000 } });
    const engine = createEngine<TestState, unknown>({
      canvas: rig.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      game: testGame({
        initialize: (api) => {
          api.scene.add(box());
        },
      }),
      clock: new ConstantClock(16),
      surface: rig.surface.surface,
      screen: rig.screen.canvas,
    });
    engines.push(engine as unknown as Engine<never>);
    await engine.initialize();
    await engine.advance(1);
    rig.stage.gl.forget();

    engine.destroy();
    const once = rig.stage.gl.callsTo("deleteProgram").length;
    engine.destroy();

    expect(once).toBeGreaterThan(0);
    // Idempotent all the way down: a second teardown deletes nothing a second time.
    expect(rig.stage.gl.callsTo("deleteProgram").length).toBe(once);
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

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/** A rig whose host has WebCodecs and whose every canvas answers `getContext`. */
function recordingRig(options: Partial<EngineOptions<TestState, unknown>> = {}): Rig & {
  codecs: InstalledCodecs;
  /** What was drawn onto the recorder's own capture canvas, in order. */
  composed(canvas: HTMLCanvasElement): Context2dStub;
} {
  // Installed before the canvases are built so the recorder's own capture canvas —
  // which it creates from the document rather than being handed — answers
  // `getContext` too.
  const contexts = installCanvasContexts();
  teardown.push(() => {
    contexts.uninstall();
  });
  const codecs = installCodecs();
  teardown.push(() => {
    codecs.uninstall();
  });
  return {
    ...build({ clock: new ConstantClock(20), ...options }),
    codecs,
    composed: (canvas: HTMLCanvasElement): Context2dStub => {
      const stub = contexts.context2dFor(canvas);
      if (stub === undefined) {
        throw new Error("that canvas was never asked for a 2d context");
      }
      return stub;
    },
  };
}

describe("recording", () => {
  it("refuses to arm where the host has no VideoEncoder, naming WebCodecs", async () => {
    const { engine } = build();
    await engine.initialize();

    expect(() => engine.startRecording()).toThrow(/WebCodecs/);
    expect(engine.recording()).toBe(false);
  });

  it("records nothing until it is armed", async () => {
    const { engine } = recordingRig();
    await engine.initialize();
    await engine.advance(2);

    expect(engine.recording()).toBe(false);
    engine.startRecording();
    expect(engine.recording()).toBe(true);
    expect((await engine.stopRecording()).frames).toEqual([]);
    expect(engine.recording()).toBe(false);
  });

  it("captures one frame per advanced frame, with the clock's own deltas", async () => {
    const { engine } = recordingRig();
    await engine.initialize();
    engine.startRecording();
    await engine.advance(3);
    const recording = await engine.stopRecording();

    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(recording.frames.map((frame) => frame.deltaMs)).toEqual([20, 20, 20]);
    expect(recording.frames.map((frame) => frame.timeMs)).toEqual([20, 40, 60]);
    expect(recording.ended).toBe(false);
  });

  it("reports the stage canvas's backing store as the recording's size", async () => {
    const { engine, canvas } = recordingRig();
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = await engine.stopRecording();

    expect(recording.width).toBe(canvas.width);
    expect(recording.height).toBe(canvas.height);
    expect(recording.video.byteLength).toBeGreaterThan(0);
  });

  it("composes each frame from the stage canvas and the screen layer over it", async () => {
    const rig = recordingRig();
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(1);

    const source = rig.codecs.frames[0]?.source;
    expect(source).toBeInstanceOf(HTMLCanvasElement);
    const composed = rig.composed(source as HTMLCanvasElement);
    expect(composed.names()).toEqual(["clearRect", "drawImage", "drawImage"]);
    expect(composed.opsOf("drawImage")[0]?.args[0]).toBe(rig.canvas);
    expect(composed.opsOf("drawImage")[1]?.args[0]).toBe(rig.screenCanvas);

    await rig.engine.stopRecording();
  });

  it("holds the picture the game submitted and nothing of the overlay", async () => {
    // The recorder captures between the scene render and the panel, so the frame it
    // composed was taken while the screen layer held only what the game drew.
    const game = testGame({
      initialize: (api) => api.diagnostics.register("score", () => 7),
    });
    const rig = recordingRig({ game });
    await rig.engine.initialize();
    pressOverlayKey(rig.target);

    let capturedWhenOverlayDrew = -1;
    const ctx = rig.screen.ctx;
    const realFillText = ctx.fillText.bind(ctx);
    ctx.fillText = ((text: string, x: number, y: number): void => {
      if (capturedWhenOverlayDrew < 0) {
        capturedWhenOverlayDrew = rig.codecs.frames.length;
      }
      realFillText(text, x, y);
    }) as CanvasRenderingContext2D["fillText"];

    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = await rig.engine.stopRecording();

    expect(recording.frames).toHaveLength(1);
    // The frame was already in the encoder's hands when the panel wrote its first
    // line, so a reviewer's evidence carries no debug chrome.
    expect(capturedWhenOverlayDrew).toBe(1);
  });

  it("records only the frames between arming and disarming", async () => {
    const { engine } = recordingRig();
    await engine.initialize();
    await engine.advance(5);
    engine.startRecording();
    await engine.advance(2);
    const recording = await engine.stopRecording();
    await engine.advance(3);

    expect(recording.frames.map((frame) => frame.count)).toEqual([6, 7]);
  });

  it("begins at the next frame when the game arms itself from inside update", async () => {
    // The engine captures near the end of a frame, so a game that arms the recorder
    // from that same frame's `update` has been watched for only the tail of it. The
    // recording holds whole frames, and this one begins at frame three.
    let engine: Engine<TestState, unknown> | null = null;
    const game = testGame({
      update: (state) => {
        if (state.updates === 2) engine?.startRecording();
        return state;
      },
    });
    const rig = recordingRig({ game });
    engine = rig.engine;
    await rig.engine.initialize();
    await rig.engine.advance(4);
    const recording = await rig.engine.stopRecording();

    expect(recording.frames.map((frame) => frame.count)).toEqual([3, 4]);
  });

  it("begins at the next frame when the game arms itself from inside render", async () => {
    // `render` runs later still — the composed picture is taken a few statements
    // after the game returns from it — so the boundary has to hold from here too.
    let engine: Engine<TestState, unknown> | null = null;
    const game = testGame({
      render: (state) => {
        if (state.updates === 1) engine?.startRecording();
      },
    });
    const rig = recordingRig({ game });
    engine = rig.engine;
    await rig.engine.initialize();
    await rig.engine.advance(3);
    const recording = await rig.engine.stopRecording();

    expect(recording.frames.map((frame) => frame.count)).toEqual([2, 3]);
  });

  it("closes every VideoFrame it opened", async () => {
    const rig = recordingRig();
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(3);
    await rig.engine.stopRecording();

    expect(rig.codecs.frames).toHaveLength(3);
    for (const frame of rig.codecs.frames) expect(frame.closed).toBe(true);
  });

  it("refuses an unbalanced call rather than discarding or inventing frames", async () => {
    const { engine } = recordingRig();
    await engine.initialize();

    expect(() => engine.stopRecording()).toThrow(/while not recording/);
    engine.startRecording();
    expect(() => engine.startRecording()).toThrow(/while already recording/);
    await engine.stopRecording();
  });

  it("discards an armed capture when the engine is destroyed", async () => {
    const rig = recordingRig();
    await rig.engine.initialize();
    rig.engine.startRecording();
    await rig.engine.advance(2);

    rig.engine.destroy();

    expect(rig.engine.recording()).toBe(false);
    // Nothing was flushed: the frames were evidence for a check that is no longer
    // running, and the encoder was asked to release what it held.
    expect(rig.codecs.encoder()?.flushes).toBe(0);
    expect(rig.codecs.encoder()?.closes).toBeGreaterThan(0);
  });
});
