import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawFrame,
  prepareRecording,
  type DecodedImage,
  type ReplayResources,
} from "./drawFrame";
import {
  RECORDING_FORMAT,
  type CapturedImage,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type RecordedFrame,
  type Recording,
  type Resource,
} from "./format";

/**
 * Replaying one frame against a hand-written context.
 *
 * The context is a stub rather than a real canvas because what a player has to get
 * right is not the pixels — the canvas draws those — but WHICH operations reach the
 * context, in what order, and with what values. A stub answers that exactly; a
 * rendered bitmap answers it by inference.
 *
 * The property under test throughout is the one the whole format exists for: a
 * frame is drawn from itself, completely. Seeking to frame 900 must issue frame
 * 900's operations and nobody else's, under the fill frame 900 inherited, or two
 * recordings could not be scrubbed in step and a seek would cost the whole history
 * before it.
 */

/** A gradient, as a context hands one back: opaque, and mutated through itself. */
class FakeGradient {
  readonly stops: Array<[number, string]> = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

interface Stub {
  ctx: CanvasRenderingContext2D;
  /** Every call and every property assignment, in the order the context saw them. */
  log: string[];
  /** Calls with their real arguments, for identity checks. */
  calls: Array<{ method: string; args: unknown[] }>;
  /** Property assignments with their real values, for identity checks. */
  assigned: Array<[string, unknown]>;
  gradients: FakeGradient[];
  /** The style properties in force right now, after every save and restore. */
  values: Record<string, unknown>;
}

/**
 * A context that records what actually reached it.
 *
 * Calls and assignments share one log because the order between them is itself
 * under test: a frame's inherited style has to be in force before its operations
 * run, and its transform has to be established after the properties that might
 * have disturbed it. `calls` and `assigned` carry the values themselves, for the
 * checks that are about identity rather than order — the gradient a fill was given
 * has to be the gradient this frame built, not a string standing in for it.
 */
function contextStub(): Stub {
  const log: string[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const assigned: Array<[string, unknown]> = [];
  const gradients: FakeGradient[] = [];
  const note = (method: string, args: unknown[]): void => {
    calls.push({ method, args });
  };
  // A value is named in the log rather than stringified: an object rebuilt from a
  // recording has no prototype (so that a field called "__proto__" stays a field),
  // and interpolating one throws. A real context never stringifies its arguments.
  const label = (value: unknown): string =>
    typeof value === "object" && value !== null ? "a value" : String(value);
  // The properties a save carries and a restore puts back. A stub that only logged
  // the two calls could not tell a player that pushes the states a frame inherited
  // from one that does not: what separates them is which fill the operations after
  // a restore are drawn under.
  const CARRIED = ["fillStyle", "strokeStyle", "font", "lineWidth"] as const;
  const saved: Array<Record<string, unknown>> = [];
  const base: Record<string, unknown> = {
    fillStyle: "#000000" as unknown,
    strokeStyle: "#000000" as unknown,
    font: "10px sans-serif",
    lineWidth: 1,
    save(): void {
      log.push("save()");
      note("save", []);
      const kept: Record<string, unknown> = {};
      for (const name of CARRIED) kept[name] = base[name];
      saved.push(kept);
    },
    restore(): void {
      log.push("restore()");
      note("restore", []);
      const kept = saved.pop();
      // A restore with nothing under it is a no-op on a real context too.
      if (kept !== undefined) Object.assign(base, kept);
    },
    beginPath(): void {
      log.push("beginPath()");
      note("beginPath", []);
    },
    rect(...args: number[]): void {
      log.push(`rect(${args.join(",")})`);
      note("rect", args);
    },
    clip(): void {
      log.push("clip()");
      note("clip", []);
    },
    fill(): void {
      log.push("fill()");
      note("fill", []);
    },
    createPattern(source: unknown, repeat: string): null {
      log.push(`createPattern(${label(source)},${repeat})`);
      note("createPattern", [source, repeat]);
      // What a context answers for a source it will not take, which is the one
      // producing call that can answer nothing at all.
      return null;
    },
    setTransform(...args: number[]): void {
      log.push(`setTransform(${args.join(",")})`);
      note("setTransform", args);
    },
    clearRect(...args: number[]): void {
      log.push(`clearRect(${args.join(",")})`);
      note("clearRect", args);
    },
    fillRect(...args: number[]): void {
      log.push(`fillRect(${args.join(",")})`);
      note("fillRect", args);
    },
    setLineDash(pattern: number[]): void {
      log.push(`setLineDash(${pattern.join(",")})`);
      note("setLineDash", [pattern]);
    },
    drawImage(source: unknown, x: number, y: number): void {
      log.push(`drawImage(${label(source)},${x},${y})`);
      note("drawImage", [source, x, y]);
    },
    fillText(text: string, x: number, y: number): void {
      log.push(`fillText(${text},${x},${y})`);
      note("fillText", [text, x, y]);
    },
    createLinearGradient(...args: number[]): FakeGradient {
      log.push(`createLinearGradient(${args.join(",")})`);
      note("createLinearGradient", args);
      const gradient = new FakeGradient();
      gradients.push(gradient);
      return gradient;
    },
    refuse(): void {
      note("refuse", []);
      throw new Error("this context will not do that");
    },
  };
  const ctx = new Proxy(base, {
    set(target, property, value): boolean {
      log.push(`${String(property)}=${String(value)}`);
      assigned.push([String(property), value]);
      return Reflect.set(target, property, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log, calls, assigned, gradients, values: base };
}

/** The state a frame inherited, with nothing in force unless a test says so. */
function state(overrides: Partial<DrawState> = {}): DrawState {
  return {
    properties: {},
    transform: null,
    lineDash: null,
    clip: [],
    path: [],
    ...overrides,
  };
}

/**
 * Make a stub refuse every transform but the identity.
 *
 * The identity has to keep working: blanking the surface between frames puts it in
 * force, and a context that cannot be blanked cannot be drawn into at all. What is
 * under test is the transform a STATE carries — the one a player either establishes,
 * reports, or drops silently.
 */
function refusesTransform(stub: Stub): void {
  stub.values.setTransform = (...args: number[]): void => {
    if (args.join(",") !== "1,0,0,1,0,0") {
      throw new Error("this context will not take that transform");
    }
  };
}

/** One frame naming `ops` out of the recording's table, timed and sized like any other. */
function frame(
  ops: number[],
  overrides: Partial<RecordedFrame> = {},
): RecordedFrame {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 800, height: 600 },
    state: 0,
    stack: [],
    ops,
    ...overrides,
  };
}

/**
 * A recording of the given parts, drawn at a fixed logical size.
 *
 * Every table defaults to empty and `states` to one blank state, so a test states
 * the table it is about and nothing else.
 */
function recordingOf(parts: Partial<Recording> = {}): Recording {
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background: null,
    images: [],
    resources: [],
    ops: [],
    states: [state()],
    frames: [],
    ...parts,
  };
}

/** The resources of a recording that draws no images. */
const NO_IMAGES: ReplayResources = { images: [] };

/** A captured bitmap, as the recorder wrote it — a PNG a browser decodes. */
function capture(overrides: Partial<BitmapImage> = {}): CapturedImage {
  return {
    kind: "bitmap",
    width: 16,
    height: 16,
    src: "data:image/png;base64,AAAA",
    ...overrides,
  };
}

/** An INLINE `bitmap` entry, named so a fixture can be given one field of it. */
type BitmapImage = Extract<CapturedImage, { kind: "bitmap"; src: string }>;

/**
 * A captured pixel buffer, carrying the bytes themselves.
 *
 * `bytes` is the RGBA run the entry holds, base64 encoded the way the recorder
 * writes it, so a test states the pixels it is about and the player's own decode
 * runs over them.
 */
function pixels(bytes: number[], width = 1, height = 1): CapturedImage {
  return {
    kind: "pixels",
    width,
    height,
    data: btoa(String.fromCharCode(...bytes)),
  };
}

/** A gradient recipe: the creating call, then the stops it was given. */
function gradient(stops: Array<[number, string]>): Resource {
  return {
    make: { method: "createLinearGradient", args: [0, 0, 64, 0] },
    then: stops.map(([offset, color]) => ({
      op: "call" as const,
      method: "addColorStop",
      args: [offset, color],
    })),
  };
}

describe("replaying a frame's operations", () => {
  it("re-issues a call as the build issued it", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillRect", args: [1, 2, 3, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log).toContain("fillRect(1,2,3,4)");
    expect(report).toEqual({ drawn: 1, skipped: 0, unreproducible: [] });
  });

  it("re-issues a property assignment as the build wrote it", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "set", property: "fillStyle", value: "#ff0000" }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.assigned).toContainEqual(["fillStyle", "#ff0000"]);
  });

  it("hands an argument object on field by field, including one named __proto__", () => {
    // A recording carries whatever the build passed, and JSON gives "__proto__" as
    // an ordinary field. Rebuilt onto an ordinary object that key reaches the
    // prototype setter instead of becoming a field, so the call would be issued
    // with the field missing.
    const stub = contextStub();
    const args = JSON.parse(
      '[{"a": 1, "__proto__": {"hostile": true}}, 0, 0]',
    ) as DrawValue[];
    drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "drawImage", args }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    const passed = stub.calls.find((call) => call.method === "drawImage")
      ?.args[0] as Record<string, unknown>;
    expect(Object.hasOwn(passed, "__proto__")).toBe(true);
    expect(passed.a).toBe(1);
  });

  it("issues exactly the operations the frame names, in the order it names them", () => {
    // The table holds every distinct operation the whole recording issued, in no
    // order a frame cares about. What a frame draws is its own list of indices, so
    // an operation the table holds and this frame does not name must not reach the
    // context, and one named twice must reach it twice.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [
          { op: "call", method: "fillText", args: ["never", 0, 0] },
          { op: "call", method: "fillRect", args: [8, 0, 8, 8] },
          { op: "set", property: "fillStyle", value: "#00ff00" },
          { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
        ],
        frames: [frame([2, 3, 1, 3])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-4)).toEqual([
      "fillStyle=#00ff00",
      "fillRect(0,0,8,8)",
      "fillRect(8,0,8,8)",
      "fillRect(0,0,8,8)",
    ]);
    expect(stub.log.some((entry) => entry.startsWith("fillText"))).toBe(false);
    expect(report.drawn).toBe(4);
  });

  it("wipes the surface the frame was recorded into before drawing it", () => {
    const stub = contextStub();
    drawFrame(stub.ctx, recordingOf({ frames: [frame([])] }), NO_IMAGES, 0);
    expect(stub.log[0]).toBe("setTransform(1,0,0,1,0,0)");
    expect(stub.log).toContain("clearRect(0,0,800,600)");
  });

  it("reports an operation the recording does not carry rather than drawing on", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0, 9])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.drawn).toBe(1);
    expect(report.skipped).toBe(1);
  });
});

describe("the state a frame inherited", () => {
  it("puts the inherited style in force before the frame's own operations", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillText", args: ["hello", 4, 4] }],
        states: [
          state({ properties: { font: "20px serif", fillStyle: "#abcdef" } }),
        ],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.indexOf("font=20px serif")).toBeLessThan(
      stub.log.indexOf("fillText(hello,4,4)"),
    );
    expect(stub.assigned).toContainEqual(["fillStyle", "#abcdef"]);
  });

  it("establishes the inherited transform and dash after the properties", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            properties: { lineWidth: 3 },
            transform: [2, 0, 0, 2, 10, 20],
            lineDash: [4, 2],
          }),
        ],
        frames: [frame([])],
      }),
      NO_IMAGES,
      0,
    );
    // The transform is REPLACED by `setTransform`, so it has to be established
    // after anything that might have disturbed it, and the frame's own operations
    // then build on it.
    expect(stub.log.indexOf("lineWidth=3")).toBeLessThan(
      stub.log.indexOf("setTransform(2,0,0,2,10,20)"),
    );
    expect(stub.log).toContain("setLineDash(4,2)");
  });

  it("pushes the states saved under the frame, so a restore in it returns to one", () => {
    // A build may `save()` on one frame and `restore()` on the next. The stack the
    // context had when the frame opened is part of what the frame inherited, so it
    // is re-established before the frame's own state — otherwise the operations
    // after that restore draw under the state the frame set rather than the one it
    // returned to.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({ properties: { fillStyle: "#111111" } }),
          state({ properties: { fillStyle: "#222222" } }),
        ],
        ops: [
          { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
          { op: "call", method: "restore", args: [] },
          { op: "call", method: "fillRect", args: [2, 2, 1, 1] },
        ],
        frames: [frame([0, 1, 2], { state: 1, stack: [0] })],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-8)).toEqual([
      "fillStyle=#111111",
      "beginPath()",
      "save()",
      "fillStyle=#222222",
      "beginPath()",
      "fillRect(0,0,1,1)",
      "restore()",
      "fillRect(2,2,1,1)",
    ]);
    // The fill the second rectangle was drawn under is the one the build saved.
    expect(stub.values.fillStyle).toBe("#111111");
    expect(report).toEqual({ drawn: 3, skipped: 0, unreproducible: [] });
  });

  it("pushes a level for a saved state it does not carry, and says so", () => {
    // The depth is what a restore counts. A level dropped because the recording is
    // damaged would put every operation after the restore under the wrong state,
    // which is the one failure worth refusing — so the level is pushed anyway and
    // the gap is named.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [state({ properties: { fillStyle: "#222222" } })],
        ops: [
          { op: "call", method: "restore", args: [] },
          { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
        ],
        frames: [frame([0, 1], { state: 0, stack: [7] })],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log).toContain("save()");
    expect(stub.values.fillStyle).toBe("#000000");
    expect(report.unreproducible).toEqual(["the state this frame inherited"]);
  });

  it("re-applies an inherited clip under the transform its path was issued in", () => {
    // A clip cannot be read back off a context, so it travels as the path that made
    // it, and a clip path is given in user space. Replaying the path under the
    // frame's own transform would clip a different region, so each segment
    // establishes its own transform and the frame's own follows the last of them.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            properties: { fillStyle: "#abcdef" },
            transform: [1, 0, 0, 1, 0, 0],
            clip: [
              {
                transform: [2, 0, 0, 2, 10, 20],
                ops: [
                  { op: "call", method: "beginPath", args: [] },
                  { op: "call", method: "rect", args: [0, 0, 8, 8] },
                  { op: "call", method: "clip", args: [] },
                ],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-8)).toEqual([
      "fillStyle=#abcdef",
      "setTransform(2,0,0,2,10,20)",
      "beginPath()",
      "rect(0,0,8,8)",
      "clip()",
      // The path the clip left current is closed off before the frame's own
      // operations, so the `fillRect` below is the only thing this frame fills.
      "beginPath()",
      "setTransform(1,0,0,1,0,0)",
      "fillRect(0,0,4,4)",
    ]);
    expect(report.skipped).toBe(0);
  });

  it("applies every segment of an inherited clip, because clips intersect", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            clip: [
              {
                transform: null,
                ops: [
                  { op: "call", method: "rect", args: [0, 0, 8, 8] },
                  { op: "call", method: "clip", args: [] },
                ],
              },
              {
                transform: null,
                ops: [
                  { op: "call", method: "rect", args: [4, 4, 8, 8] },
                  { op: "call", method: "clip", args: [] },
                ],
              },
            ],
          }),
        ],
        frames: [frame([])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-5)).toEqual([
      "rect(0,0,8,8)",
      "clip()",
      "rect(4,4,8,8)",
      "clip()",
      "beginPath()",
    ]);
  });

  it("reports a clip path this context cannot issue", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            clip: [
              {
                transform: null,
                ops: [
                  {
                    op: "call",
                    method: "ellipse",
                    args: [0, 0, 4, 4, 0, 0, 6],
                  },
                  { op: "call", method: "clip", args: [] },
                ],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    // The frame is still drawn — it is drawn over more of the surface than it
    // should be, which is exactly what the reviewer has to be told.
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report.drawn).toBe(1);
    expect(report.unreproducible).toEqual(["ellipse()"]);
  });

  it("reports an inherited state the recording does not carry", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0], { state: 4 })],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.unreproducible).toEqual(["the state this frame inherited"]);
    expect(report.skipped).toBe(1);
    // Drawn under whatever the context had, which is the honest best effort — and
    // named, so nobody reads the picture as the one the build drew.
    expect(stub.log).toContain("fillRect(0,0,4,4)");
  });

  it("takes the state the frame names, not the one before it", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({ properties: { font: "10px sans-serif" } }),
          state({ properties: { font: "40px serif" } }),
        ],
        frames: [frame([], { state: 0 }), frame([], { state: 1 })],
      }),
      NO_IMAGES,
      1,
    );
    expect(stub.assigned).toContainEqual(["font", "40px serif"]);
    expect(stub.log).not.toContain("font=10px sans-serif");
  });

  it("closes the clip's own path off before the frame's operations", () => {
    // THE defect this `beginPath` exists for. Re-applying an inherited clip means
    // re-issuing the path that made it, which leaves that outline current — so a
    // frame whose first operation is a bare `fill()` fills the clip outline instead
    // of the shape the build drew. Measured on a real canvas: a 30×30 rectangle
    // replaying as a fill of the whole 120×120 surface, 40,500 bytes different,
    // with the frame reporting nothing missing.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            clip: [
              {
                transform: null,
                ops: [
                  { op: "call", method: "rect", args: [0, 0, 120, 120] },
                  { op: "call", method: "clip", args: [] },
                ],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fill", args: [] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-3)).toEqual(["clip()", "beginPath()", "fill()"]);
    expect(report.skipped).toBe(0);
  });

  it("re-opens the path the frame inherited, under the transform it was issued in", () => {
    // A canvas keeps its current path across a frame boundary, so a build may open
    // a path on one frame and fill it on the next. The path is given in user space
    // like a clip is, so each segment carries its own transform and the state's own
    // transform follows the last of them.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            transform: [1, 0, 0, 1, 0, 0],
            path: [
              {
                transform: [2, 0, 0, 2, 0, 0],
                ops: [{ op: "call", method: "rect", args: [10, 10, 30, 30] }],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fill", args: [] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-5)).toEqual([
      "beginPath()",
      "setTransform(2,0,0,2,0,0)",
      "rect(10,10,30,30)",
      "setTransform(1,0,0,1,0,0)",
      "fill()",
    ]);
    expect(report.skipped).toBe(0);
  });

  it("re-opens a path whose operations were issued under two different transforms", () => {
    // The reason a path travels as SEGMENTS rather than as one run of operations:
    // a build is free to move the transform half way through building a path, and
    // a path is given in user space, so replaying the whole of it under either
    // transform draws a different shape. Each run goes back under the transform it
    // was issued in, in order, and the state's own transform follows the last.
    //
    // This is the one part of the format the differential parity test next door
    // cannot reach: no state it records carries a path of more than one segment,
    // measured at zero out of 2,114 states over 400 seeds. Its generator builds
    // each path as one uninterrupted run because `@napi-rs/canvas` disturbs a path
    // that is already open — `setTransform` re-interprets it under the new matrix,
    // where a browser leaves it where it is — so a script that moved the transform
    // mid-path would compare that host's path semantics rather than this format.
    // The coverage is therefore this document, written by hand, and a Chromium rig
    // run by hand.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            transform: [1, 0, 0, 1, 0, 0],
            path: [
              {
                transform: [2, 0, 0, 2, 0, 0],
                ops: [{ op: "call", method: "rect", args: [0, 0, 10, 10] }],
              },
              {
                transform: [1, 0, 0, 1, 40, 0],
                ops: [{ op: "call", method: "rect", args: [0, 0, 10, 10] }],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fill", args: [] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-6)).toEqual([
      "setTransform(2,0,0,2,0,0)",
      "rect(0,0,10,10)",
      "setTransform(1,0,0,1,40,0)",
      "rect(0,0,10,10)",
      "setTransform(1,0,0,1,0,0)",
      "fill()",
    ]);
    expect(report.skipped).toBe(0);
  });

  it("builds the inherited path on top of the clip rather than instead of it", () => {
    // Both are re-issued, in that order, with the `beginPath` between them: the
    // clip confines the frame and the path is what a bare `fill` fills.
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            clip: [
              {
                transform: null,
                ops: [
                  { op: "call", method: "rect", args: [0, 0, 120, 120] },
                  { op: "call", method: "clip", args: [] },
                ],
              },
            ],
            path: [
              {
                transform: null,
                ops: [{ op: "call", method: "rect", args: [10, 10, 30, 30] }],
              },
            ],
          }),
        ],
        frames: [frame([])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.slice(-4)).toEqual([
      "rect(0,0,120,120)",
      "clip()",
      "beginPath()",
      "rect(10,10,30,30)",
    ]);
  });

  it("reports a path step this context cannot issue", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            path: [
              {
                transform: null,
                ops: [
                  {
                    op: "call",
                    method: "ellipse",
                    args: [0, 0, 4, 4, 0, 0, 6],
                  },
                ],
              },
            ],
          }),
        ],
        ops: [{ op: "call", method: "fill", args: [] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    // The frame still draws, and what it fills is not the shape the build had.
    expect(stub.log).toContain("fill()");
    expect(report.unreproducible).toEqual(["ellipse()"]);
  });

  it("reports an inherited transform this context refuses instead of dropping it", () => {
    // The adjacent property assignments are guarded for exactly this reason: the
    // set of calls a context carries differs between a browser and the native
    // canvas a validator draws on. An unguarded `setTransform` throws out of
    // `drawFrame` and costs the reviewer the frame — or, worse, is dropped and
    // draws every following operation in the wrong place.
    const stub = contextStub();
    refusesTransform(stub);
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            properties: { fillStyle: "#abcdef" },
            transform: [2, 0, 0, 2, 0, 0],
          }),
        ],
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report.drawn).toBe(1);
    expect(report.unreproducible).toEqual(["setTransform()"]);
  });

  it("reports an inherited dash this context refuses instead of dropping it", () => {
    const stub = contextStub();
    stub.values.setLineDash = () => {
      throw new Error("this context will not take a dash");
    };
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [state({ lineDash: [4, 2] })],
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.drawn).toBe(1);
    expect(report.unreproducible).toEqual(["setLineDash()"]);
  });

  it("reports the transform a clip segment was issued under when this context refuses it", () => {
    const stub = contextStub();
    refusesTransform(stub);
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        states: [
          state({
            clip: [
              {
                transform: [2, 0, 0, 2, 0, 0],
                ops: [{ op: "call", method: "clip", args: [] }],
              },
            ],
          }),
        ],
        frames: [frame([])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.unreproducible).toEqual(["setTransform()"]);
  });

  it("empties the save stack it pushed before drawing the next frame", () => {
    // A player pushes a level per entry of the stack a frame inherited and the
    // frame's operations pop whichever of them the build popped. Where the context
    // has no `reset` — an older engine, a hand-written one — whatever is left
    // standing is inherited by the NEXT frame, and a `restore` in that frame pops
    // to the state the frame before it had saved rather than doing nothing.
    const stub = contextStub();
    const recording = recordingOf({
      states: [
        state({ properties: { fillStyle: "#111111" } }),
        state({ properties: { fillStyle: "#222222" } }),
      ],
      ops: [
        { op: "call", method: "restore", args: [] },
        { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
      ],
      frames: [
        // Opens with one saved state and pops nothing, so it ends a level deep.
        frame([1], { state: 1, stack: [0] }),
        // Opens with nothing saved and restores anyway, which a canvas ignores.
        frame([0, 1], { state: 1, stack: [] }),
      ],
    });
    expect("reset" in stub.ctx).toBe(false);
    drawFrame(stub.ctx, recording, NO_IMAGES, 0);
    drawFrame(stub.ctx, recording, NO_IMAGES, 1);
    // The second frame's own `restore` had nothing under it, so the rectangle is
    // drawn under the fill that frame inherited rather than under the one the
    // frame before it saved.
    expect(stub.values.fillStyle).toBe("#222222");
  });

  it("empties a level the frame's OWN save pushed, not only the ones it inherited", () => {
    // The test above pushes its level from the frame's inherited stack, so it goes
    // on passing with the counting inside the operation loop deleted. A build is
    // just as free to `save` among a frame's operations and not restore it, and
    // that level is left standing on the reviewer's context in exactly the same
    // way — the two counts are one mechanism and only one of them was covered.
    //
    // The second frame opens with nothing saved and restores anyway. That is a
    // recording a real build produces: a `canvas.width` write between the two
    // frames resets the context and empties its save stack, so the recorder's
    // shadow is empty while the level the PLAYER pushed for the first frame is
    // still on the context it is drawing into.
    const stub = contextStub();
    const recording = recordingOf({
      states: [
        state({ properties: { fillStyle: "#111111" } }),
        state({ properties: { fillStyle: "#222222" } }),
      ],
      ops: [
        { op: "call", method: "save", args: [] },
        { op: "call", method: "restore", args: [] },
        { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
      ],
      frames: [
        // Saves under its own fill and never restores: it ends a level deep.
        frame([0, 2], { state: 0, stack: [] }),
        // Opens with nothing saved and restores anyway, which a canvas ignores.
        frame([1, 2], { state: 1, stack: [] }),
      ],
    });
    expect("reset" in stub.ctx).toBe(false);
    drawFrame(stub.ctx, recording, NO_IMAGES, 0);
    drawFrame(stub.ctx, recording, NO_IMAGES, 1);
    // Under the fill the second frame inherited. With the level from the first
    // frame's own `save` left standing, this frame's `restore` pops it and the
    // rectangle lands under "#111111" — the frame before it, drawn into this one.
    expect(stub.values.fillStyle).toBe("#222222");
  });
});

describe("values the context produced", () => {
  it("rebuilds a gradient from the call that created it and applies its steps in order", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          gradient([
            [0, "#ffffff"],
            [0.5, "#888888"],
            [1, "#000000"],
          ]),
        ],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    const built = stub.gradients[0];
    expect(built).toBeDefined();
    // In order, and all of them: a gradient given its stops out of order paints a
    // different picture, and one missing a stop paints a different picture again.
    expect(built?.stops).toEqual([
      [0, "#ffffff"],
      [0.5, "#888888"],
      [1, "#000000"],
    ]);
    // The gradient the build filled with is the one this frame just built, not a
    // string standing in for it.
    expect(stub.assigned).toContainEqual(["fillStyle", built]);
    expect(report).toEqual({ drawn: 2, skipped: 0, unreproducible: [] });
  });

  it("seeks straight to a late frame and draws it under a gradient created long before it — the defect this format fixes", () => {
    // A gradient assigned to `fillStyle` survives the frame boundary, so a frame
    // nine hundred frames later INHERITS it. The recipe lives in the recording's
    // own table rather than in the frame that created it, so seeking here builds
    // the gradient against this context and fills under it. This is the frame the
    // player used to draw unfilled.
    const stub = contextStub();
    const inherited = state({ properties: { fillStyle: { $res: 0 } } });
    const frames = [frame([0, 1], { state: 0, count: 0 })];
    for (let i = 1; i <= 900; i += 1) {
      frames.push(frame([1], { state: 1, count: i }));
    }
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          gradient([
            [0, "#ffffff"],
            [1, "#000000"],
          ]),
        ],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
        ],
        states: [state(), inherited],
        frames,
      }),
      NO_IMAGES,
      900,
    );
    const built = stub.gradients[0];
    expect(built?.stops).toEqual([
      [0, "#ffffff"],
      [1, "#000000"],
    ]);
    expect(stub.assigned).toContainEqual(["fillStyle", built]);
    expect(stub.log).toContain("fillRect(0,0,64,64)");
    expect(report).toEqual({ drawn: 1, skipped: 0, unreproducible: [] });
  });

  it("builds a resource once a frame, however many operations draw with it", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({
        resources: [gradient([[0, "#ffffff"]])],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "set", property: "strokeStyle", value: { $res: 0 } },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.gradients).toHaveLength(1);
    expect(stub.assigned).toContainEqual(["fillStyle", stub.gradients[0]]);
    expect(stub.assigned).toContainEqual(["strokeStyle", stub.gradients[0]]);
  });

  it("reports a recipe this context cannot issue rather than drawing without it", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          { make: { method: "createConicGradient", args: [] }, then: [] },
        ],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.assigned).toEqual([]);
    // The fill is missing and the rectangle is still drawn, which is the honest
    // outcome: the reviewer sees the shape and is told what it should have been
    // filled with.
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual(["createConicGradient()"]);
  });

  it("refuses to assign the nothing a producing call answered", () => {
    // `createPattern` answers `null` for a source it will not take. A canvas
    // ignores `fillStyle = null` outright, so assigning it would leave the frame
    // filled with whatever colour it inherited and reported as clean — the one
    // outcome the player exists to prevent.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          {
            make: { method: "createPattern", args: ["not a source", "repeat"] },
            then: [],
          },
        ],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.assigned).toEqual([]);
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual(["createPattern()"]);
  });

  it("tries a recipe this context refuses once, however many operations name it", () => {
    // A recipe this context will not issue is refused identically every time it is
    // named, so the failure is remembered exactly as a success is: a frame that
    // fills a hundred shapes with one broken pattern must not attempt it a hundred
    // times.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [{ make: { method: "refuse", args: [] }, then: [] }],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "set", property: "strokeStyle", value: { $res: 0 } },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.calls.filter((call) => call.method === "refuse")).toHaveLength(
      1,
    );
    expect(stub.assigned).toEqual([]);
    expect(report.skipped).toBe(2);
    expect(report.unreproducible).toEqual(["refuse()"]);
  });

  it("refuses a recipe that names itself instead of recurring until the tab dies", () => {
    // Unreachable in a recording the engine wrote, and cheap to refuse: without the
    // guard the build recurs until the stack ends, which costs the reviewer the
    // page rather than one fill.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          {
            make: { method: "createLinearGradient", args: [{ $res: 0 }] },
            then: [],
          },
        ],
        ops: [{ op: "set", property: "fillStyle", value: { $res: 0 } }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.assigned).toEqual([]);
    expect(report.unreproducible).toEqual([
      "a value whose recipe refers to itself",
    ]);
  });

  it("fails the whole resource when one step of its recipe does not land", () => {
    // A gradient missing a colour stop paints a different picture, so a half-built
    // value is never handed to the context: the operations drawing with it are
    // skipped and named instead.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        resources: [
          {
            make: { method: "createLinearGradient", args: [0, 0, 64, 0] },
            then: [
              { op: "call", method: "addColorStop", args: [0, "#ffffff"] },
              { op: "call", method: "setTransform", args: [] },
              { op: "call", method: "addColorStop", args: [1, "#000000"] },
            ],
          },
        ],
        ops: [
          { op: "set", property: "fillStyle", value: { $res: 0 } },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.gradients).toHaveLength(1);
    expect(stub.assigned).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual(["setTransform()"]);
  });

  it("skips an operation carrying a value the recorder could not carry, and counts it", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [
          {
            op: "call",
            method: "drawImage",
            args: [{ $opaque: "ImageBitmap" }, 0, 0],
          },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(stub.log.some((entry) => entry.startsWith("drawImage"))).toBe(false);
    expect(report.drawn).toBe(1);
    expect(report.skipped).toBe(1);
    // Named, so the player can tell the reviewer what is missing from the picture.
    expect(report.unreproducible).toEqual(["ImageBitmap"]);
  });

  it("reports each distinct reason once, however many operations it cost", () => {
    const stub = contextStub();
    const opaque: DrawOp = {
      op: "call",
      method: "drawImage",
      args: [{ $opaque: "ImageBitmap" }, 0, 0],
    };
    const report = drawFrame(
      stub.ctx,
      recordingOf({ ops: [opaque], frames: [frame([0, 0, 0])] }),
      NO_IMAGES,
      0,
    );
    expect(report.skipped).toBe(3);
    expect(report.unreproducible).toEqual(["ImageBitmap"]);
  });

  it("does not let one operation the context rejects cost the rest of the frame", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [
          { op: "call", method: "refuse", args: [] },
          { op: "call", method: "fillRect", args: [0, 0, 2, 2] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(stub.log).toContain("fillRect(0,0,2,2)");
    expect(report.drawn).toBe(1);
    expect(report.unreproducible).toEqual(["refuse()"]);
  });

  it("skips a call to a method the context does not have", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "roundRect", args: [0, 0, 4, 4, 2] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.drawn).toBe(0);
    expect(report.unreproducible).toEqual(["roundRect()"]);
  });
});

/**
 * A document this player did not write.
 *
 * `parseRecording` checks the shape a player dispatches on, and everything inside a
 * `DrawValue` is deliberately left to the draw — which makes the draw the place
 * where a document nobody's recorder produced has to be survivable. The failure to
 * avoid is not a wrong picture but a thrown one: a `RangeError` out of `drawFrame`
 * comes out of the effect that called it and takes the page with it, so the
 * reviewer loses the run rather than one operation of one frame.
 */
describe("a value nested deeper than the format carries", () => {
  /** `value` wrapped in `depth` arrays. */
  function nested(depth: number, value: DrawValue): DrawValue {
    let built = value;
    for (let i = 0; i < depth; i += 1) built = [built];
    return built;
  }

  it("is refused rather than recurred into until the stack runs out", () => {
    const stub = contextStub();
    const recording = recordingOf({
      ops: [
        { op: "call", method: "fillText", args: [nested(20_000, "x"), 0, 0] },
      ],
      frames: [frame([0])],
    });
    let report: ReturnType<typeof drawFrame> | null = null;
    expect(() => {
      report = drawFrame(stub.ctx, recording, NO_IMAGES, 0);
    }).not.toThrow();
    expect(report).toMatchObject({
      drawn: 0,
      skipped: 1,
      unreproducible: ["a value nested deeper than this format carries"],
    });
  });

  it("does not refuse a value nested within the bound", () => {
    // The bound is the format's own: a recorder writes an opaque marker rather than
    // a structure deeper than this, so nothing a recorder produces is refused here.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [
          { op: "call", method: "fillText", args: [nested(30, "x"), 0, 0] },
        ],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.drawn).toBe(1);
  });

  it("is refused when the nesting is a chain of recipes rather than of arrays", () => {
    // The same unbounded recursion by another route: a recipe's own arguments may
    // name further resources, and the memo that stops a recipe naming ITSELF does
    // nothing about twenty thousand recipes naming each other in turn.
    const stub = contextStub();
    const resources: Resource[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      resources.push({
        make: {
          method: "createLinearGradient",
          args: [i === 19_999 ? 0 : { $res: i + 1 }],
        },
        then: [],
      });
    }
    const recording = recordingOf({
      resources,
      ops: [{ op: "set", property: "fillStyle", value: { $res: 0 } }],
      frames: [frame([0])],
    });
    let report: ReturnType<typeof drawFrame> | null = null;
    expect(() => {
      report = drawFrame(stub.ctx, recording, NO_IMAGES, 0);
    }).not.toThrow();
    expect(report).toMatchObject({
      skipped: 1,
      unreproducible: ["a value nested deeper than this format carries"],
    });
  });
});

describe("an assignment the player will not perform", () => {
  /**
   * A context shaped like a real one: its methods and its style properties live on
   * a prototype, and the instance carries none of them.
   *
   * The stub the rest of this file drives is a plain object, and on a plain object
   * `ctx.__proto__ = null` costs nothing — the methods are own properties and
   * survive. On a canvas they are not: every one of them is on
   * `CanvasRenderingContext2D.prototype`, so severing it leaves an object with no
   * `setTransform`, no `clearRect` and no `fillRect` at all. That is what makes the
   * assignment worth refusing, and it can only be demonstrated against a context
   * built the way a real one is.
   */
  class PrototypeContext {
    /** Every call this context took, in order. */
    readonly log: string[] = [];
    /** The fill in force, behind the accessor a real context puts on its prototype. */
    #fill = "#000000";
    get fillStyle(): string {
      return this.#fill;
    }
    set fillStyle(value: string) {
      this.#fill = value;
      this.log.push(`fillStyle=${value}`);
    }
    setTransform(...args: number[]): void {
      this.log.push(`setTransform(${args.join(",")})`);
    }
    clearRect(...args: number[]): void {
      this.log.push(`clearRect(${args.join(",")})`);
    }
    fillRect(...args: number[]): void {
      this.log.push(`fillRect(${args.join(",")})`);
    }
    save(): void {
      this.log.push("save()");
    }
    restore(): void {
      this.log.push("restore()");
    }
    beginPath(): void {
      this.log.push("beginPath()");
    }
  }

  /** A context of that shape, as the player takes one. */
  function prototypeContext(): {
    ctx: CanvasRenderingContext2D;
    real: PrototypeContext;
  } {
    const real = new PrototypeContext();
    return { ctx: real as unknown as CanvasRenderingContext2D, real };
  }

  it("skips a recorded assignment to __proto__ and leaves the context able to draw", () => {
    // Reachable end to end: a build that writes `ctx.__proto__ = null` — as a
    // build clearing a prototype it does not want, or as a document that came from
    // somewhere else — records exactly this operation, and performing it takes the
    // page down. The NEXT frame's blank is where it lands: `ctx.setTransform is not
    // a function`, thrown out of `drawFrame` and out of the effect that called it.
    const { ctx, real } = prototypeContext();
    const before = Object.getPrototypeOf(real) as object;
    const recording = recordingOf({
      ops: [
        { op: "set", property: "__proto__", value: null },
        { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
      ],
      frames: [frame([0, 1]), frame([1], { count: 2 })],
    });

    const first = drawFrame(ctx, recording, NO_IMAGES, 0);
    expect(first.unreproducible).toEqual(["the __proto__ property"]);
    expect(first.drawn).toBe(1);
    // The rest of the frame still draws: one operation the player will not perform
    // costs that operation and not the picture around it.
    expect(real.log).toContain("fillRect(0,0,4,4)");
    expect(Object.getPrototypeOf(real)).toBe(before);

    // And the frame after it, which is where the damage would actually surface.
    expect(() => drawFrame(ctx, recording, NO_IMAGES, 1)).not.toThrow();
  });

  it("skips __proto__ carried by the state a frame inherited", () => {
    // A style property reaches the context by the same assignment an operation
    // does, so it needs the same guard. It arrives the same way too: a state block
    // is JSON, and `JSON.parse` makes "__proto__" an ordinary own key.
    const { ctx, real } = prototypeContext();
    const before = Object.getPrototypeOf(real) as object;
    const properties = JSON.parse(
      '{"__proto__": null, "fillStyle": "#abcdef"}',
    ) as Record<string, DrawValue>;
    const report = drawFrame(
      ctx,
      recordingOf({
        states: [state({ properties })],
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.unreproducible).toEqual(["the __proto__ property"]);
    expect(Object.getPrototypeOf(real)).toBe(before);
    // The rest of the state is still established, so the frame draws under the
    // fill it inherited rather than losing the whole block to one bad name.
    expect(real.fillStyle).toBe("#abcdef");
    expect(real.log).toContain("fillRect(0,0,4,4)");
  });

  it("reports a property this context has not got instead of hanging a field on it", () => {
    // A name found nowhere on the subject would become an expando nothing draws
    // from, so the operation is a loss either way and the reviewer is told. This is
    // also what a recording taken on one context and replayed on another meets: the
    // set of properties a browser carries and a native canvas carries differ.
    const { ctx, real } = prototypeContext();
    const report = drawFrame(
      ctx,
      recordingOf({
        ops: [{ op: "set", property: "letterSpacing", value: "2px" }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report).toMatchObject({
      drawn: 0,
      skipped: 1,
      unreproducible: ["the letterSpacing property"],
    });
    expect("letterSpacing" in (real as unknown as object)).toBe(false);
  });

  it("does not report a property this context has not got when the recorded value is its default", () => {
    // A recording carries a frame's whole inherited state, so a property the build
    // never touched still travels at its default — `imageSmoothingQuality: "low"`
    // on every Chromium frame — and a browser without the property (Firefox)
    // refuses the name on every frame. Refusing a default loses nothing: the
    // context was blanked to its defaults already. Reporting it made the notice
    // appear on every frame of every replay, which is a notice nobody reads.
    const { ctx, real } = prototypeContext();
    const report = drawFrame(
      ctx,
      recordingOf({
        states: [
          state({
            properties: { imageSmoothingQuality: "low", fillStyle: "#abcdef" },
          }),
        ],
        ops: [
          { op: "set", property: "imageSmoothingQuality", value: "low" },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report).toMatchObject({ skipped: 0, unreproducible: [] });
    expect(real.fillStyle).toBe("#abcdef");
    expect(real.log).toContain("fillRect(0,0,4,4)");
    expect("imageSmoothingQuality" in (real as unknown as object)).toBe(false);
  });

  it("still reports a property this context has not got when the recorded value is not its default", () => {
    // The silence is for a no-op, not for the property: a build that asked for
    // high-quality smoothing and was drawn without it is drawn differently.
    const { ctx } = prototypeContext();
    const report = drawFrame(
      ctx,
      recordingOf({
        states: [state({ properties: { imageSmoothingQuality: "high" } })],
        ops: [{ op: "set", property: "imageSmoothingQuality", value: "high" }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report).toMatchObject({
      skipped: 2,
      unreproducible: ["the imageSmoothingQuality property"],
    });
  });

  it("performs an assignment to a property the context carries on its prototype", () => {
    // The guard has to let a real canvas property through, and on a real canvas
    // every one of them is an accessor on the prototype rather than a field of the
    // instance. A guard that asked only about own properties would refuse the whole
    // format.
    const { ctx, real } = prototypeContext();
    const report = drawFrame(
      ctx,
      recordingOf({
        ops: [
          { op: "set", property: "fillStyle", value: "#abcdef" },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ],
        frames: [frame([0, 1])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report).toEqual({ drawn: 2, skipped: 0, unreproducible: [] });
    expect(real.fillStyle).toBe("#abcdef");
  });
});

describe("a frame the recorder had to cut down", () => {
  it("reports the truncation, so a picture the format could not carry is not read as one it did", () => {
    // The recorder bounds the three shadows it keeps — the save stack, the clip
    // region, the current path — because each of them grows without limit under a
    // build that saves without restoring or never begins a path. A frame past a
    // bound inherits a state close to the build's rather than equal to it, and
    // everything the player does after that is faithful, so the frame would draw a
    // wrong picture and report nothing at all.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0], { truncated: true })],
      }),
      NO_IMAGES,
      0,
    );
    // The frame still draws — it is the best picture the format could carry, and a
    // reviewer is better off seeing it with the caveat than not seeing it.
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report).toEqual({
      drawn: 1,
      skipped: 1,
      unreproducible: [
        "a save stack, clip or path too deep for this format to carry",
      ],
    });
  });

  it("says nothing about a frame the recorder carried whole", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "fillRect", args: [0, 0, 4, 4] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report).toEqual({ drawn: 1, skipped: 0, unreproducible: [] });
  });
});

describe("the images a build blits", () => {
  /**
   * What an entry carries: a bitmap's PNG, a pixel buffer's bytes, or the name of
   * the file it keeps them in.
   */
  const carried = (image: CapturedImage): string =>
    "store" in image
      ? image.store
      : image.kind === "bitmap"
        ? image.src
        : image.data;

  /** Decode every capture to a sentinel naming what it carried, as a browser would to pixels. */
  const decodesToSentinel = async (
    image: CapturedImage,
  ): Promise<DecodedImage> =>
    ({ decoded: carried(image) }) as unknown as DecodedImage;

  it("decodes every captured image once, in the order the table holds them", async () => {
    const seen: string[] = [];
    const recording = recordingOf({
      images: [capture({ src: "a" }), pixels([1, 2, 3, 4])],
    });
    const resources = await prepareRecording(recording, async (image) => {
      seen.push(`${image.kind}:${carried(image)}`);
      return { decoded: carried(image) } as unknown as DecodedImage;
    });
    expect(seen).toEqual([
      "bitmap:a",
      `pixels:${btoa("\u0001\u0002\u0003\u0004")}`,
    ]);
    expect(resources.images).toHaveLength(2);
  });

  it("hands the decoded image itself to the call that draws it", async () => {
    const stub = contextStub();
    const recording = recordingOf({
      images: [capture()],
      ops: [{ op: "call", method: "drawImage", args: [{ $img: 0 }, 12, 34] }],
      frames: [frame([0])],
    });
    const resources = await prepareRecording(recording, decodesToSentinel);
    const report = drawFrame(stub.ctx, recording, resources, 0);
    // Identity, not shape: what reaches `drawImage` has to be the thing the
    // decoder produced, because that is the only value a context can blit.
    expect(stub.calls).toContainEqual({
      method: "drawImage",
      args: [resources.images[0], 12, 34],
    });
    expect(report).toEqual({ drawn: 1, skipped: 0, unreproducible: [] });
  });

  it("resolves an image named inside a resource's recipe", async () => {
    const stub = contextStub();
    const recording = recordingOf({
      images: [capture()],
      resources: [
        {
          make: {
            method: "createLinearGradient",
            args: [{ $img: 0 }, "repeat"],
          },
          then: [],
        },
      ],
      ops: [{ op: "set", property: "fillStyle", value: { $res: 0 } }],
      frames: [frame([0])],
    });
    const resources = await prepareRecording(recording, decodesToSentinel);
    const report = drawFrame(stub.ctx, recording, resources, 0);
    expect(stub.calls).toContainEqual({
      method: "createLinearGradient",
      args: [resources.images[0], "repeat"],
    });
    expect(report.skipped).toBe(0);
  });

  it("skips an image that would not decode, names it, and draws the rest of the frame", async () => {
    const stub = contextStub();
    const recording = recordingOf({
      images: [capture({ src: "broken" }), capture({ src: "fine" })],
      ops: [
        { op: "call", method: "drawImage", args: [{ $img: 0 }, 0, 0] },
        { op: "call", method: "drawImage", args: [{ $img: 1 }, 8, 8] },
        { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
      ],
      frames: [frame([0, 1, 2])],
    });
    const resources = await prepareRecording(recording, async (image) => {
      if (carried(image) === "broken") throw new Error("this is not a PNG");
      return { decoded: carried(image) } as unknown as DecodedImage;
    });
    // A recording whose images fail still plays: only the operations naming them
    // are lost.
    expect(resources.images[0]).toBeNull();
    const report = drawFrame(stub.ctx, recording, resources, 0);
    expect(stub.calls).toContainEqual({
      method: "drawImage",
      args: [resources.images[1], 8, 8],
    });
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(report.drawn).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual([
      "an image that could not be loaded",
    ]);
  });

  it("reports an image the recording does not carry as a missing entry, not as a broken decode", () => {
    // The two are different findings for whoever reads the note: an index past the
    // end of the table is a damaged recording, and an entry that would not decode
    // is this browser. The counts are the same either way, so the reason is what
    // has to be asserted.
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({
        ops: [{ op: "call", method: "drawImage", args: [{ $img: 3 }, 0, 0] }],
        frames: [frame([0])],
      }),
      NO_IMAGES,
      0,
    );
    expect(report.drawn).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual([
      "a value this replay does not carry",
    ]);
  });
});

describe("seeking", () => {
  /** Four frames, each drawing its own label out of one shared operation table. */
  function labelled(): Recording {
    return recordingOf({
      ops: [0, 1, 2, 3].map((n) => ({
        op: "call" as const,
        method: "fillText",
        args: [`frame ${n}`, n, n],
      })),
      frames: [0, 1, 2, 3].map((n) => frame([n], { count: n })),
    });
  }

  it("issues only the frame asked for, never the frames before it", () => {
    const stub = contextStub();
    drawFrame(stub.ctx, labelled(), NO_IMAGES, 2);
    const drawn = stub.log.filter((entry) => entry.startsWith("fillText"));
    expect(drawn).toEqual(["fillText(frame 2,2,2)"]);
  });

  it("draws any frame at the same cost, in either direction", () => {
    const stub = contextStub();
    const recording = labelled();
    drawFrame(stub.ctx, recording, NO_IMAGES, 3);
    drawFrame(stub.ctx, recording, NO_IMAGES, 1);
    expect(stub.log.filter((entry) => entry.startsWith("fillText"))).toEqual([
      "fillText(frame 3,3,3)",
      "fillText(frame 1,1,1)",
    ]);
  });

  it("draws nothing for a frame the recording does not have", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf({ frames: [frame([])] }),
      NO_IMAGES,
      4,
    );
    expect(stub.log).toEqual([]);
    expect(report).toEqual({ drawn: 0, skipped: 0, unreproducible: [] });
  });
});

describe("the background", () => {
  it("lays down the colour the frames were cleared to before replaying them", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({ background: "#202020", frames: [frame([])] }),
      NO_IMAGES,
      0,
    );
    expect(stub.assigned).toContainEqual(["fillStyle", "#202020"]);
    expect(stub.log).toContain("fillRect(0,0,800,600)");
  });

  it("leaves the surface transparent when the recording was", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf({ background: null, frames: [frame([])] }),
      NO_IMAGES,
      0,
    );
    expect(stub.log.some((entry) => entry.startsWith("fillRect"))).toBe(false);
  });
});

/**
 * The decoder a reviewer's browser actually runs.
 *
 * Every test above hands `prepareRecording` a decoder of its own, so the module's
 * own decode path — the one that turns a captured PNG back into something a
 * context can be handed — would otherwise never execute at all. jsdom supplies
 * neither an image decoder nor a canvas backend (`src/test/setup.ts` answers
 * `getContext` with `null`), so what is stubbed here is the platform UNDER the
 * decoder, while every line of the decoder itself runs.
 */
describe("decoding a captured image", () => {
  /** How the stub image element answers the source it is given. */
  type Answer = "decodes" | "rejects" | "loads" | "fails" | "stalls";

  /** Stand in for the browser's image element, answering however the test says. */
  function stubImages(answer: Answer): void {
    class StubImage {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode?: () => Promise<void>;
      constructor() {
        if (answer === "decodes") this.decode = () => Promise.resolve();
        if (answer === "rejects") {
          this.decode = () => Promise.reject(new Error("not a PNG"));
        }
        // Neither settles, which is the case a timeout exists for: a browser that
        // drops a decode reports no load and no error.
        if (answer === "stalls")
          this.decode = () => new Promise<void>(() => {});
        // The platforms without `decode()` answer through the load events instead,
        // which the decoder attaches before this microtask runs.
        if (answer === "loads") queueMicrotask(() => this.onload?.());
        if (answer === "fails") queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", StubImage);
  }

  /**
   * Give the environment the `ImageData` a browser has and jsdom does not.
   *
   * The buffer a `pixels` entry rebuilds into is the whole of what is under test
   * here, so the stub keeps the three things the constructor was handed and nothing
   * else. Every byte in it came out of the player's own decode.
   */
  function stubImageData(): void {
    class StubImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    vi.stubGlobal("ImageData", StubImageData);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hands a bitmap entry back as the picture the browser decoded", async () => {
    stubImages("decodes");
    const recording = recordingOf({
      images: [capture({ src: "data:image/png;base64,AAAA" })],
    });
    const resources = await prepareRecording(recording);
    expect((resources.images[0] as HTMLImageElement).src).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("waits on the load events where the platform has no decode()", async () => {
    stubImages("loads");
    const resources = await prepareRecording(
      recordingOf({ images: [capture()] }),
    );
    expect(resources.images[0]).not.toBeNull();

    stubImages("fails");
    const failed = await prepareRecording(recordingOf({ images: [capture()] }));
    expect(failed.images[0]).toBeNull();
  });

  it("reports an entry this browser refuses as nothing to draw", async () => {
    stubImages("rejects");
    const resources = await prepareRecording(
      recordingOf({ images: [capture()] }),
    );
    // The replay still plays: the operations naming the entry are the only loss,
    // and `drawFrame` names them.
    expect(resources.images).toEqual([null]);
  });

  it("gives up on an entry that neither decodes nor fails", async () => {
    // Without a bound this is the worst outcome the player has: the whole page sits
    // on "Loading the replay…" for as long as the tab is open, with nothing drawn
    // and nothing said. The sentinel is what makes this test fail rather than hang
    // if the bound goes away.
    vi.useFakeTimers();
    stubImages("stalls");
    const prepared = prepareRecording(recordingOf({ images: [capture()] }));
    const outcome = Promise.race([
      prepared.then(() => "gave up" as const),
      new Promise<"still waiting">((resolve) => {
        setTimeout(() => resolve("still waiting"), 600_000);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(await outcome).toBe("gave up");
    expect((await prepared).images).toEqual([null]);
  });

  it("rebuilds a pixel buffer as the bytes the recording carries, exactly", async () => {
    // The bytes, not the mechanism. `putImageData` writes what it is handed, so a
    // pixel buffer that comes back changed is a check comparing the wrong picture —
    // and the two channels below are the ones a canvas round trip would move: a
    // partly transparent pixel is premultiplied on the way into a canvas and
    // un-premultiplied on the way out, which quantises it to eight bits twice.
    stubImageData();
    // (200, 100, 50) at alpha 128, and an opaque neighbour to fix the row order.
    const bytes = [200, 100, 50, 128, 1, 2, 3, 255];
    const resources = await prepareRecording(
      recordingOf({ images: [pixels(bytes, 2, 1)] }),
    );
    const rebuilt = resources.images[0] as ImageData;
    expect([...rebuilt.data]).toEqual(bytes);
    expect(rebuilt.width).toBe(2);
    expect(rebuilt.height).toBe(1);
  });

  it("rebuilds a pixel buffer with no decoder at all", async () => {
    // Synchronously, from the entry's own bytes: no image element, no
    // `createImageBitmap`, no canvas. An environment with none of the three still
    // rebuilds the buffer, which is what makes the bytes exact rather than close.
    stubImageData();
    vi.stubGlobal("Image", undefined);
    vi.stubGlobal("createImageBitmap", undefined);
    const resources = await prepareRecording(
      recordingOf({ images: [pixels([9, 8, 7, 6])] }),
    );
    expect([...(resources.images[0] as ImageData).data]).toEqual([9, 8, 7, 6]);
  });

  it("refuses a pixel buffer that is not the size it says it is", async () => {
    // Four bytes are one pixel, not four. Rebuilding it anyway would put a picture
    // on screen that the recording does not hold, so the entry is refused and the
    // operations naming it are reported.
    stubImageData();
    const resources = await prepareRecording(
      recordingOf({ images: [pixels([1, 2, 3, 4], 2, 2)] }),
    );
    expect(resources.images).toEqual([null]);
  });

  it("reports a pixel buffer whose bytes are not base64", async () => {
    stubImageData();
    const resources = await prepareRecording(
      recordingOf({
        images: [{ kind: "pixels", width: 1, height: 1, data: "not base64!" }],
      }),
    );
    expect(resources.images).toEqual([null]);
  });

  // ---- Entries kept beside the recording ---------------------------------
  //
  // A writer with somewhere to put them stores an image's bytes in a flat file and
  // leaves the entry naming that file. The name is resolved by the caller, through
  // the same function that produced the recording's own URL, because the file lives
  // in the same namespace the recording does — deriving it here from the recording's
  // URL would name a file that does not exist wherever the host keys media by a
  // content digest, which the published gallery does.

  it("loads a stored bitmap from the URL the resolver answers", async () => {
    stubImages("decodes");
    const recording = recordingOf({
      images: [{ kind: "bitmap", width: 16, height: 16, store: "img.ab.png" }],
    });
    const asked: string[] = [];
    const resources = await prepareRecording(recording, undefined, (file) => {
      asked.push(file);
      return `https://media.example/runs/r1/validation/${file}`;
    });
    // The file NAME reaches the resolver; the URL reaches the image element. A
    // stored bitmap goes through the very same element an inline one does, which is
    // what gets it the browser's HTTP cache across every replay of the run.
    expect(asked).toEqual(["img.ab.png"]);
    expect((resources.images[0] as HTMLImageElement).src).toBe(
      "https://media.example/runs/r1/validation/img.ab.png",
    );
  });

  it("rebuilds a stored pixel buffer from the raw bytes it fetches", async () => {
    // Stored raw rather than base64: a file has no reason to pay base64's third,
    // and this is the one kind of image a check compares byte for byte, so the
    // bytes that come back have to be the bytes that were captured.
    stubImageData();
    const bytes = [200, 100, 50, 128, 1, 2, 3, 255];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("https://media.example/img.cd.bin");
        return new Response(new Uint8Array(bytes));
      }),
    );
    const resources = await prepareRecording(
      recordingOf({
        images: [{ kind: "pixels", width: 2, height: 1, store: "img.cd.bin" }],
      }),
      undefined,
      (file) => `https://media.example/${file}`,
    );
    const rebuilt = resources.images[0] as ImageData;
    expect([...rebuilt.data]).toEqual(bytes);
    expect(rebuilt.width).toBe(2);
    expect(rebuilt.height).toBe(1);
  });

  it("refuses a stored pixel buffer that is not the size it says it is", async () => {
    // The length check is the one thing this format is exact about, and it has to
    // hold whichever way the bytes arrived — otherwise the stored path is a second
    // way in that skips it.
    stubImageData();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]))),
    );
    const resources = await prepareRecording(
      recordingOf({
        images: [{ kind: "pixels", width: 2, height: 2, store: "img.ef.bin" }],
      }),
      undefined,
      (file) => `https://media.example/${file}`,
    );
    expect(resources.images).toEqual([null]);
  });

  it("reports a stored buffer the host would not serve", async () => {
    // An error page is bytes too. Rebuilding an `ImageData` out of one would put a
    // wall of noise on the canvas and report the frame as clean.
    stubImageData();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const resources = await prepareRecording(
      recordingOf({
        images: [{ kind: "pixels", width: 1, height: 1, store: "img.gh.bin" }],
      }),
      undefined,
      (file) => `https://media.example/${file}`,
    );
    expect(resources.images).toEqual([null]);
  });

  it("reports a stored entry no resolver can reach", async () => {
    // Two ways a host has nothing to reach the files with: it supplied no resolver
    // at all (every showcase call site), or its resolver answers nothing for this
    // name. Both are the `null` entry an undecodable PNG becomes, so the replay
    // plays with the operations naming it skipped and named — never a hole reported
    // as a clean frame.
    stubImages("decodes");
    const recording = recordingOf({
      images: [{ kind: "bitmap", width: 4, height: 4, store: "img.ij.png" }],
    });
    expect((await prepareRecording(recording)).images).toEqual([null]);
    expect(
      (await prepareRecording(recording, undefined, () => null)).images,
    ).toEqual([null]);
  });

  it("prefers the stored bytes of an entry that carries both", async () => {
    // Over-specified rather than damaged: the parser accepts it, and the decoder
    // takes the stored side so an entry's two payloads can never be drawn as two
    // different pictures depending on which reader met it.
    stubImages("decodes");
    const resources = await prepareRecording(
      recordingOf({
        images: [
          {
            kind: "bitmap",
            width: 4,
            height: 4,
            src: "data:image/png;base64,AAAA",
            store: "img.kl.png",
          } as unknown as CapturedImage,
        ],
      }),
      undefined,
      (file) => `https://media.example/${file}`,
    );
    expect((resources.images[0] as HTMLImageElement).src).toBe(
      "https://media.example/img.kl.png",
    );
  });
});
