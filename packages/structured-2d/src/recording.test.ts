import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawOp, DrawState, DrawValue, Recording } from "./contract";
import { ContextRecorder, RECORDING_FORMAT } from "./recording";

/**
 * Unit tests over the recorder alone, driven against a hand-written context.
 *
 * The engine's own suite covers the wiring — which frames are bracketed and
 * what a recording says about them. What is checked here is the part a replay
 * depends on and nothing else can establish: that an operation is recorded as
 * the build issued it, that every value a frame draws with resolves from the
 * recording's own tables whichever frame a player lands on, and that the
 * wrapper is invisible to the context underneath it.
 */

/** A gradient, as a context hands one back: opaque, and mutated through itself. */
class FakeGradient {
  readonly stops: Array<[number, string]> = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

/**
 * A sprite sheet, as a build holds one.
 *
 * Stood in for `HTMLImageElement` through a global stub, so the recorder's own
 * `instanceof` test is the thing under test rather than something the test
 * bypasses. `pixels` stands for the bytes a capture would read out of it, and
 * the two sizes differ on purpose: the file's own resolution is what a capture
 * must read, not the box the page laid the element out in.
 */
class FakeImage {
  naturalWidth = 4;
  naturalHeight = 4;
  width = 2;
  height = 2;
  constructor(
    public currentSrc: string,
    public pixels: string,
  ) {}
}

/** A surface a build paints into and blits from, stood in for `OffscreenCanvas`. */
class FakeSurface {
  width = 4;
  height = 4;
  constructor(public pixels: string) {}
}

/**
 * A matrix, as a context answers `getTransform`, stood in for `DOMMatrix`: a
 * value a recording carries as the six numbers `setTransform` accepts, not as
 * a recipe.
 */
class FakeMatrix {
  constructor(
    public a: number,
    public b: number,
    public c: number,
    public d: number,
    public e: number,
    public f: number,
  ) {}
}

/**
 * The canvas the recorder captures bitmap sources through.
 *
 * The recorder builds one by constructing another instance of whatever class
 * its own canvas is, which is how a capture works in-process over a native
 * canvas. What it draws is reduced to a token, so a data URL here says which
 * source produced it and two captures of the same content compare equal the
 * way two real PNGs would. Writing either dimension blanks it and announces
 * the wipe, the way a real canvas resets its context.
 */
class ScratchCanvas {
  private painted = "";
  private backing: { width: number; height: number };
  /** What the owning context does when a size write resets it. */
  onWipe: (() => void) | null = null;
  constructor(width: number, height: number) {
    this.backing = { width, height };
  }
  get width(): number {
    return this.backing.width;
  }
  set width(value: number) {
    this.backing.width = value;
    this.painted = "";
    this.onWipe?.();
  }
  get height(): number {
    return this.backing.height;
  }
  set height(value: number) {
    this.backing.height = value;
    this.painted = "";
    this.onWipe?.();
  }
  getContext(kind: string): unknown {
    if (kind !== "2d") return null;
    return {
      canvas: this,
      drawImage: (source: { pixels?: string }): void => {
        const drawn = source.pixels ?? "";
        this.painted = this.painted === "" ? drawn : `${this.painted}+${drawn}`;
      },
    };
  }
  toDataURL(type: string): string {
    return `data:${type};base64,${this.painted}`;
  }
}

interface Stub {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  gradients: FakeGradient[];
  assigned: Array<[string, unknown]>;
  canvas: ScratchCanvas;
}

/**
 * A context that records what actually reached it.
 *
 * Separate from what the recorder records on purpose: the two lists are
 * compared against each other, which is what shows the wrapper forwards
 * faithfully rather than merely logging plausibly.
 */
function contextStub(): Stub {
  const calls: string[] = [];
  const gradients: FakeGradient[] = [];
  const assigned: Array<[string, unknown]> = [];
  let transform = [1, 0, 0, 1, 0, 0];
  let dash: number[] = [];
  const canvas = new ScratchCanvas(64, 64);
  canvas.onWipe = (): void => {
    transform = [1, 0, 0, 1, 0, 0];
    dash = [];
  };
  const stub = {
    canvas,
    fillStyle: "#000000" as unknown,
    strokeStyle: "#000000" as unknown,
    font: "10px sans-serif",
    globalAlpha: 1,
    lineWidth: 1,
    fillRect(...args: number[]): void {
      calls.push(`fillRect(${args.join(",")})`);
    },
    drawImage(_source: unknown, ...rest: number[]): void {
      calls.push(`drawImage(${rest.join(",")})`);
    },
    putImageData(_data: unknown, ...rest: number[]): void {
      calls.push(`putImageData(${rest.join(",")})`);
    },
    setTransform(...args: number[]): void {
      transform = args;
      calls.push(`setTransform(${args.join(",")})`);
    },
    translate(x: number, y: number): void {
      const [a, b, c, d, e, f] = transform as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      transform = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
      calls.push(`translate(${x},${y})`);
    },
    getTransform(): DOMMatrix {
      const [a, b, c, d, e, f] = transform as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      return new FakeMatrix(a, b, c, d, e, f) as unknown as DOMMatrix;
    },
    setLineDash(pattern: number[]): void {
      dash = [...pattern];
      calls.push(`setLineDash(${pattern.join(",")})`);
    },
    getLineDash(): number[] {
      return [...dash];
    },
    save(): void {
      calls.push("save()");
    },
    restore(): void {
      calls.push("restore()");
    },
    reset(): void {
      calls.push("reset()");
    },
    beginPath(): void {
      calls.push("beginPath()");
    },
    rect(...args: number[]): void {
      calls.push(`rect(${args.join(",")})`);
    },
    moveTo(...args: number[]): void {
      calls.push(`moveTo(${args.join(",")})`);
    },
    lineTo(...args: number[]): void {
      calls.push(`lineTo(${args.join(",")})`);
    },
    fill(): void {
      calls.push("fill()");
    },
    stroke(): void {
      calls.push("stroke()");
    },
    clip(): void {
      calls.push("clip()");
    },
    createLinearGradient(...args: number[]): FakeGradient {
      calls.push(`createLinearGradient(${args.join(",")})`);
      const gradient = new FakeGradient();
      gradients.push(gradient);
      return gradient;
    },
    createPattern(source: unknown, repeat: string): object | null {
      calls.push(`createPattern(${repeat})`);
      return source == null ? null : { pattern: repeat };
    },
  };
  // Property assignment is observed through a second proxy underneath the
  // recorder's, so a test can tell what the context was actually given — in
  // particular whether it was given a wrapper where it expects one of its own
  // objects.
  const observed = new Proxy(stub, {
    set(subject, property, value): boolean {
      assigned.push([String(property), value]);
      return Reflect.set(subject, property, value, subject);
    },
  });
  return {
    ctx: observed as unknown as CanvasRenderingContext2D,
    calls,
    gradients,
    assigned,
    canvas,
  };
}

/** A recorder armed over a stub, with one frame opened. */
function armed(): { recorder: ContextRecorder; stub: Stub } {
  const stub = contextStub();
  const recorder = new ContextRecorder(stub.ctx);
  recorder.start({ width: 640, height: 360, background: "#101018" });
  recorder.beginFrame();
  return { recorder, stub };
}

/** Close the open frame with plain metadata and hand the recording back. */
function closed(
  recorder: ContextRecorder,
  at: { count?: number; timeMs?: number; deltaMs?: number } = {},
): Recording {
  recorder.endFrame(
    {
      count: at.count ?? 1,
      timeMs: at.timeMs ?? 16,
      deltaMs: at.deltaMs ?? 16,
    },
    { width: 64, height: 64 },
  );
  return recorder.stop();
}

/** The operations of one frame, resolved through the recording's shared table. */
function frameOps(recording: Recording, at: number): DrawOp[] {
  const frame = recording.frames[at];
  expect(frame).toBeDefined();
  return (frame?.ops ?? []).map((index) => {
    const op = recording.ops[index];
    expect(op).toBeDefined();
    return op as DrawOp;
  });
}

/** The state one frame inherited, resolved through the shared table. */
function frameState(recording: Recording, at: number): DrawState {
  const frame = recording.frames[at];
  expect(frame).toBeDefined();
  const state = recording.states[frame?.state ?? -1];
  expect(state).toBeDefined();
  return state as DrawState;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the wrapper", () => {
  it("forwards every call and assignment to the real context", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const ctx = recorder.context;

    ctx.fillStyle = "#fff";
    ctx.fillRect(1, 2, 3, 4);
    ctx.translate(10, 20);

    expect(stub.assigned).toEqual([["fillStyle", "#fff"]]);
    expect(stub.calls).toEqual(["fillRect(1,2,3,4)", "translate(10,20)"]);
  });

  it("hands out one stable wrapper for the engine's whole life", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const before = recorder.context;
    recorder.start({ width: 1, height: 1, background: null });
    expect(recorder.context).toBe(before);
    recorder.stop();
    expect(recorder.context).toBe(before);
  });

  it("unwraps a produced value handed back to the context", () => {
    const { recorder, stub } = armed();
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 1);
    ctx.fillStyle = gradient;
    // The context received its own object, not the recorder's proxy.
    expect(stub.assigned[0]?.[1]).toBe(stub.gradients[0]);
    // And a read-back comes back wrapped, as the same wrapper.
    expect(ctx.fillStyle).toBe(gradient);
  });

  it("draws the same pixels for a value it cannot encode", () => {
    const { recorder, stub } = armed();
    const ctx = recorder.context;
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    (ctx as unknown as { fillRect(...args: unknown[]): void }).fillRect(cyclic);
    expect(stub.calls).toEqual(["fillRect([object Object])"]);
    const recording = closed(recorder);
    // The object encodes field by field, and the cycle inside it is the marker.
    expect(frameOps(recording, 0)).toEqual([
      {
        op: "call",
        method: "fillRect",
        args: [{ self: { $opaque: "Object" } }],
      },
    ]);
  });
});

describe("arming and the frame bracket", () => {
  it("reports the format, the design size, and the background fixed at arming", () => {
    const { recorder } = armed();
    const recording = closed(recorder);
    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.width).toBe(640);
    expect(recording.height).toBe(360);
    expect(recording.background).toBe("#101018");
  });

  it("captures nothing while disarmed", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.context.fillRect(0, 0, 1, 1);
    expect(recorder.active).toBe(false);
    recorder.start({ width: 1, height: 1, background: null });
    expect(recorder.active).toBe(true);
    const recording = recorder.stop();
    expect(recorder.active).toBe(false);
    expect(recording.frames).toEqual([]);
    expect(recording.ops).toEqual([]);
  });

  it("drops an operation issued between arming and the next frame open", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 1, height: 1, background: null });
    recorder.context.fillRect(9, 9, 9, 9);
    recorder.beginFrame();
    recorder.context.fillRect(1, 1, 1, 1);
    const recording = closed(recorder);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "fillRect", args: [1, 1, 1, 1] },
    ]);
  });

  it("drops a frame still open when the recorder is disarmed", () => {
    const { recorder } = armed();
    recorder.context.fillRect(0, 0, 1, 1);
    const recording = recorder.stop();
    expect(recording.frames).toEqual([]);
    expect(recording.ops).toEqual([]);
  });

  it("carries the frame metadata exactly, unrounded", () => {
    const { recorder } = armed();
    const recording = closed(recorder, {
      count: 41,
      timeMs: 683.3333333333334,
      deltaMs: 16.666666666666668,
    });
    expect(recording.frames[0]).toMatchObject({
      count: 41,
      timeMs: 683.3333333333334,
      deltaMs: 16.666666666666668,
      surface: { width: 64, height: 64 },
    });
  });
});

describe("operations", () => {
  it("records a call as issued, with numbers at nine significant digits", () => {
    const { recorder } = armed();
    recorder.context.fillRect(1.23456789123, 2, 3, 4);
    const recording = closed(recorder);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "fillRect", args: [1.23456789, 2, 3, 4] },
    ]);
  });

  it("records a set as the value the build supplied, not the normalized one", () => {
    const { recorder } = armed();
    recorder.context.fillStyle = "#fff";
    const recording = closed(recorder);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: "#fff" },
    ]);
  });

  it("holds each distinct operation once, however many frames issue it", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.fillRect(1, 1, 1, 1);
    ctx.fillRect(1, 1, 1, 1);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(1, 1, 1, 1);
    ctx.fillRect(2, 2, 2, 2);
    const recording = closed(recorder, { count: 2 });

    expect(recording.ops).toHaveLength(2);
    expect(recording.frames[0]?.ops).toEqual([0, 0]);
    expect(recording.frames[1]?.ops).toEqual([0, 1]);
  });

  it("carries a matrix a context answered as its six numbers", () => {
    vi.stubGlobal("DOMMatrix", FakeMatrix);
    const { recorder } = armed();
    const ctx = recorder.context;
    const matrix = ctx.getTransform();
    ctx.setTransform(matrix);
    const recording = closed(recorder);
    // The read itself is an ordinary operation of the frame; the matrix it
    // answered travels as data rather than as a recipe.
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "getTransform", args: [] },
      {
        op: "call",
        method: "setTransform",
        args: [{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }],
      },
    ]);
  });

  it("marks a value nested past the depth bound, keeping the operation", () => {
    const { recorder } = armed();
    let value: unknown = "leaf";
    for (let level = 0; level < 40; level += 1) value = { value };
    (recorder.context as unknown as { fillRect(v: unknown): void }).fillRect(
      value,
    );
    const recording = closed(recorder);
    const [op] = frameOps(recording, 0);
    expect(op?.op).toBe("call");
    // Somewhere inside the 32 carried levels sits the one marker standing for
    // the rest.
    expect(JSON.stringify(op)).toContain('"$opaque":"Object"');
    expect(JSON.stringify(op)).not.toContain("leaf");
  });
});

describe("inherited state", () => {
  it("snapshots the state a frame opened with, not the one it left", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const ctx = recorder.context;
    ctx.font = "24px monospace";
    recorder.start({ width: 640, height: 360, background: null });
    recorder.beginFrame();
    ctx.font = "8px serif";
    const recording = closed(recorder);
    expect(frameState(recording, 0).properties["font"]).toBe("24px monospace");
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "font", value: "8px serif" },
    ]);
  });

  it("hands a later frame the state an earlier one established", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.fillStyle = "#123456";
    ctx.translate(10, 0);
    ctx.setLineDash([4, 2]);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    expect(state.properties["fillStyle"]).toBe("#123456");
    expect(state.transform).toEqual([1, 0, 0, 1, 10, 0]);
    expect(state.lineDash).toEqual([4, 2]);
  });

  it("interns two equal inherited states as one entry", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder, { count: 2 });
    expect(recording.states).toHaveLength(1);
    expect(recording.frames[0]?.state).toBe(recording.frames[1]?.state);
  });
});

describe("the save stack", () => {
  it("carries the states saved when the frame opened, outermost first", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.fillStyle = "#outer";
    ctx.save();
    ctx.fillStyle = "#inner";
    ctx.save();
    ctx.fillStyle = "#innermost";
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.restore();
    const recording = closed(recorder, { count: 2 });

    const frame = recording.frames[1];
    expect(frame?.stack).toHaveLength(2);
    const outer = recording.states[frame?.stack[0] ?? -1];
    const inner = recording.states[frame?.stack[1] ?? -1];
    expect(outer?.properties["fillStyle"]).toBe("#outer");
    expect(inner?.properties["fillStyle"]).toBe("#inner");
    // A stack entry carries no path: the path is outside the saved state.
    expect(outer?.path).toEqual([]);
    expect(frameState(recording, 1).properties["fillStyle"]).toBe("#innermost");
  });

  it("keeps the innermost 64 entries and flags the frame that inherited the cut", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    for (let depth = 0; depth < 70; depth += 1) ctx.save();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder, { count: 2 });
    expect(recording.frames[1]?.stack).toHaveLength(64);
    expect(recording.frames[1]?.truncated).toBe(true);
    // The first frame inherited nothing cut down: the saves happened inside
    // it, and the flag describes what a frame opened with.
    expect(recording.frames[0]?.truncated).toBeUndefined();
  });
});

describe("the clip and the current path", () => {
  it("carries the path issued before arming into the first frame's state", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const ctx = recorder.context;
    ctx.beginPath();
    ctx.rect(1, 2, 3, 4);
    recorder.start({ width: 640, height: 360, background: null });
    recorder.beginFrame();
    const recording = closed(recorder);

    const state = frameState(recording, 0);
    expect(state.path).toHaveLength(1);
    expect(state.path[0]?.ops).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [1, 2, 3, 4] },
    ]);
  });

  it("splits the path into one segment per transform it was issued under", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.translate(10, 0);
    ctx.lineTo(5, 5);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    expect(state.path).toHaveLength(2);
    expect(state.path[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(state.path[1]?.transform).toEqual([1, 0, 0, 1, 10, 0]);
    expect(state.path[1]?.ops).toEqual([
      { op: "call", method: "lineTo", args: [5, 5] },
    ]);
  });

  it("moves the path in force onto the clip region, with the clip call itself", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.beginPath();
    ctx.rect(0, 0, 8, 8);
    ctx.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    expect(state.clip).toHaveLength(1);
    expect(state.clip[0]?.ops).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [0, 0, 8, 8] },
      { op: "call", method: "clip", args: [] },
    ]);
  });

  it("clears the current path on beginPath, and both on reset", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.beginPath();
    ctx.rect(0, 0, 8, 8);
    ctx.clip();
    ctx.beginPath();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    ctx.reset();
    recorder.beginFrame();
    const recording = closed(recorder, { count: 3 });

    const second = frameState(recording, 1);
    expect(second.path).toHaveLength(1);
    expect(second.path[0]?.ops).toEqual([
      { op: "call", method: "beginPath", args: [] },
    ]);
    expect(second.clip).toHaveLength(1);
    const third = frameState(recording, 2);
    expect(third.clip).toEqual([]);
    expect(third.path).toEqual([]);
  });

  it("keeps the clip a restore puts back", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 8, 8);
    ctx.clip();
    ctx.restore();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });
    // The restore returned to the clip in force at the save: none.
    expect(frameState(recording, 1).clip).toEqual([]);
  });

  it("keeps the prefix of a path past the bound and flags the frames that inherit it", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.beginPath();
    for (let at = 0; at < 1100; at += 1) ctx.lineTo(at, at);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    const kept = state.path.reduce(
      (sum, segment) => sum + segment.ops.length,
      0,
    );
    expect(kept).toBe(1024);
    expect(recording.frames[1]?.truncated).toBe(true);
  });

  it("refuses a clip whose region would run past the bound, leaving the region as it stands", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.beginPath();
    ctx.rect(0, 0, 2, 2);
    ctx.clip();
    ctx.beginPath();
    for (let at = 0; at < 1023; at += 1) ctx.lineTo(at, at);
    ctx.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    // Only the first, three-op clip stands; the refused one left it in force.
    const clipOps = state.clip.reduce(
      (sum, segment) => sum + segment.ops.length,
      0,
    );
    expect(clipOps).toBe(3);
    expect(recording.frames[1]?.truncated).toBe(true);
  });
});

describe("values the context produced", () => {
  it("records a gradient's use as a resource holding its recipe so far", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 100);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder);

    expect(recording.resources).toEqual([
      {
        make: { method: "createLinearGradient", args: [0, 0, 0, 100] },
        then: [
          { op: "call", method: "addColorStop", args: [0, "#000"] },
          { op: "call", method: "addColorStop", args: [1, "#fff"] },
        ],
      },
    ]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
    ]);
  });

  it("keeps the producing call out of the frame's operations", () => {
    const { recorder } = armed();
    recorder.context.createLinearGradient(0, 0, 0, 1);
    const recording = closed(recorder);
    expect(frameOps(recording, 0)).toEqual([]);
    // Never used: not in the resource table either.
    expect(recording.resources).toEqual([]);
  });

  it("tracks a gradient created before the recorder was ever armed", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 9);
    gradient.addColorStop(0.5, "#7fd1ff");
    recorder.start({ width: 640, height: 360, background: null });
    recorder.beginFrame();
    ctx.fillStyle = gradient;
    const recording = closed(recorder);
    expect(recording.resources[0]).toEqual({
      make: { method: "createLinearGradient", args: [0, 0, 0, 9] },
      then: [{ op: "call", method: "addColorStop", args: [0.5, "#7fd1ff"] }],
    });
  });

  it("restates a style property whose gradient grew before a paint", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 1);
    ctx.fillStyle = gradient;
    gradient.addColorStop(0, "#000");
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder);

    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      // The corrective set: the property paints under the stop now.
      { op: "set", property: "fillStyle", value: { $res: 1 } },
      { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
    ]);
    expect(recording.resources[0]?.then).toEqual([]);
    expect(recording.resources[1]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
    ]);
  });

  it("measures a paint after a restore against the encoding in force at the save", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 1);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 1);
    ctx.save();
    gradient.addColorStop(0, "#000");
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    // The recipe has not grown since the save's copy said one stop... it grew
    // before the second fill, which corrected it inside the save. After the
    // restore the record returns to the pre-save figure, so a third paint is
    // corrected again.
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder);

    const sets = frameOps(recording, 0).filter((op) => op.op === "set");
    // The assignment, the correction inside the save, and the correction after
    // the restore.
    expect(sets).toHaveLength(3);
  });

  it("lets a createPattern that answered null travel as the null it is", () => {
    const { recorder, stub } = armed();
    const ctx = recorder.context;
    const pattern = ctx.createPattern(
      null as unknown as CanvasImageSource,
      "repeat",
    );
    expect(pattern).toBeNull();
    ctx.fillStyle = pattern as unknown as string;
    const recording = closed(recorder);
    expect(stub.assigned.at(-1)).toEqual(["fillStyle", null]);
    expect(recording.resources).toEqual([]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: null },
    ]);
  });
});

/**
 * A pixel buffer, stood in for `ImageData` through a global stub, holding the
 * bytes a real one holds: a `pixels` entry is the buffer's own RGBA, and a
 * test that stood a token in for them could not tell an exact byte from a
 * re-encoded one.
 */
class FakePixels {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

describe("captured images", () => {
  it("carries an ImageData as its exact bytes, base64 encoded", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const { recorder } = armed();
    const pixels = new FakePixels(2, 2);
    pixels.data.set([1, 2, 3, 4], 0);
    recorder.context.putImageData(pixels as unknown as ImageData, 0, 0);
    const recording = closed(recorder);

    expect(recording.images).toHaveLength(1);
    const image = recording.images[0];
    expect(image?.kind).toBe("pixels");
    expect(image).toMatchObject({ width: 2, height: 2 });
    const data = image?.kind === "pixels" ? image.data : "";
    const bytes = [...Buffer.from(data, "base64")];
    expect(bytes).toHaveLength(16);
    expect(bytes.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "putImageData", args: [{ $img: 0 }, 0, 0] },
    ]);
  });

  it("captures a fixed source once, at its natural size, keyed on its file", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const ctx = recorder.context;
    const sheet = new FakeImage("sprites.png", "SHEET");
    ctx.drawImage(sheet as unknown as CanvasImageSource, 0, 0);
    ctx.drawImage(sheet as unknown as CanvasImageSource, 8, 8);
    const recording = closed(recorder);

    expect(recording.images).toEqual([
      {
        kind: "bitmap",
        width: 4,
        height: 4,
        src: "data:image/png;base64,SHEET",
      },
    ]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "drawImage", args: [{ $img: 0 }, 0, 0] },
      { op: "call", method: "drawImage", args: [{ $img: 0 }, 8, 8] },
    ]);
  });

  it("captures a re-pointed image again under its new identity", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const ctx = recorder.context;
    const image = new FakeImage("a.png", "A");
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
    image.currentSrc = "b.png";
    image.pixels = "B";
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
    const recording = closed(recorder);
    expect(
      recording.images.map((entry) => (entry as { src: string }).src),
    ).toEqual(["data:image/png;base64,A", "data:image/png;base64,B"]);
  });

  it("captures a mutable source at every use, sharing entries on their bytes", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const { recorder } = armed();
    const ctx = recorder.context;
    const surface = new FakeSurface("FIRST");
    ctx.drawImage(surface as unknown as CanvasImageSource, 0, 0);
    ctx.drawImage(surface as unknown as CanvasImageSource, 1, 1);
    surface.pixels = "SECOND";
    ctx.drawImage(surface as unknown as CanvasImageSource, 2, 2);
    const recording = closed(recorder);

    expect(recording.images).toHaveLength(2);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "drawImage", args: [{ $img: 0 }, 0, 0] },
      { op: "call", method: "drawImage", args: [{ $img: 0 }, 1, 1] },
      { op: "call", method: "drawImage", args: [{ $img: 1 }, 2, 2] },
    ]);
  });

  it("degrades a source it cannot capture to a named marker", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const image = new FakeImage("empty.png", "X");
    image.naturalWidth = 0;
    image.width = 0;
    recorder.context.drawImage(image as unknown as CanvasImageSource, 0, 0);
    const recording = closed(recorder);
    expect(frameOps(recording, 0)).toEqual([
      {
        op: "call",
        method: "drawImage",
        args: [{ $opaque: "FakeImage" }, 0, 0],
      },
    ]);
    expect(recording.images).toEqual([]);
  });
});

describe("a canvas reset", () => {
  it("discards the frame's earlier operations and re-takes the inherited state", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.fillStyle = "#before";
    ctx.fillRect(0, 0, 1, 1);
    // The ordinary way a build clears its surface: the same size written back.
    (ctx.canvas as { width: number }).width = 64;
    ctx.fillRect(2, 2, 2, 2);
    const recording = closed(recorder);

    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "fillRect", args: [2, 2, 2, 2] },
    ]);
    // The state was re-taken against the reset context, whose transform and
    // properties returned to their defaults.
    expect(frameState(recording, 0).transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("empties the save stack, the clip, and the path", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    (ctx.canvas as { width: number }).width = 32;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 32, height: 64 },
    );
    recorder.beginFrame();
    const recording = closed(recorder, { count: 2 });

    expect(recording.frames[1]?.stack).toEqual([]);
    expect(frameState(recording, 1).clip).toEqual([]);
    expect(frameState(recording, 1).path).toEqual([]);
    expect(recording.frames[1]?.truncated).toBeUndefined();
  });

  it("keeps the tables settled: entries only the wiped operations named are gone", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const { recorder } = armed();
    const ctx = recorder.context;
    const surface = new FakeSurface("WIPED");
    ctx.drawImage(surface as unknown as CanvasImageSource, 0, 0);
    (ctx.canvas as { width: number }).width = 64;
    ctx.fillRect(1, 1, 1, 1);
    const recording = closed(recorder);

    // The blit was erased with the wipe, so nothing names its image or its op.
    expect(recording.images).toEqual([]);
    expect(recording.ops).toEqual([
      { op: "call", method: "fillRect", args: [1, 1, 1, 1] },
    ]);
  });
});

describe("frame independence", () => {
  it("resolves an inherited gradient fill from the shared table on a later frame", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 50);
    gradient.addColorStop(0, "#123");
    ctx.fillStyle = gradient;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(0, 0, 1, 1);
    const recording = closed(recorder, { count: 2 });

    const state = frameState(recording, 1);
    const fill = state.properties["fillStyle"] as { $res: number };
    expect(fill).toEqual({ $res: 0 });
    expect(recording.resources[0]).toEqual({
      make: { method: "createLinearGradient", args: [0, 0, 0, 50] },
      then: [{ op: "call", method: "addColorStop", args: [0, "#123"] }],
    });
  });

  it("names only entries the recording holds, from every frame reference", () => {
    const { recorder } = armed();
    const ctx = recorder.context;
    ctx.fillStyle = "#abc";
    ctx.fillRect(0, 0, 4, 4);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    recorder.beginFrame();
    ctx.fillRect(0, 0, 4, 4);
    const recording = closed(recorder, { count: 2 });

    for (const frame of recording.frames) {
      expect(recording.states[frame.state]).toBeDefined();
      for (const at of frame.stack) expect(recording.states[at]).toBeDefined();
      for (const at of frame.ops) expect(recording.ops[at]).toBeDefined();
    }
  });
});

/** Every `$res` and `$img` reference reachable inside a value. */
function references(value: DrawValue | undefined): string[] {
  if (value === null || value === undefined || typeof value !== "object")
    return [];
  if (Array.isArray(value)) return value.flatMap(references);
  const record = value as Readonly<Record<string, DrawValue>>;
  const found: string[] = [];
  if (typeof record["$res"] === "number") found.push(`res:${record["$res"]}`);
  if (typeof record["$img"] === "number") found.push(`img:${record["$img"]}`);
  for (const entry of Object.values(record)) found.push(...references(entry));
  return found;
}

describe("the capture budget", () => {
  it("stops capturing new images past 16 MB and keeps resolving what it holds", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const { recorder } = armed();
    const ctx = recorder.context;
    const oversized = new FakeSurface("A".repeat(17 * 1024 * 1024));
    const small = new FakeSurface("SMALL");
    ctx.drawImage(small as unknown as CanvasImageSource, 0, 0);
    ctx.drawImage(oversized as unknown as CanvasImageSource, 0, 0);
    // Past the budget: a further new capture degrades…
    const late = new FakeSurface("LATE");
    ctx.drawImage(late as unknown as CanvasImageSource, 0, 0);
    // …while bytes the recording already holds keep resolving.
    ctx.drawImage(small as unknown as CanvasImageSource, 9, 9);
    const recording = closed(recorder);

    expect(recording.images).toHaveLength(2);
    const ops = frameOps(recording, 0);
    expect(
      references(ops[0]?.op === "call" ? ops[0].args[0] : undefined),
    ).toEqual(["img:0"]);
    expect(ops[2]).toEqual({
      op: "call",
      method: "drawImage",
      args: [{ $opaque: "FakeSurface" }, 0, 0],
    });
    expect(ops[3]).toEqual({
      op: "call",
      method: "drawImage",
      args: [{ $img: 0 }, 9, 9],
    });
  });
});
