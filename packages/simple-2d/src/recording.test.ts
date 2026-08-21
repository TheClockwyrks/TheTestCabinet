import { describe, expect, it } from "vitest";
import type { DrawOp, DrawValue } from "./contract";
import { ContextRecorder, RECORDING_FORMAT } from "./recording";

/**
 * Unit tests over the recorder alone, driven against a hand-written context.
 *
 * The engine's own suite covers the wiring — which frames are bracketed and what a
 * recording says about them. What is checked here is the part a replay depends on
 * and nothing else can establish: that an operation is recorded as the build issued
 * it, that a value the context produced survives the round trip as a reference to
 * the operation that produced it, and that the wrapper is invisible to the context
 * underneath it.
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
  calls: string[];
  gradients: FakeGradient[];
  assigned: Array<[string, unknown]>;
}

/**
 * A context that records what actually reached it.
 *
 * Separate from what the recorder records on purpose: the two lists are compared
 * against each other, which is what shows the wrapper forwards faithfully rather
 * than merely logging plausibly.
 */
function contextStub(): Stub {
  const calls: string[] = [];
  const gradients: FakeGradient[] = [];
  const assigned: Array<[string, unknown]> = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const stub = {
    fillStyle: "#000000" as unknown,
    strokeStyle: "#000000" as unknown,
    font: "10px sans-serif",
    globalAlpha: 1,
    lineWidth: 1,
    fillRect(...args: number[]): void {
      calls.push(`fillRect(${args.join(",")})`);
    },
    setTransform(...args: number[]): void {
      transform = args;
      calls.push(`setTransform(${args.join(",")})`);
    },
    getTransform(): DOMMatrix {
      const [a, b, c, d, e, f] = transform as [number, number, number, number, number, number];
      return { a, b, c, d, e, f } as DOMMatrix;
    },
    getLineDash(): number[] {
      return [];
    },
    createLinearGradient(...args: number[]): FakeGradient {
      calls.push(`createLinearGradient(${args.join(",")})`);
      const gradient = new FakeGradient();
      gradients.push(gradient);
      return gradient;
    },
  };
  // Property assignment is observed through a second proxy underneath the
  // recorder's, so a test can tell what the context was actually given — in
  // particular whether it was given a wrapper where it expects one of its own
  // objects, which is the failure that only shows up against a real canvas.
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

/** The one frame a recorder closed, with its operations. */
function closeOne(recorder: ContextRecorder): readonly DrawOp[] {
  recorder.endFrame({ count: 1, timeMs: 16, deltaMs: 16 }, { width: 1280, height: 720 });
  const recording = recorder.stop();
  expect(recording.frames).toHaveLength(1);
  return recording.frames[0]!.ops;
}

describe("forwarding", () => {
  it("passes calls through to the context unchanged", () => {
    const { recorder, stub } = armed();

    recorder.context.fillRect(1, 2, 3, 4);

    expect(stub.calls).toEqual(["fillRect(1,2,3,4)"]);
  });

  it("passes property assignments through to the context unchanged", () => {
    const { recorder, stub } = armed();

    recorder.context.fillStyle = "#ff0000";

    expect(stub.assigned).toEqual([["fillStyle", "#ff0000"]]);
  });

  it("hands back the same method object every time, rather than a fresh closure", () => {
    const { recorder } = armed();

    expect(recorder.context.fillRect).toBe(recorder.context.fillRect);
  });

  it("records nothing while disarmed, and still forwards", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);

    recorder.context.fillRect(0, 0, 1, 1);
    recorder.context.fillStyle = "#fff";

    expect(recorder.active).toBe(false);
    expect(stub.calls).toEqual(["fillRect(0,0,1,1)"]);
    expect(stub.assigned).toEqual([["fillStyle", "#fff"]]);
  });
});

describe("operations", () => {
  it("records a call as the method and the arguments it was given", () => {
    const { recorder } = armed();

    recorder.context.fillRect(1, 2, 3, 4);

    expect(closeOne(recorder)).toEqual([{ op: "call", method: "fillRect", args: [1, 2, 3, 4] }]);
  });

  it("records a property set as the value the build wrote, not the normalized one", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = "#fff";

    expect(closeOne(recorder)).toEqual([{ op: "set", property: "fillStyle", value: "#fff" }]);
  });

  it("keeps operations in the order they were issued", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = "#ff0000";
    recorder.context.fillRect(0, 0, 10, 10);
    recorder.context.fillStyle = "#00ff00";

    const ops = closeOne(recorder);
    expect(ops.map((op) => (op.op === "call" ? op.method : op.property))).toEqual([
      "fillStyle",
      "fillRect",
      "fillStyle",
    ]);
  });
});

describe("interned values", () => {
  it("records a gradient's colour stops against the call that created it", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");

    const ops = closeOne(recorder);
    expect(ops[0]).toEqual({
      op: "call",
      method: "createLinearGradient",
      args: [0, 0, 10, 0],
      id: 0,
    });
    expect(ops[1]).toEqual({ op: "call", target: 0, method: "addColorStop", args: [0, "#000"] });
    expect(ops[2]).toEqual({ op: "call", target: 0, method: "addColorStop", args: [1, "#fff"] });
  });

  it("records a later use of the gradient as a reference to that call", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    recorder.context.fillStyle = gradient;

    const ops = closeOne(recorder);
    expect(ops.at(-1)).toEqual({ op: "set", property: "fillStyle", value: { $ref: 0 } });
  });

  it("gives the context the real gradient rather than the wrapper it handed out", () => {
    const { recorder, stub } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0.5, "#abc");
    recorder.context.fillStyle = gradient;

    // The colour stop reached the real object, and the assignment received it —
    // a native context refuses a proxy where it expects one of its own values.
    expect(stub.gradients[0]?.stops).toEqual([[0.5, "#abc"]]);
    expect(stub.assigned).toEqual([["fillStyle", stub.gradients[0]]]);
  });

  it("carries a value it cannot reproduce as a marker naming its type", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = new Date(0) as unknown as string;

    const ops = closeOne(recorder);
    expect(ops[0]).toEqual({ op: "set", property: "fillStyle", value: { $opaque: "Date" } });
  });
});

describe("frames", () => {
  it("captures the state a frame inherited, before the frame's own operations", () => {
    const stub = contextStub();
    stub.ctx.fillStyle = "#123456";
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 640, height: 360, background: null });

    recorder.beginFrame();
    recorder.context.fillStyle = "#654321";
    recorder.endFrame({ count: 1, timeMs: 16, deltaMs: 16 }, { width: 64, height: 36 });
    const recording = recorder.stop();

    expect(recording.frames[0]?.state.properties["fillStyle"]).toBe("#123456");
  });

  it("carries the transform and the surface each frame was drawn under", () => {
    const { recorder } = armed();
    recorder.context.setTransform(2, 0, 0, 2, 8, 4);

    recorder.endFrame({ count: 7, timeMs: 116, deltaMs: 16 }, { width: 1280, height: 720 });
    const frame = recorder.stop().frames[0];

    expect(frame?.count).toBe(7);
    expect(frame?.timeMs).toBe(116);
    expect(frame?.deltaMs).toBe(16);
    expect(frame?.surface).toEqual({ width: 1280, height: 720 });
    // The transform recorded on the state is the one the frame *inherited*; the
    // frame's own `setTransform` is an operation inside it.
    expect(frame?.state.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("drops a frame that was still open when the recording was taken", () => {
    const { recorder } = armed();
    recorder.context.fillRect(0, 0, 1, 1);

    // No `endFrame`: the recording is taken mid-frame.
    expect(recorder.stop().frames).toEqual([]);
  });

  it("reports the design size and background it was armed with", () => {
    const { recorder } = armed();

    const recording = recorder.stop();

    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.width).toBe(640);
    expect(recording.height).toBe(360);
    expect(recording.background).toBe("#101018");
  });

  it("keeps every frame it closed, in order", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    for (let n = 1; n <= 3; n += 1) {
      recorder.beginFrame();
      recorder.context.fillRect(n, 0, 1, 1);
      recorder.endFrame({ count: n, timeMs: n * 16, deltaMs: 16 }, { width: 8, height: 8 });
    }

    const frames = recorder.stop().frames;
    expect(frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(frames.map((frame) => (frame.ops[0] as { args: DrawValue[] }).args[0])).toEqual([
      1, 2, 3,
    ]);
  });

  it("starts a second recording empty rather than resuming the first", () => {
    const { recorder } = armed();
    recorder.context.fillRect(0, 0, 1, 1);
    recorder.endFrame({ count: 1, timeMs: 16, deltaMs: 16 }, { width: 8, height: 8 });
    recorder.stop();

    recorder.start({ width: 8, height: 8, background: null });

    expect(recorder.stop().frames).toEqual([]);
  });
});
