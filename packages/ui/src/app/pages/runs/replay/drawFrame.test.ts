import { describe, expect, it } from "vitest";
import { drawFrame } from "./drawFrame";
import {
  RECORDING_FORMAT,
  type DrawOp,
  type DrawState,
  type RecordedFrame,
  type Recording,
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
 * frame is drawn from itself. Seeking to frame 900 must issue frame 900's
 * operations and nobody else's, or two recordings could not be scrubbed in step
 * and a seek would cost the whole history before it.
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
  /** Property assignments with their real values, for identity checks. */
  assigned: Array<[string, unknown]>;
  gradients: FakeGradient[];
}

/**
 * A context that records what actually reached it.
 *
 * Calls and assignments share one log because the order between them is itself
 * under test: a frame's inherited style has to be in force before its operations
 * run, and its transform has to be established after the properties that might
 * have disturbed it.
 */
function contextStub(): Stub {
  const log: string[] = [];
  const assigned: Array<[string, unknown]> = [];
  const gradients: FakeGradient[] = [];
  const base = {
    fillStyle: "#000000" as unknown,
    strokeStyle: "#000000" as unknown,
    font: "10px sans-serif",
    lineWidth: 1,
    setTransform(...args: number[]): void {
      log.push(`setTransform(${args.join(",")})`);
    },
    clearRect(...args: number[]): void {
      log.push(`clearRect(${args.join(",")})`);
    },
    fillRect(...args: number[]): void {
      log.push(`fillRect(${args.join(",")})`);
    },
    setLineDash(pattern: number[]): void {
      log.push(`setLineDash(${pattern.join(",")})`);
    },
    drawImage(source: unknown, x: number, y: number): void {
      log.push(`drawImage(${String(source)},${x},${y})`);
    },
    fillText(text: string, x: number, y: number): void {
      log.push(`fillText(${text},${x},${y})`);
    },
    createLinearGradient(...args: number[]): FakeGradient {
      log.push(`createLinearGradient(${args.join(",")})`);
      const gradient = new FakeGradient();
      gradients.push(gradient);
      return gradient;
    },
    refuse(): void {
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
  return { ctx, log, assigned, gradients };
}

/** The state a frame inherited, with nothing in force unless a test says so. */
function state(overrides: Partial<DrawState> = {}): DrawState {
  return { properties: {}, transform: null, lineDash: null, ...overrides };
}

/** One frame carrying `ops`, timed and sized like any other. */
function frame(
  ops: DrawOp[],
  overrides: Partial<RecordedFrame> = {},
): RecordedFrame {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 800, height: 600 },
    state: state(),
    ops,
    ...overrides,
  };
}

/** A recording of the given frames, drawn at a fixed logical size. */
function recordingOf(
  frames: RecordedFrame[],
  background: string | null = null,
): Recording {
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background,
    frames,
  };
}

describe("replaying a frame's operations", () => {
  it("re-issues a call as the build issued it", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf([
        frame([{ op: "call", method: "fillRect", args: [1, 2, 3, 4] }]),
      ]),
      0,
    );
    expect(stub.log).toContain("fillRect(1,2,3,4)");
    expect(report).toEqual({ drawn: 1, skipped: 0, unreproducible: [] });
  });

  it("re-issues a property assignment as the build wrote it", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf([
        frame([{ op: "set", property: "fillStyle", value: "#ff0000" }]),
      ]),
      0,
    );
    expect(stub.assigned).toContainEqual(["fillStyle", "#ff0000"]);
  });

  it("keeps the operations in the order the build issued them", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf([
        frame([
          { op: "set", property: "fillStyle", value: "#00ff00" },
          { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
          { op: "set", property: "fillStyle", value: "#0000ff" },
          { op: "call", method: "fillRect", args: [8, 0, 8, 8] },
        ]),
      ]),
      0,
    );
    expect(stub.log.slice(-4)).toEqual([
      "fillStyle=#00ff00",
      "fillRect(0,0,8,8)",
      "fillStyle=#0000ff",
      "fillRect(8,0,8,8)",
    ]);
  });

  it("wipes the surface the frame was recorded into before drawing it", () => {
    const stub = contextStub();
    drawFrame(stub.ctx, recordingOf([frame([])]), 0);
    expect(stub.log[0]).toBe("setTransform(1,0,0,1,0,0)");
    expect(stub.log).toContain("clearRect(0,0,800,600)");
  });
});

describe("the state a frame inherited", () => {
  it("puts the inherited style in force before the frame's own operations", () => {
    const stub = contextStub();
    drawFrame(
      stub.ctx,
      recordingOf([
        frame([{ op: "call", method: "fillText", args: ["hello", 4, 4] }], {
          state: state({
            properties: { font: "20px serif", fillStyle: "#abcdef" },
          }),
        }),
      ]),
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
      recordingOf([
        frame([], {
          state: state({
            properties: { lineWidth: 3 },
            transform: [2, 0, 0, 2, 10, 20],
            lineDash: [4, 2],
          }),
        }),
      ]),
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
});

describe("values the frame refers to", () => {
  it("reconstructs a gradient from the call that created it and the stops it was given", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf([
        frame([
          {
            op: "call",
            method: "createLinearGradient",
            args: [0, 0, 64, 0],
            id: 3,
          },
          {
            op: "call",
            target: 3,
            method: "addColorStop",
            args: [0, "#ffffff"],
          },
          {
            op: "call",
            target: 3,
            method: "addColorStop",
            args: [1, "#000000"],
          },
          { op: "set", property: "fillStyle", value: { $ref: 3 } },
          { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
        ]),
      ]),
      0,
    );
    const gradient = stub.gradients[0];
    expect(gradient).toBeDefined();
    expect(gradient?.stops).toEqual([
      [0, "#ffffff"],
      [1, "#000000"],
    ]);
    // The gradient the build filled with is the one this frame just built, not a
    // string standing in for it.
    expect(stub.assigned).toContainEqual(["fillStyle", gradient]);
    expect(report.skipped).toBe(0);
    expect(report.drawn).toBe(5);
  });

  it("skips an operation carrying a value the recorder could not carry, and counts it", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf([
        frame([
          {
            op: "call",
            method: "drawImage",
            args: [{ $opaque: "ImageBitmap" }, 0, 0],
          },
          { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
        ]),
      ]),
      0,
    );
    expect(stub.log).toContain("fillRect(0,0,4,4)");
    expect(stub.log.some((entry) => entry.startsWith("drawImage"))).toBe(false);
    expect(report.drawn).toBe(1);
    expect(report.skipped).toBe(1);
    // Named, so the player can tell the reviewer what is missing from the picture.
    expect(report.unreproducible).toEqual(["ImageBitmap"]);
  });

  it("skips a reference to a value created before this frame rather than guessing", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      // The recorder interns a value once and writes every later use as a
      // reference, so a gradient built on frame 1 reaches frame 900 as a reference
      // to a call frame 900 does not contain.
      recordingOf([
        frame([{ op: "set", property: "fillStyle", value: { $ref: 7 } }]),
      ]),
      0,
    );
    expect(stub.assigned).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(report.unreproducible).toEqual([
      "a value created before this frame",
    ]);
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
      recordingOf([frame([opaque, opaque, opaque])]),
      0,
    );
    expect(report.skipped).toBe(3);
    expect(report.unreproducible).toEqual(["ImageBitmap"]);
  });

  it("does not let one operation the context rejects cost the rest of the frame", () => {
    const stub = contextStub();
    const report = drawFrame(
      stub.ctx,
      recordingOf([
        frame([
          { op: "call", method: "refuse", args: [] },
          { op: "call", method: "fillRect", args: [0, 0, 2, 2] },
        ]),
      ]),
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
      recordingOf([
        frame([{ op: "call", method: "roundRect", args: [0, 0, 4, 4, 2] }]),
      ]),
      0,
    );
    expect(report.drawn).toBe(0);
    expect(report.unreproducible).toEqual(["roundRect()"]);
  });
});

describe("seeking", () => {
  it("issues only the frame asked for, never the frames before it", () => {
    const stub = contextStub();
    const frames = [0, 1, 2, 3].map((n) =>
      frame([{ op: "call", method: "fillText", args: [`frame ${n}`, n, n] }], {
        count: n,
      }),
    );
    drawFrame(stub.ctx, recordingOf(frames), 2);
    const drawn = stub.log.filter((entry) => entry.startsWith("fillText"));
    expect(drawn).toEqual(["fillText(frame 2,2,2)"]);
  });

  it("draws any frame at the same cost, in either direction", () => {
    const stub = contextStub();
    const frames = [0, 1, 2, 3].map((n) =>
      frame([{ op: "call", method: "fillText", args: [`frame ${n}`, n, n] }], {
        count: n,
      }),
    );
    const recording = recordingOf(frames);
    drawFrame(stub.ctx, recording, 3);
    drawFrame(stub.ctx, recording, 1);
    expect(stub.log.filter((entry) => entry.startsWith("fillText"))).toEqual([
      "fillText(frame 3,3,3)",
      "fillText(frame 1,1,1)",
    ]);
  });

  it("draws nothing for a frame the recording does not have", () => {
    const stub = contextStub();
    const report = drawFrame(stub.ctx, recordingOf([frame([])]), 4);
    expect(stub.log).toEqual([]);
    expect(report).toEqual({ drawn: 0, skipped: 0, unreproducible: [] });
  });
});

describe("the background", () => {
  it("lays down the colour the frames were cleared to before replaying them", () => {
    const stub = contextStub();
    drawFrame(stub.ctx, recordingOf([frame([])], "#202020"), 0);
    expect(stub.assigned).toContainEqual(["fillStyle", "#202020"]);
    expect(stub.log).toContain("fillRect(0,0,800,600)");
  });

  it("leaves the surface transparent when the recording was", () => {
    const stub = contextStub();
    drawFrame(stub.ctx, recordingOf([frame([])], null), 0);
    expect(stub.log.some((entry) => entry.startsWith("fillRect"))).toBe(false);
  });
});
