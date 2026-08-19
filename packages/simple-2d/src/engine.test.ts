import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Schedule } from "./contract";
import type { EngineHost } from "./host";
import { HOST_HANDLE, HOST_VERSION } from "./host";
import type { Engine } from "./index";
import { createEngine } from "./index";

/**
 * Integration tests over the assembled engine — the wiring `createEngine` performs,
 * exercised the way a driver and a game actually meet it, rather than the
 * subsystems, which have their own suites beside them.
 *
 * jsdom gives a document, events and an element tree but neither a canvas
 * implementation nor layout, so two things are stood in for: the 2D context (a stub
 * that records the operations *and the transform in force when each one happened*,
 * which is how the ordering claims below are checked) and the element's laid-out
 * size. `requestAnimationFrame` is replaced by a queue the test drains by hand,
 * because a loop that re-arms itself would otherwise run for as long as the test
 * process does.
 */

/** One recorded context operation, with the transform that was in force for it. */
interface RecordedOp {
  op: string;
  transform: readonly number[];
}

interface ContextStub {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  transform(): readonly number[];
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
  const record = (op: string): void => {
    ops.push({ op, transform });
  };
  const stub = {
    canvas,
    fillStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      transform = [a, b, c, d, e, f];
      record("setTransform");
    },
    clearRect(): void {
      record("clearRect");
    },
    fillRect(): void {
      record("fillRect");
    },
    fillText(): void {
      record("fillText");
    },
    measureText(text: string): { width: number } {
      return { width: text.length * 7 };
    },
    save(): void {
      record("save");
    },
    restore(): void {
      record("restore");
    },
  };
  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    ops,
    transform: () => transform,
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
  const view = document.defaultView as unknown as Record<string, unknown>;
  return view[HOST_HANDLE] as EngineHost | undefined;
}

/** The host interface, insisting it is there — a missing one is a test failure. */
function requireHost(): EngineHost {
  const host = installedHost();
  if (host === undefined) throw new Error(`no engine host at window.${HOST_HANDLE}`);
  return host;
}

const engines: Engine[] = [];

/** Creates an engine the teardown will dispose of, whatever the test does. */
function engine(options: Partial<Parameters<typeof createEngine>[0]> = {}): {
  engine: Engine;
  stub: ContextStub;
  canvas: HTMLCanvasElement;
} {
  const { canvas, stub } = mount();
  const created = createEngine({ canvas, width: 400, height: 200, ...options });
  engines.push(created);
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
});

describe("the host interface", () => {
  it("is installed at the documented handle and removed by destroy", () => {
    const { engine: created } = engine();

    const host = requireHost();
    expect(host.version).toBe(HOST_VERSION);
    expect(HOST_HANDLE).toBe("__tcabEngine");
    for (const op of ["setClock", "setSchedule", "advance", "frame", "actions"] as const) {
      expect(typeof host[op]).toBe("function");
    }

    created.destroy();
    expect(installedHost()).toBeUndefined();
  });

  it("is replaced by a second engine, and outlives the first engine's destroy", () => {
    // The order a page recreating its engine actually uses: build the replacement,
    // then dispose of the original. The handle must end up owned by the engine that
    // is running, not unpublished by the one that is not.
    const { engine: first } = engine();
    first.input.register("first-only", { keys: ["KeyQ"] });
    const { engine: second } = engine();
    second.input.register("second-only", { keys: ["KeyE"] });

    expect(requireHost().actions().map((action) => action.name)).toEqual(["second-only"]);

    first.destroy();

    expect(requireHost().actions().map((action) => action.name)).toEqual(["second-only"]);
  });

  it("returns plain values a driver can read straight out of page.evaluate", () => {
    const { engine: created } = engine();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    created.diagnostics.register("cyclic", () => cyclic);
    created.diagnostics.register("vector", () => ({ x: 1, y: 2 }));

    const diagnostics = requireHost().diagnostics();

    // The cyclic source degrades to its string form instead of throwing out of the
    // read and taking the sibling diagnostic with it.
    expect(typeof diagnostics["cyclic"]).toBe("string");
    expect(diagnostics["vector"]).toEqual({ x: 1, y: 2 });
    expect(() => JSON.stringify(diagnostics)).not.toThrow();
  });
});

describe("the manual clock", () => {
  it("runs exactly the requested number of frames, with the scheduled deltas", () => {
    const { engine: created } = engine();
    const deltas: number[] = [];
    created.frame.run({
      update: (dt) => deltas.push(dt),
      render: () => undefined,
    });

    const host = requireHost();
    host.setClock("manual");
    host.setSchedule({ kind: "fixed", stepMs: 10 });
    // Taking the clock cancels the frame `run` armed: an rAF frame arriving in the
    // middle of an `advance` would break the "exactly N frames" guarantee.
    expect(raf.pending()).toBe(0);

    host.advance(5);

    // Seconds, not milliseconds — a game's constants are all per-second.
    expect(deltas).toEqual([0.01, 0.01, 0.01, 0.01, 0.01]);
    expect(host.frame()).toEqual({ count: 5, timeMs: 50, lastDeltaMs: 10 });
    expect(raf.pending()).toBe(0);
  });

  it("refuses a clock mode and a schedule it cannot run", () => {
    engine();
    const host = requireHost();

    // Both arrive as untyped JSON from a driver, and both would otherwise present as
    // a page that simply stops running frames.
    expect(() => host.setClock("fast" as never)).toThrow(/unknown clock mode/);
    expect(() =>
      host.setSchedule({ kind: "jitter", minMs: 20, maxMs: 5, seed: 1 }),
    ).toThrow(/maxMs >= minMs/);
    expect(() => host.setSchedule({ kind: "fixed", stepMs: 0 })).toThrow(/positive stepMs/);
  });

  it("reaches the same simulated state under schedules covering the same time", () => {
    // The property the engine exists to make checkable: a build that integrates
    // against the delta time it is handed must not care how that time was chopped
    // up. Same total time, wildly different frame pattern, same outcome.
    const scenario = (schedule: Schedule, steps: number): { x: number; timeMs: number } => {
      const { engine: created } = engine();
      let x = 0;
      created.frame.run({
        update: (dt) => {
          x += 60 * dt;
        },
        render: () => undefined,
      });
      const host = requireHost();
      host.setClock("manual");
      host.setSchedule(schedule);
      host.advance(steps);
      const { timeMs } = host.frame();
      created.destroy();
      return { x, timeMs };
    };

    const fixed = scenario({ kind: "fixed", stepMs: 10 }, 60);
    const sequence = scenario({ kind: "sequence", stepsMs: [5, 15] }, 60);

    expect(fixed.timeMs).toBeCloseTo(600, 9);
    expect(sequence.timeMs).toBeCloseTo(fixed.timeMs, 9);
    expect(fixed.x).toBeCloseTo(36, 9);
    expect(sequence.x).toBeCloseTo(fixed.x, 9);
  });
});

describe("input", () => {
  it("reports what the game registered, with the layout it registered under", () => {
    const { engine: created } = engine({ layout: "dual-vertical" });
    created.input.register("p1-up", { keys: ["KeyW"] });
    created.input.register("aim", { keys: ["ArrowLeft"], kind: "analog" });

    const host = requireHost();

    // A static read: no keystrokes were simulated to establish any of this.
    expect(host.actions()).toEqual([
      { name: "p1-up", keys: ["KeyW"], kind: "digital", layout: "dual-vertical" },
      { name: "aim", keys: ["ArrowLeft"], kind: "analog", layout: null },
    ]);
    expect(host.layout()?.name).toBe("dual-vertical");
    expect(host.layout()?.actions).toContain("pause");
  });

  it("drives an action from the host and consumes its edge in one frame", () => {
    const { engine: created } = engine();
    created.input.register("fire", { keys: ["Space"] });
    const presses: boolean[] = [];
    created.frame.run({
      update: () => presses.push(created.input.pressed("fire")),
      render: () => undefined,
    });

    const host = requireHost();
    host.setClock("manual");
    host.pressAction("fire");
    host.advance(2);

    // The engine closes the input frame after `render`, so a tap is news for exactly
    // one frame however many frames follow it.
    expect(presses).toEqual([true, false]);
  });

  it("stops listening for keys once destroyed", () => {
    const { engine: created } = engine();
    created.input.register("left", { keys: ["ArrowLeft"] });

    created.destroy();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }));

    expect(created.input.value("left")).toBe(0);
  });
});

describe("audio", () => {
  it("logs a played cue against the frame clock", () => {
    const { engine: created } = engine();
    created.audio.define("bounce", { freq: 440, durationMs: 50, gain: 0.5 });

    const host = requireHost();
    host.setClock("manual");
    host.setSchedule({ kind: "fixed", stepMs: 10 });
    host.advance(3);
    created.audio.play("bounce");

    // Stamped with simulated time, not wall time: under a manual clock no real time
    // passes, so `performance.now()` would put every cue of a run at one instant.
    expect(host.audioLog()).toEqual([{ cue: "bounce", t: 30, gain: 0.5 }]);
    expect(host.audioState()).toEqual({ muted: false, unlocked: false });

    created.audio.setMuted(true);
    created.audio.play("bounce");

    // A muted cue is still logged, at gain zero, so "the build reacted" and "the
    // build was audible" stay separate questions.
    expect(host.audioLog()[1]).toEqual({ cue: "bounce", t: 30, gain: 0 });
    expect(host.audioState().muted).toBe(true);
  });

  it("unlocks on the first interaction and only the first", () => {
    const { engine: created } = engine();
    let unlocks = 0;
    const unlock = created.audio.unlock.bind(created.audio);
    created.audio.unlock = (): void => {
      unlocks += 1;
      unlock();
    };

    expect(requireHost().audioState().unlocked).toBe(false);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", bubbles: true }));

    expect(unlocks).toBe(1);
    expect(requireHost().audioState().unlocked).toBe(true);
  });
});

describe("the diagnostics overlay", () => {
  it("is toggled by a key the engine owns rather than by a registered action", () => {
    const { engine: created } = engine();
    created.input.register("thrust", { keys: ["ArrowUp"] });

    expect(created.diagnostics.enabled()).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
    expect(created.diagnostics.enabled()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
    expect(created.diagnostics.enabled()).toBe(false);

    // The toggle is engine chrome: it must not appear in the vocabulary a driver
    // reads back to confirm the build bound what its case asked for.
    expect(requireHost().actions()).toEqual([
      { name: "thrust", keys: ["ArrowUp"], kind: "digital", layout: null },
    ]);

    requireHost().setOverlay(true);
    expect(created.diagnostics.enabled()).toBe(true);
  });

  it("draws after the game and outside the game's transform", () => {
    const { engine: created, stub } = engine();
    created.diagnostics.register("score", () => 7);
    created.diagnostics.setEnabled(true);
    let opsWhenGameFinished = -1;
    created.frame.run({
      update: () => undefined,
      render: (ctx) => {
        ctx.fillRect(0, 0, 1, 1);
        opsWhenGameFinished = stub.ops.length;
      },
    });

    const host = requireHost();
    host.setClock("manual");
    host.advance(1);

    const text = stub.ops.filter((entry) => entry.op === "fillText");
    expect(text).toHaveLength(1);
    // Device space, not the letterboxed game transform, so overlay text keeps its
    // size and crispness however far the game's coordinates are being scaled.
    expect(text[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    // Every overlay operation lands after the last thing the game drew, so the panel
    // is over the picture rather than under it.
    expect(stub.ops.findIndex((entry) => entry.op === "fillText")).toBeGreaterThanOrEqual(
      opsWhenGameFinished,
    );
    expect(stub.ops.slice(opsWhenGameFinished).map((entry) => entry.op)).toEqual([
      "setTransform",
      "save",
      "fillRect",
      "fillText",
      "restore",
    ]);
  });
});

describe("the canvas fit", () => {
  it("hands render a context transformed by the fitted viewport", () => {
    const { engine: created, stub, canvas } = engine({ background: "#101820" });
    let atRender: readonly number[] = [];
    let seen: CanvasRenderingContext2D | null = null;
    created.frame.run({
      update: () => undefined,
      render: (ctx) => {
        seen = ctx;
        atRender = stub.transform();
      },
    });

    raf.tick(16);

    // 800x600 CSS at a ratio of 2 is 1600x1200 device pixels; a 400x200 field fits
    // at 2 CSS px per unit, so 4 device px per unit, with the spare 400 device px of
    // height split into two 200px bars.
    expect(seen).toBe(stub.ctx);
    expect(atRender).toEqual([4, 0, 0, 4, 0, 200]);
    expect(created.viewport()).toEqual({
      width: 400,
      height: 200,
      scale: 4,
      offsetX: 0,
      offsetY: 200,
    });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);

    // The background is painted across the whole backing store, in device space,
    // before the game draws anything.
    const ops = stub.ops.map((entry) => entry.op);
    expect(ops).not.toContain("clearRect");
    expect(stub.ops[ops.indexOf("fillRect")]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("refits when the element's size changes, with no resize handler", () => {
    const { engine: created, canvas } = engine();
    created.frame.run({ update: () => undefined, render: () => undefined });
    raf.tick(16);

    Object.defineProperty(canvas, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 400, configurable: true });
    raf.tick(32);

    // 400x400 CSS at a ratio of 2 fits a 400x200 field at 1 CSS px per unit.
    expect(created.viewport()).toEqual({
      width: 400,
      height: 200,
      scale: 2,
      offsetX: 0,
      offsetY: 200,
    });
  });

  it("clears to transparency when no background was named", () => {
    const { engine: created, stub } = engine();
    created.frame.run({ update: () => undefined, render: () => undefined });

    raf.tick(16);

    expect(stub.ops.map((entry) => entry.op)).toContain("clearRect");
  });

  it("refuses a design size nothing can be drawn in", () => {
    const { canvas } = mount();
    expect(() => createEngine({ canvas, width: 0, height: 200 })).toThrow(
      /positive logical design size/,
    );
  });
});

describe("destroy", () => {
  it("stops the loop", () => {
    const { engine: created } = engine();
    let frames = 0;
    created.frame.run({
      update: () => {
        frames += 1;
      },
      render: () => undefined,
    });
    raf.tick(16);
    expect(frames).toBe(1);

    created.destroy();
    raf.tick(32);

    expect(frames).toBe(1);
    expect(raf.pending()).toBe(0);
  });

  it("is idempotent", () => {
    const { engine: created } = engine();
    created.destroy();
    expect(() => created.destroy()).not.toThrow();
  });
});
