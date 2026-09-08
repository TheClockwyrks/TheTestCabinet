import { describe, expect, it, vi } from "vitest";
import { Actor, Pawn } from "./actors";
import { WorldCamera } from "./camera";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import type {
  DiagnosticValue,
  EndPlayReason,
  Engine,
  EngineEventMap,
  EngineOptions,
  GameDefinition,
  InitApi,
  World,
} from "./contract";
import {
  assembleEngine,
  createEngine,
  EngineEventBus,
  type EngineHost,
  type EngineSubsystems,
  type PendingTransition,
  type WorldDriver,
} from "./engine";
import { GameInstance } from "./game-instance";
import { GameMode } from "./game-mode";

/**
 * Two suites in one file, split by what stands behind the engine.
 *
 * The unit half drives `assembleEngine` over fake subsystems, so what is
 * asserted is the engine's own work: the validation, the gates, the frame
 * order, the loop, the recorder wiring, and the teardown. The integration half
 * drives `createEngine` — the real subsystems, the real worlds — through the
 * documentation's own minimal game, so the wiring the shipped factory does is
 * exercised end to end.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A canvas reduced to what the engine reads: a context, a size, a style. */
function fakeCanvas(log: string[] = []): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
  };
  const method =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(`ctx:${name}(${args.map(String).join(",")})`);
    };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "save",
    "restore",
  ]) {
    ctx[name] = method(name);
  }
  canvas["getContext"] = (kind: string): unknown =>
    kind === "2d" ? ctx : null;
  return canvas as unknown as HTMLCanvasElement;
}

/** A surface with no document behind it: fixed measurements, one event target. */
function fakeSurface(target: EventTarget = new EventTarget()) {
  return {
    cssWidth: (): number => 320,
    cssHeight: (): number => 180,
    dpr: (): number => 2,
    events: (): EventTarget => target,
  };
}

/** A world reduced to what the pipeline and the overlay read. */
function bareWorld(level: string): World {
  return {
    level,
    actors: (): readonly Actor[] => [],
    camera: new WorldCamera(640, 360),
    mode: { phase: "waiting" },
  } as unknown as World;
}

interface Fakes {
  subsystems: EngineSubsystems;
  /** Every observable act, engine-ordered: driver steps, ctx work, ports. */
  log: string[];
  /** Queue a transition for the next `takeTransition` read. */
  queueTransition(pending: PendingTransition): void;
  /** Make the next `open` wait until the returned release runs. */
  gateNextOpen(): () => void;
  registered: Array<[string, unknown]>;
  unlocks: number;
  toggles: number;
  samples: Array<[number, number]>;
}

/** The engine's collaborators as recording fakes over the documented ports. */
function fakes(log: string[] = []): Fakes {
  const queue: PendingTransition[] = [];
  let world: World | null = null;
  let gate: Promise<void> | null = null;
  const registered: Array<[string, unknown]> = [];
  const samples: Array<[number, number]> = [];

  const state = {
    unlocks: 0,
    toggles: 0,
  };

  const worlds: WorldDriver = {
    world: () => world,
    open: async (level): Promise<void> => {
      log.push(`open:${level}`);
      if (gate !== null) {
        const wait = gate;
        gate = null;
        await wait;
      }
      world = bareWorld(level);
      log.push(`opened:${level}`);
    },
    tick: (dt) => log.push(`tick:${dt}`),
    flushDestroyed: () => log.push("flush"),
    takeTransition: () => queue.shift() ?? null,
    close: () => log.push("close"),
  };

  const subsystems: EngineSubsystems = {
    input: {
      register: (name, binding) => registered.push([name, binding]),
      layout: () => null,
      endFrame: () => log.push("input.endFrame"),
      detach: () => log.push("input.detach"),
    },
    audio: {
      define: (cue, spec) => registered.push([cue, spec]),
      load: async () => undefined,
      unlock: () => {
        state.unlocks += 1;
      },
      silence: () => log.push("audio.silence"),
    },
    diagnostics: {
      registerInstance: (name, source) => registered.push([name, source]),
      read: () =>
        registered
          .filter(([, source]) => typeof source === "function")
          .map(([name, source]) => ({
            name,
            value: (source as () => DiagnosticValue)(),
          })),
      toggle: () => {
        state.toggles += 1;
      },
      draw: () => log.push("diagnostics.draw"),
      recordFrame: (atMs, costMs) => samples.push([atMs, costMs]),
    },
    assets: {
      loadImage: () => Promise.reject(new Error("no images here")),
      loadAudio: () => Promise.reject(new Error("no audio here")),
      load: () => Promise.reject(new Error("no assets here")),
      resolve: (path) => `assets/${path}`,
    },
    worlds,
  };

  return {
    subsystems,
    log,
    queueTransition: (pending) => queue.push(pending),
    gateNextOpen: (): (() => void) => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    registered,
    get unlocks() {
      return state.unlocks;
    },
    get toggles() {
      return state.toggles;
    },
    samples,
  };
}

/** One trivial definition the unit half reuses; the fake driver ignores it. */
function definition(): GameDefinition {
  return { levels: { main: { mode: GameMode } }, startLevel: "main" };
}

/** An engine over fakes, with everything defaulted and overridable. */
function build(
  overrides: Partial<EngineOptions> = {},
  host: EngineHost = {},
): { engine: Engine; fixture: Fakes } {
  const fixture = fakes();
  const engine = assembleEngine(
    {
      canvas: fakeCanvas(fixture.log),
      width: 640,
      height: 360,
      game: definition(),
      clock: new ConstantClock(10),
      surface: fakeSurface(),
      ...overrides,
    },
    () => fixture.subsystems,
    host,
  );
  return { engine, fixture };
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

describe("construction", () => {
  it("refuses a design size that is not finite and positive, naming it", () => {
    for (const [width, height] of [
      [0, 360],
      [640, -1],
      [Number.NaN, 360],
      [640, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => build({ width, height })).toThrowError(
        new RegExp(`${width}x${height}`.replace(/[+]/g, "\\+")),
      );
    }
  });

  it("refuses a canvas that yields no 2D context", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => build({ canvas })).toThrowError(/2D context/);
  });

  it("refuses a layout outside the catalogue, naming every valid layout", () => {
    expect(() => build({ layout: "gamepad" })).toThrowError(
      /"gamepad".*"dual-vertical".*"single-vertical".*"dpad-4".*"dpad-4-two-buttons"/s,
    );
  });

  it("refuses a level registry with no entries", () => {
    expect(() =>
      build({ game: { levels: {}, startLevel: "main" } }),
    ).toThrowError(/no entries/);
  });

  it("refuses a startLevel naming no entry, naming every registered level", () => {
    expect(() =>
      build({
        game: {
          levels: { title: { mode: GameMode }, match: { mode: GameMode } },
          startLevel: "arena",
        },
      }),
    ).toThrowError(/"arena".*"title", "match"/s);
  });

  it("runs no game code: nothing opens and nothing constructs before initialize", () => {
    const constructed = vi.fn();
    class Probe extends GameInstance<null> {
      constructor() {
        super();
        constructed();
      }
    }
    const { fixture } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    expect(constructed).not.toHaveBeenCalled();
    expect(fixture.log.filter((entry) => entry.startsWith("open:"))).toEqual(
      [],
    );
  });

  it("is subscribable and reclockable from construction", () => {
    const { engine } = build();
    const off = engine.events.on("world:opened", () => undefined);
    expect(typeof off).toBe("function");
    engine.setClock(new ConstantClock(5));
  });
});

/* -------------------------------------------------------------------------- */
/* The gate                                                                   */
/* -------------------------------------------------------------------------- */

describe("the initialize gate", () => {
  it("refuses instance, world, and debug before initialize resolves, naming the ordering", () => {
    const { engine } = build();
    expect(() => engine.instance).toThrowError(/instance.*initialize/s);
    expect(() => engine.world).toThrowError(/world.*initialize/s);
    expect(() => engine.debug).toThrowError(/debug.*initialize/s);
  });

  it("refuses run and advance before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.run()).toThrowError(/run.*initialize/s);
    expect(() => engine.advance(1)).toThrowError(/advance.*initialize/s);
  });
});

/* -------------------------------------------------------------------------- */
/* initialize                                                                 */
/* -------------------------------------------------------------------------- */

describe("initialize", () => {
  it("builds the instance, runs its initialize, opens the start level, and resolves to it", async () => {
    const order: string[] = [];
    class Probe extends GameInstance<{ marked: boolean }> {
      override initialize(): { marked: boolean } {
        order.push("instance.initialize");
        return { marked: true };
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Probe,
        levels: { title: { mode: GameMode } },
        startLevel: "title",
      },
    });
    const instance = await engine.initialize();
    expect(instance).toBeInstanceOf(Probe);
    expect(order).toEqual(["instance.initialize"]);
    expect(fixture.log).toContain("open:title");
    expect(fixture.log.indexOf("open:title")).toBeGreaterThan(-1);
    expect(engine.instance).toBe(instance);
    expect(engine.debug).toEqual({ marked: true });
    expect(engine.world.level).toBe("title");
  });

  it("assigns the engine and the broadcaster before the instance's initialize runs", async () => {
    let seen: { engine: unknown; events: unknown } | null = null;
    class Probe extends GameInstance<null> {
      override initialize(): null {
        seen = { engine: this.engine, events: this.events };
        return null;
      }
    }
    const { engine } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    expect(seen).not.toBeNull();
    expect(seen!.engine).toBe(engine);
    expect(seen!.events).toBe(engine.events);
  });

  it("hands the instance the InitApi over the subsystems", async () => {
    class Probe extends GameInstance<null> {
      override initialize(api: InitApi): null {
        api.input.register("up", { keys: ["KeyW"] });
        api.audio.define("ping", { freq: 440, durationMs: 50 });
        api.diagnostics.register("score", () => 0);
        expect(api.assets.resolve("a.png")).toBe("assets/a.png");
        expect(api.viewport().width).toBe(640);
        return null;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    expect(fixture.registered.map(([name]) => name)).toEqual([
      "up",
      "ping",
      "score",
    ]);
  });

  it("defaults the instance class to GameInstance and the debug surface to its null", async () => {
    const { engine } = build();
    const instance = await engine.initialize();
    expect(instance).toBeInstanceOf(GameInstance);
    expect(engine.debug).toBeNull();
  });

  it("resolves a second call to the instance already built, without re-running anything", async () => {
    let runs = 0;
    class Probe extends GameInstance<null> {
      override initialize(): null {
        runs += 1;
        return null;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    const first = engine.initialize();
    const second = engine.initialize();
    expect(second).toBe(first);
    await first;
    expect(await engine.initialize()).toBe(await first);
    expect(runs).toBe(1);
    expect(fixture.log.filter((entry) => entry === "open:main")).toHaveLength(
      1,
    );
  });

  it("rejects with the cause when the instance's initialize throws", async () => {
    const cause = new Error("no assets today");
    class Probe extends GameInstance<null> {
      override initialize(): null {
        throw cause;
      }
    }
    const { engine } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await expect(engine.initialize()).rejects.toBe(cause);
    expect(() => engine.world).toThrowError(/initialize/);
  });

  it("rejects an initialize that returned undefined, naming the debug surface", async () => {
    class Probe extends GameInstance<null> {
      override initialize(): null {
        return undefined as unknown as null;
      }
    }
    const { engine } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await expect(engine.initialize()).rejects.toThrowError(
      /debug surface.*null/s,
    );
  });

  it("rejects when opening the start level rejects", async () => {
    const fixture = fakes();
    fixture.subsystems.worlds.open = () =>
      Promise.reject(new Error("load failed"));
    const engine = assembleEngine(
      {
        canvas: fakeCanvas(),
        width: 640,
        height: 360,
        game: definition(),
        clock: new ConstantClock(10),
        surface: fakeSurface(),
      },
      () => fixture.subsystems,
    );
    await expect(engine.initialize()).rejects.toThrowError(/load failed/);
  });
});

/* -------------------------------------------------------------------------- */
/* advance and the frame                                                      */
/* -------------------------------------------------------------------------- */

describe("advance", () => {
  it("refuses a count that is not a whole, non-negative number, naming the value", async () => {
    const { engine } = build();
    await engine.initialize();
    expect(() => engine.advance(1.5)).toThrowError(RangeError);
    expect(() => engine.advance(1.5)).toThrowError(/1\.5/);
    expect(() => engine.advance(-1)).toThrowError(RangeError);
    expect(() => engine.advance(Number.NaN)).toThrowError(RangeError);
  });

  it("runs nothing for advance(0)", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    const before = fixture.log.length;
    await engine.advance(0);
    expect(fixture.log.length).toBe(before);
    expect(engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
  });

  it("advances the counter, the accumulated time, and the last delta", async () => {
    const { engine } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(3);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 30, lastDeltaMs: 10 });
  });

  it("runs no frame for a tick the clock declines", async () => {
    let asked = 0;
    const clock = {
      delta: (): number | null => {
        asked += 1;
        return asked % 2 === 0 ? 8 : null;
      },
    };
    const { engine, fixture } = build({ clock });
    await engine.initialize();
    await engine.advance(4);
    expect(asked).toBe(4);
    expect(engine.frame()).toEqual({ count: 2, timeMs: 16, lastDeltaMs: 8 });
    expect(fixture.log.filter((entry) => entry === "tick:0.008")).toHaveLength(
      2,
    );
  });

  it("runs each frame's steps in order: ticks, flush, render, overlay, input close", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    fixture.log.length = 0;
    await engine.advance(1);

    const at = (entry: string): number =>
      fixture.log.findIndex((line) => line.startsWith(entry));
    expect(at("tick:0.01")).toBeGreaterThan(-1);
    expect(at("tick:0.01")).toBeLessThan(at("flush"));
    // The clear is the first thing the pipeline draws.
    expect(at("flush")).toBeLessThan(at("ctx:setTransform"));
    expect(at("ctx:clearRect")).toBeLessThan(at("diagnostics.draw"));
    expect(at("diagnostics.draw")).toBeLessThan(at("input.endFrame"));
    expect(fixture.log.at(-1)).toBe("input.endFrame");
  });

  it("hands the world driver seconds", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(25) });
    await engine.initialize();
    await engine.advance(1);
    expect(fixture.log).toContain("tick:0.025");
  });

  it("records what each frame cost, stamped with simulated time", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(2);
    expect(fixture.samples.map(([atMs]) => atMs)).toEqual([10, 20]);
  });

  it("swaps the clock in place, carrying the counters over", async () => {
    const { engine } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(2);
    engine.setClock(new ConstantClock(1));
    await engine.advance(3);
    expect(engine.frame()).toEqual({ count: 5, timeMs: 23, lastDeltaMs: 1 });
  });

  it("rejects and abandons the remaining frames when a tick throws", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    let ticks = 0;
    fixture.subsystems.worlds.tick = (): void => {
      ticks += 1;
      if (ticks === 2) throw new Error("boom on frame two");
    };
    await expect(engine.advance(5)).rejects.toThrowError(/boom on frame two/);
    expect(ticks).toBe(2);
    expect(engine.frame().count).toBe(2);
  });
});

describe("the transition inside a frame", () => {
  it("performs a requested transition before the frame renders, and renders the new world", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    fixture.queueTransition({ level: "arena", options: undefined });
    fixture.log.length = 0;
    await engine.advance(1);

    const openAt = fixture.log.indexOf("opened:arena");
    const clearAt = fixture.log.findIndex(
      (line) => line === "ctx:clearRect(0,0,640,360)",
    );
    expect(openAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(openAt);
    expect(engine.world.level).toBe("arena");
  });

  it("awaits an in-flight transition before the next frame begins", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    fixture.queueTransition({ level: "arena", options: undefined });
    const release = fixture.gateNextOpen();
    fixture.log.length = 0;

    const stepping = engine.advance(2);
    // One microtask breath: frame one has started its open and must not have
    // run frame two.
    await Promise.resolve();
    expect(fixture.log.filter((line) => line.startsWith("tick:"))).toHaveLength(
      1,
    );
    release();
    await stepping;
    expect(fixture.log.filter((line) => line.startsWith("tick:"))).toHaveLength(
      2,
    );
    expect(engine.frame().count).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* run                                                                        */
/* -------------------------------------------------------------------------- */

/** A hand-cranked host: the test fires each scheduled frame itself. */
function manualHost(): {
  host: EngineHost;
  fire(t?: number): void;
  scheduled(): number;
} {
  let queue: Array<(t: number) => void> = [];
  let stamp = 0;
  return {
    host: {
      raf: (cb): number => {
        queue.push(cb);
        return queue.length;
      },
      cancel: (): void => {
        queue = [];
      },
      now: (): number => stamp,
    },
    fire: (t?: number): void => {
      stamp = t ?? stamp + 16;
      const next = queue.shift();
      next?.(stamp);
    },
    scheduled: (): number => queue.length,
  };
}

describe("run", () => {
  it("drives one tick per host callback until the signal aborts, then resolves", async () => {
    const pump = manualHost();
    const { engine } = build({ clock: new ConstantClock(10) }, pump.host);
    await engine.initialize();

    const controller = new AbortController();
    const done = engine.run({ signal: controller.signal });
    pump.fire();
    pump.fire();
    expect(engine.frame().count).toBe(2);

    controller.abort();
    await done;
    // Halted: nothing scheduled runs a frame any more.
    pump.fire();
    expect(engine.frame().count).toBe(2);
    // The engine stays usable: stepping still works after an abort.
    await engine.advance(1);
    expect(engine.frame().count).toBe(3);
  });

  it("resolves immediately under a signal that has already aborted", async () => {
    const pump = manualHost();
    const { engine } = build({ clock: new ConstantClock(10) }, pump.host);
    await engine.initialize();
    const controller = new AbortController();
    controller.abort();
    await engine.run({ signal: controller.signal });
    pump.fire();
    expect(engine.frame().count).toBe(0);
  });

  it("shares one promise across concurrent calls, settled by one halt", async () => {
    const pump = manualHost();
    const { engine } = build({ clock: new ConstantClock(10) }, pump.host);
    await engine.initialize();
    const controller = new AbortController();
    const first = engine.run({ signal: controller.signal });
    const second = engine.run();
    expect(second).toBe(first);
    controller.abort();
    await Promise.all([first, second]);
  });

  it("resolves when the engine is destroyed", async () => {
    const pump = manualHost();
    const { engine } = build({ clock: new ConstantClock(10) }, pump.host);
    await engine.initialize();
    const done = engine.run();
    pump.fire();
    engine.destroy();
    await done;
  });

  it("runs no frame, and consults no clock, while a transition is in flight", async () => {
    const pump = manualHost();
    const deltas: number[] = [];
    const clock = {
      delta: (): number => {
        deltas.push(10);
        return 10;
      },
    };
    const { engine, fixture } = build({ clock }, pump.host);
    await engine.initialize();
    fixture.queueTransition({ level: "arena", options: undefined });
    const release = fixture.gateNextOpen();

    void engine.run();
    pump.fire();
    expect(deltas).toHaveLength(1);
    // The transition is in flight: further callbacks re-arm without a tick.
    pump.fire();
    pump.fire();
    expect(deltas).toHaveLength(1);

    release();
    // A macrotask, so the whole settle chain (the open, the frame's finish,
    // the loop's own bookkeeping) has drained before the next callback fires.
    await new Promise((resolve) => setTimeout(resolve, 0));
    pump.fire();
    expect(deltas).toHaveLength(2);
    engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* Recording, viewport, destroy, listeners                                     */
/* -------------------------------------------------------------------------- */

describe("image smoothing", () => {
  /** The property as the raw context holds it after a frame. */
  const smoothingOf = (canvas: HTMLCanvasElement): unknown =>
    (canvas.getContext("2d") as unknown as Record<string, unknown>)[
      "imageSmoothingEnabled"
    ];

  it("leaves smoothing on when the option is absent", async () => {
    const canvas = fakeCanvas();
    const { engine } = build({ canvas });
    await engine.initialize();
    await engine.advance(1);
    expect(smoothingOf(canvas)).toBe(true);
  });

  it("turns smoothing off for the whole picture when the option is false", async () => {
    const canvas = fakeCanvas();
    const { engine } = build({ canvas, imageSmoothing: false });
    await engine.initialize();
    await engine.advance(1);
    expect(smoothingOf(canvas)).toBe(false);
  });

  it("records the setting as a set inside every frame", async () => {
    const { engine } = build({ imageSmoothing: false });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();
    for (const frame of recording.frames) {
      const ops = frame.ops.map((at) => recording.ops[at]);
      expect(ops).toContainEqual({
        op: "set",
        property: "imageSmoothingEnabled",
        value: false,
      });
    }
  });
});

describe("recording through the engine", () => {
  it("refuses the unbalanced calls by name", async () => {
    const { engine } = build();
    expect(() => engine.stopRecording()).toThrowError(/not recording/);
    engine.startRecording();
    expect(() => engine.startRecording()).toThrowError(/already recording/);
    engine.stopRecording();
  });

  it("captures whole frames between start and stop, under the design size and background", async () => {
    const { engine } = build({
      clock: new ConstantClock(10),
      background: "#101018",
    });
    await engine.initialize();
    await engine.advance(1);

    expect(engine.recording()).toBe(false);
    engine.startRecording();
    expect(engine.recording()).toBe(true);
    await engine.advance(2);
    const recording = engine.stopRecording();
    expect(engine.recording()).toBe(false);

    expect(recording.format).toBe(1);
    expect(recording.width).toBe(640);
    expect(recording.height).toBe(360);
    expect(recording.background).toBe("#101018");
    expect(recording.frames.map((frame) => frame.count)).toEqual([2, 3]);
    expect(recording.frames.map((frame) => frame.timeMs)).toEqual([20, 30]);
    expect(recording.frames.map((frame) => frame.deltaMs)).toEqual([10, 10]);
    // The engine's own preparation is inside the bracket: the clear is there.
    expect(recording.frames[0]?.ops.length).toBeGreaterThan(0);
    const ops = recording.frames[0]?.ops.map((at) => recording.ops[at]) ?? [];
    expect(ops).toContainEqual({
      op: "call",
      method: "fillRect",
      args: [0, 0, 640, 360],
    });
  });
});

describe("viewport", () => {
  it("reports a real fit from construction, as a copy the caller owns", () => {
    const { engine } = build();
    const fit = engine.viewport();
    // 320×180 CSS at dpr 2 around a 640×360 field: scale 1, no bars.
    expect(fit).toEqual({
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    fit.scale = 99;
    expect(engine.viewport().scale).toBe(1);
  });
});

describe("destroy", () => {
  it("closes the world, shuts the instance down, silences, detaches, and clears — once", async () => {
    const shutdown = vi.fn();
    class Probe extends GameInstance<null> {
      override shutdown(): void {
        shutdown();
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Probe,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    const seen = vi.fn();
    engine.events.on("world:opened", seen);

    engine.destroy();
    engine.destroy();

    expect(fixture.log.filter((entry) => entry === "close")).toHaveLength(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(
      fixture.log.filter((entry) => entry === "audio.silence"),
    ).toHaveLength(1);
    expect(
      fixture.log.filter((entry) => entry === "input.detach"),
    ).toHaveLength(1);
    // The bus was cleared: a subsystem emitting afterwards reaches nobody.
    (engine.events as EngineEventBus).emit("world:opened", { level: "x" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("skips the world and the instance when neither was ever built", () => {
    const { engine, fixture } = build();
    engine.destroy();
    expect(fixture.log).not.toContain("close");
    expect(fixture.log).toContain("audio.silence");
  });

  it("resolves run and refuses nothing afterwards", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.destroy();
    await engine.run();
    await engine.advance(3);
    expect(engine.frame().count).toBe(0);
  });
});

describe("the engine's own listeners", () => {
  it("toggles the diagnostics overlay on an unrepeated Backquote", async () => {
    const target = new EventTarget();
    const fixture = fakes();
    assembleEngine(
      {
        canvas: fakeCanvas(),
        width: 640,
        height: 360,
        game: definition(),
        surface: fakeSurface(target),
      },
      () => fixture.subsystems,
    );
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    target.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Backquote", repeat: true }),
    );
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(fixture.toggles).toBe(1);
  });

  it("unlocks the audio bus on the first pointer or key event, once", () => {
    const target = new EventTarget();
    const fixture = fakes();
    assembleEngine(
      {
        canvas: fakeCanvas(),
        width: 640,
        height: 360,
        game: definition(),
        surface: fakeSurface(target),
      },
      () => fixture.subsystems,
    );
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(fixture.unlocks).toBe(1);
  });

  it("drops its listeners on destroy", () => {
    const target = new EventTarget();
    const fixture = fakes();
    const engine = assembleEngine(
      {
        canvas: fakeCanvas(),
        width: 640,
        height: 360,
        game: definition(),
        surface: fakeSurface(target),
      },
      () => fixture.subsystems,
    );
    engine.destroy();
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    target.dispatchEvent(new Event("pointerdown"));
    expect(fixture.toggles).toBe(0);
    expect(fixture.unlocks).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The broadcaster                                                            */
/* -------------------------------------------------------------------------- */

describe("EngineEventBus", () => {
  it("dispatches synchronously, in subscription order", () => {
    const bus = new EngineEventBus();
    const order: string[] = [];
    bus.on("world:opened", () => order.push("first"));
    bus.on("world:opened", () => order.push("second"));
    bus.emit("world:opened", { level: "x" });
    expect(order).toEqual(["first", "second"]);
  });

  it("contains a throwing handler and still runs the rest", () => {
    const bus = new EngineEventBus();
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const after = vi.fn();
    bus.on("world:opened", () => {
      throw new Error("subscriber bug");
    });
    bus.on("world:opened", after);
    bus.emit("world:opened", { level: "x" });
    expect(after).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("returns an idempotent unsubscribe that removes one subscription", () => {
    const bus = new EngineEventBus();
    const handler = vi.fn();
    bus.on("world:opened", handler);
    const off = bus.on("world:opened", handler);
    off();
    off();
    bus.emit("world:opened", { level: "x" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* End to end: the real subsystems                                            */
/* -------------------------------------------------------------------------- */

const BOX = 48;
const SPEED = 220;

/** The documentation's minimal game, verbatim in everything that matters. */
class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: BOX, height: BOX },
        fill: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const half = BOX / 2;
    const limit = this.world.viewport().width - half;
    this.transform.x += this.vx * dt;

    if (this.transform.x < half) {
      this.transform.x = 2 * half - this.transform.x;
      this.vx = SPEED;
    } else if (this.transform.x > limit) {
      this.transform.x = 2 * limit - this.transform.x;
      this.vx = -SPEED;
    }
  }
}

class DriftMode extends GameMode {}

function drifterGame(): GameDefinition {
  return {
    levels: {
      drift: {
        mode: DriftMode,
        actors: [{ type: Drifter, transform: { x: 320, y: 180 } }],
      },
    },
    startLevel: "drift",
  };
}

/** A real engine over the shipped subsystems, with only the DOM faked. */
function real(overrides: Partial<EngineOptions> = {}): Engine {
  return createEngine({
    canvas: fakeCanvas(),
    width: 640,
    height: 360,
    background: "#05060a",
    game: drifterGame(),
    clock: new ConstantClock(1000 / 60),
    surface: fakeSurface(),
    ...overrides,
  });
}

describe("end to end over the real subsystems", () => {
  it("runs the documentation's minimal game", async () => {
    const engine = real();
    const opened: string[] = [];
    engine.events.on("world:opened", ({ level }) => opened.push(level));

    await engine.initialize();
    expect(opened).toEqual(["drift"]);
    expect(engine.world.level).toBe("drift");
    expect(engine.world.actors()).toHaveLength(1);

    await engine.advance(60);
    const [drifter] = engine.world.ofType(Drifter);
    // One second at 220 units/s from the field's center, no wall reached.
    expect(drifter?.transform.x).toBeCloseTo(320 + SPEED, 5);
    expect(engine.frame().count).toBe(60);
    expect(engine.world.time).toBeCloseTo(1, 9);
    engine.destroy();
  });

  it("announces the start level being built to a subscriber from before initialize", async () => {
    const engine = real();
    const events: Array<[string, unknown]> = [];
    engine.events.on("world:opening", (event) =>
      events.push(["opening", event]),
    );
    engine.events.on("actor:spawned", () => events.push(["spawned", null]));
    engine.events.on("world:opened", (event) => events.push(["opened", event]));
    await engine.initialize();

    expect(events[0]).toEqual(["opening", { from: null, to: "drift" }]);
    expect(events.some(([name]) => name === "spawned")).toBe(true);
    expect(events.at(-1)).toEqual(["opened", { level: "drift" }]);
    engine.destroy();
  });

  it("performs a mid-run transition: fresh world, carried counters, restarted world time", async () => {
    class HopMode extends GameMode {
      override tick(): void {
        if (this.world.level === "a") this.world.open("b", { carried: 7 });
      }
    }
    const engine = real({
      game: {
        levels: { a: { mode: HopMode }, b: { mode: HopMode } },
        startLevel: "a",
      },
    });
    const names: string[] = [];
    engine.events.on("world:opening", ({ from, to }) =>
      names.push(`${from}->${to}`),
    );
    engine.events.on("world:closed", ({ level }) =>
      names.push(`closed:${level}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      names.push(`opened:${level}`),
    );

    await engine.initialize();
    const first = engine.world;
    await engine.advance(1);

    expect(engine.world.level).toBe("b");
    expect(engine.world).not.toBe(first);
    expect(engine.world.mode.options).toEqual({ carried: 7 });
    expect(names).toEqual([
      "null->a",
      "opened:a",
      "a->b",
      "closed:a",
      "opened:b",
    ]);
    // The loop's counters carried; the world's own clock restarted.
    expect(engine.frame().count).toBe(1);
    expect(engine.world.time).toBe(0);
    await engine.advance(1);
    expect(engine.world.time).toBeCloseTo(1 / 60, 9);
    engine.destroy();
  });

  it("stamps a cue with the frame's simulated time", async () => {
    class PingMode extends GameMode {
      override tick(): void {
        this.world.audio.play("ping");
      }
    }
    class Jukebox extends GameInstance<null> {
      override initialize(api: InitApi): null {
        api.audio.define("ping", { freq: 440, durationMs: 50 });
        return null;
      }
    }
    const engine = real({
      clock: new ConstantClock(10),
      game: {
        instance: Jukebox,
        levels: { main: { mode: PingMode } },
        startLevel: "main",
      },
    });
    const played: Array<{ cue: string; t: number }> = [];
    engine.events.on("cue:played", ({ cue, t }) => played.push({ cue, t }));
    await engine.initialize();
    await engine.advance(2);
    expect(played).toEqual([
      { cue: "ping", t: 10 },
      { cue: "ping", t: 20 },
    ]);
    engine.destroy();
  });

  it("records a real frame the pipeline drew, resolvable from the tables alone", async () => {
    const engine = real();
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(recording.frames).toHaveLength(1);
    const ops = recording.frames[0]?.ops.map((at) => recording.ops[at]) ?? [];
    // The clear to the background, and the drifter's filled rect — its world
    // position, one frame of drift along, carried in the path's own arguments.
    expect(ops).toContainEqual({
      op: "set",
      property: "fillStyle",
      value: "#05060a",
    });
    // The recorder quantizes numeric arguments to six decimal places.
    const driftedLeft =
      Math.round((320 + SPEED * (1000 / 60 / 1000) - BOX / 2) * 1e6) / 1e6;
    expect(ops).toContainEqual({
      op: "call",
      method: "rect",
      args: [driftedLeft, 180 - BOX / 2, BOX, BOX],
    });
    expect(ops).toContainEqual({ op: "call", method: "fill", args: [] });
    engine.destroy();
  });

  it("runs the documented transition sequence over the shipped driver", async () => {
    const calls: string[] = [];

    class Watching extends GameInstance<null> {
      override initialize(): null {
        return null;
      }
      override worldClosing(world: World): void {
        calls.push(`worldClosing:${world.level}`);
      }
      override worldOpened(world: World): void {
        calls.push(`worldOpened:${world.level}`);
      }
    }

    class Prop extends Actor {
      override endPlay(reason: EndPlayReason): void {
        calls.push(`prop.end(${reason})`);
      }
    }

    class MenuMode extends GameMode {
      override tick(): void {
        this.world.open("results");
      }
      override endPlay(reason: EndPlayReason): void {
        calls.push(`menuMode.end(${reason})`);
      }
    }

    class ResultsMode extends GameMode {
      override beginPlay(): void {
        calls.push("resultsMode.begin");
      }
    }

    const engine = real({
      game: {
        instance: Watching,
        levels: {
          menu: { mode: MenuMode, actors: [{ type: Prop }] },
          results: {
            mode: ResultsMode,
            load: (): void => {
              calls.push("results.load");
            },
          },
        },
        startLevel: "menu",
      },
    });
    engine.events.on("world:opening", ({ from, to }) =>
      calls.push(`opening:${from}->${to}`),
    );
    engine.events.on("world:closed", ({ level }) =>
      calls.push(`closed:${level}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      calls.push(`opened:${level}`),
    );

    await engine.initialize();
    calls.length = 0;
    await engine.advance(1);
    expect(calls).toEqual([
      "opening:menu->results",
      "worldClosing:menu",
      "prop.end(level-closed)",
      "menuMode.end(level-closed)",
      "closed:menu",
      "results.load",
      "resultsMode.begin",
      "opened:results",
      "worldOpened:results",
    ]);
    engine.destroy();
  });

  it("rejects an advance whose tick opened an unregistered level, naming the registered ones", async () => {
    class LostMode extends GameMode {
      override tick(): void {
        this.world.open("nowhere");
      }
    }
    const engine = real({
      game: {
        levels: { menu: { mode: LostMode }, arena: { mode: GameMode } },
        startLevel: "menu",
      },
    });
    await engine.initialize();
    await expect(engine.advance(1)).rejects.toThrow(
      /"nowhere".*"menu", "arena"/,
    );
    engine.destroy();
  });

  it("broadcasts possession:changed on the engine bus when the mode adds a player", async () => {
    class Runner extends Pawn {}
    class JoinMode extends GameMode {
      override beginPlay(): void {
        this.addPlayer({ pawn: Runner });
      }
    }
    const engine = real({
      game: { levels: { main: { mode: JoinMode } }, startLevel: "main" },
    });
    const changes: Array<EngineEventMap["possession:changed"]> = [];
    engine.events.on("possession:changed", (event) => changes.push(event));

    await engine.initialize();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.pawn).toBeInstanceOf(Runner);
    expect(changes[0]?.previous).toBeNull();
    expect(changes[0]?.controller.pawn).toBe(changes[0]?.pawn);
    engine.destroy();
  });

  it("reports overlaps from the shipped collision wiring, ending when an actor is destroyed", async () => {
    /** Overlapping circles; the second destroys itself on its second tick. */
    class Blob extends Actor {
      private ticks = 0;
      constructor(private readonly fuse: number | null = null) {
        super();
        this.attach(
          new ColliderComponent({
            shape: { kind: "circle", radius: 12 },
            responses: { default: "overlap" },
          }),
        );
      }
      override tick(): void {
        this.ticks += 1;
        if (this.fuse !== null && this.ticks >= this.fuse) this.destroy();
      }
    }
    class Fused extends Blob {
      constructor() {
        super(2);
      }
    }

    const engine = real({
      game: {
        levels: {
          main: {
            mode: GameMode,
            actors: [
              { type: Blob, transform: { x: 100, y: 100 } },
              { type: Fused, transform: { x: 110, y: 100 } },
            ],
          },
        },
        startLevel: "main",
      },
    });
    const seen: string[] = [];
    engine.events.on("overlap:begin", ({ a, b }) =>
      seen.push(`begin:${a.constructor.name}+${b.constructor.name}`),
    );
    engine.events.on("overlap:end", ({ a, b }) =>
      seen.push(`end:${a.constructor.name}+${b.constructor.name}`),
    );

    await engine.initialize();
    await engine.advance(1);
    expect(seen).toEqual(["begin:Blob+Fused"]);
    // The second frame's tick destroys the fused blob before the pass, so the
    // same frame reports the pair's end.
    await engine.advance(1);
    expect(seen).toEqual(["begin:Blob+Fused", "end:Blob+Fused"]);
    expect(engine.world.actors()).toHaveLength(1);
    engine.destroy();
  });

  it("reports a hit each frame the shipped wiring finds a blocking pair", async () => {
    class Brick extends Actor {
      constructor() {
        super();
        this.attach(
          new ColliderComponent({
            shape: { kind: "rect", width: 20, height: 20 },
            responses: { default: "block" },
          }),
        );
      }
    }
    const engine = real({
      game: {
        levels: {
          main: {
            mode: GameMode,
            actors: [
              { type: Brick, transform: { x: 50, y: 50 } },
              { type: Brick, transform: { x: 60, y: 50 } },
            ],
          },
        },
        startLevel: "main",
      },
    });
    let hits = 0;
    engine.events.on("hit", ({ manifold }) => {
      hits += 1;
      expect(manifold.depth).toBeGreaterThan(0);
    });
    await engine.initialize();
    await engine.advance(3);
    expect(hits).toBe(3);
    engine.destroy();
  });
});

describe("engine.diagnostics over the real subsystems", () => {
  /** An instance and a mode that register into both registries. */
  class WatchedInstance extends GameInstance<null> {
    opens = 0;

    override initialize(api: InitApi): null {
      api.diagnostics.register("build", () => "drift 1.0.0");
      api.diagnostics.register("opens", () => this.opens);
      return null;
    }

    override worldOpened(): void {
      this.opens += 1;
    }
  }

  class WatchedMode extends GameMode {
    override beginPlay(): void {
      const world = this.world;
      world.diagnostics.register("actors", () => world.actors().length);
      world.diagnostics.register("running", () => !world.paused);
      world.diagnostics.register("lead", () => {
        const [lead] = world.actors();
        return lead === undefined ? "none" : lead.transform.x.toFixed(1);
      });
    }
  }

  function watched(): Engine<null> {
    return real({
      game: {
        instance: WatchedInstance,
        levels: {
          a: {
            mode: WatchedMode,
            actors: [{ type: Drifter, transform: { x: 320, y: 180 } }],
          },
          b: { mode: WatchedMode },
        },
        startLevel: "a",
      },
    }) as Engine<null>;
  }

  it("reports the instance registry first, then the world's, each in registration order", async () => {
    const engine = watched();
    await engine.initialize();

    expect(engine.diagnostics()).toEqual([
      { name: "build", value: "drift 1.0.0" },
      { name: "opens", value: 1 },
      { name: "actors", value: 1 },
      { name: "running", value: true },
      { name: "lead", value: "320.0" },
    ]);
    engine.destroy();
  });

  it("evaluates each source at the read, against what the world holds then", async () => {
    const engine = watched();
    await engine.initialize();
    await engine.advance(60);

    expect(engine.diagnostics()).toEqual([
      { name: "build", value: "drift 1.0.0" },
      { name: "opens", value: 1 },
      { name: "actors", value: 1 },
      { name: "running", value: true },
      { name: "lead", value: (320 + SPEED).toFixed(1) },
    ]);
    engine.destroy();
  });

  it("keeps the instance's readings across a transition and rebuilds the world's", async () => {
    const engine = watched();
    await engine.initialize();
    engine.world.open("b");
    await engine.advance(1);

    expect(engine.diagnostics()).toEqual([
      { name: "build", value: "drift 1.0.0" },
      { name: "opens", value: 2 },
      { name: "actors", value: 0 },
      { name: "running", value: true },
      { name: "lead", value: "none" },
    ]);
    engine.destroy();
  });

  it("reads with the overlay hidden, and a read advances and draws nothing", async () => {
    const engine = watched();
    await engine.initialize();
    await engine.advance(5);

    const before = engine.frame();
    const first = engine.diagnostics();
    const second = engine.diagnostics();

    expect(second).toEqual(first);
    expect(engine.frame()).toEqual(before);
    expect(engine.world.time).toBeCloseTo(5 / 60, 9);
    engine.destroy();
  });

  it("reports a throwing source as an error with no value", async () => {
    class BrokenMode extends GameMode {
      override beginPlay(): void {
        this.world.diagnostics.register("pawn", () => {
          throw new Error("no pawn possessed");
        });
        this.world.diagnostics.register("after", () => 7);
      }
    }
    const engine = real({
      game: { levels: { main: { mode: BrokenMode } }, startLevel: "main" },
    });
    await engine.initialize();

    const readings = engine.diagnostics();

    expect(readings).toEqual([
      { name: "pawn", error: "no pawn possessed" },
      { name: "after", value: 7 },
    ]);
    expect(readings[0]).not.toHaveProperty("value");
    engine.destroy();
  });

  it("reports nothing for a game that registered nothing", async () => {
    const engine = real();
    await engine.initialize();
    await engine.advance(1);

    expect(engine.diagnostics()).toEqual([]);
    engine.destroy();
  });
});
