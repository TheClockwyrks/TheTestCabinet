import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CapturedImage,
  DrawOp,
  DrawState,
  DrawValue,
  Recording,
} from "./contract";
import { ContextRecorder, RECORDING_FORMAT } from "./recording";

/**
 * Unit tests over the recorder alone, driven against a hand-written context.
 *
 * The engine's own suite covers the wiring — which frames are bracketed and what a
 * recording says about them. What is checked here is the part a replay depends on
 * and nothing else can establish: that an operation is recorded as the build issued
 * it, that every value a frame draws with resolves from the recording's own tables
 * whichever frame a player lands on, and that the wrapper is invisible to the
 * context underneath it.
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
 * bypasses. `pixels` stands for the bytes a capture would read out of it.
 *
 * An `<img>` carries two sizes, and they are different here on purpose: the file's
 * own resolution, which is what a capture must read, and the box the page laid it
 * out in, which is what capturing at would throw pixels away.
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

/**
 * A payload one capture past the 16 MB a recording is allowed to hold.
 *
 * Built once for the whole file. Two of them cost the same again in a suite whose
 * files run beside each other, for a figure that is the same figure twice.
 */
const OVERSIZED = "A".repeat(17 * 1024 * 1024);

/** A surface a build paints into and blits from, stood in for `OffscreenCanvas`. */
class FakeSurface {
  width = 4;
  height = 4;
  constructor(public pixels: string) {}
}

/**
 * An `<image>` inside an SVG document, stood in for `SVGImageElement`.
 *
 * The one bitmap source that reports its size as an animated length and names its
 * file through `href` rather than `currentSrc`.
 */
class FakeSvgImage {
  width = { baseVal: { value: 6 } };
  height = { baseVal: { value: 6 } };
  constructor(
    public href: { baseVal: string },
    public pixels: string,
  ) {}
}

/** A pattern, as a context hands one back for a source it could use. */
class FakePattern {
  transform: unknown = null;
  setTransform(matrix: unknown): void {
    this.transform = matrix;
  }
}

/**
 * A matrix, as a context answers `getTransform`.
 *
 * Stood in for `DOMMatrix` through a global stub, so what the recorder makes of a
 * value a context handed back is the thing under test: a matrix is data the
 * recording carries as the six numbers `setTransform` accepts, not a recipe.
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
 * A pixel buffer, stood in for `ImageData`.
 *
 * It holds the bytes a real one holds, because that is what the recording carries:
 * a `pixels` entry is the buffer's own RGBA, and a test that stood a token in for
 * them could not tell an exact byte from a re-encoded one.
 */
class FakePixels {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
    bytes: readonly number[],
  ) {
    this.data = Uint8ClampedArray.from(bytes);
  }
}

/** A buffer of `width × height` pixels, every one of them `rgba`. */
function pixelBuffer(
  width: number,
  height: number,
  rgba: readonly number[],
): FakePixels {
  const bytes: number[] = [];
  for (let at = 0; at < width * height; at += 1) bytes.push(...rgba);
  return new FakePixels(width, height, bytes);
}

/** The bytes behind a `pixels` entry, decoded the way a player decodes them. */
function decodePixels(image: CapturedImage | undefined): number[] {
  expect(image?.kind).toBe("pixels");
  const data = image?.kind === "pixels" && "data" in image ? image.data : "";
  return [...Buffer.from(data, "base64")];
}

/**
 * The data URL behind a `bitmap` entry.
 *
 * An entry may also name its pixels in a file beside the recording, which the
 * writer that has a directory to put them in produces. This recorder writes its
 * pixels inline, so an entry in any other form answers the empty string and
 * fails the comparison the caller makes.
 */
function bitmapSrc(image: CapturedImage): string {
  return image.kind === "bitmap" && "src" in image ? image.src : "";
}

/**
 * The canvas the recorder captures through.
 *
 * The recorder builds one by constructing another instance of whatever class its
 * own canvas is, which is how a capture works in-process over a native canvas. What
 * it draws is reduced to a token, so a data URL here says which source produced it
 * and two captures of the same content compare equal the way two real PNGs would.
 *
 * It behaves the way a canvas behaves in the two respects a capture depends on:
 * drawing composites over what is already there, and writing either dimension
 * blanks it. A stub that blanked on every draw could not tell a capture that
 * prepared its surface from one that recorded the last source underneath this one.
 */
class ScratchCanvas {
  private painted = "";
  private backing: { width: number; height: number };
  /**
   * What the context this canvas belongs to does when a size write resets it.
   *
   * Writing either dimension resets the context completely, and a stub that only
   * changed its size could not tell a recorder that re-read the context afterwards
   * from one still answering out of its own cache.
   */
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
  /** How many captures every canvas of this class has been asked for. */
  static reads = 0;
  toDataURL(type: string): string {
    ScratchCanvas.reads += 1;
    return `data:${type};base64,${this.painted}`;
  }
}

interface Stub {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  gradients: FakeGradient[];
  assigned: Array<[string, unknown]>;
  transform(): readonly number[];
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
    drawImage(source: unknown, ...rest: number[]): void {
      calls.push(`drawImage(${rest.join(",")})`);
    },
    putImageData(data: unknown, ...rest: number[]): void {
      calls.push(`putImageData(${rest.join(",")})`);
    },
    // Six numbers or one matrix, as a real context takes them, so a transform read
    // back out of one context and handed to another lands where it started.
    setTransform(...args: unknown[]): void {
      const [first] = args;
      transform =
        typeof first === "object" && first !== null
          ? ["a", "b", "c", "d", "e", "f"].map(
              (key) => (first as Record<string, number>)[key] ?? 0,
            )
          : (args as number[]);
      calls.push(`setTransform(${transform.join(",")})`);
    },
    // A real translate, so a path built across one is recorded under two transforms
    // that actually differ — which is what a segment carries its transform for.
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
    // The rest of the path vocabulary, so a test can build a path the way a build
    // does rather than only the one call every clip test happened to reach for.
    moveTo(...args: number[]): void {
      calls.push(`moveTo(${args.join(",")})`);
    },
    lineTo(...args: number[]): void {
      calls.push(`lineTo(${args.join(",")})`);
    },
    closePath(): void {
      calls.push("closePath()");
    },
    arc(...args: number[]): void {
      calls.push(`arc(${args.join(",")})`);
    },
    arcTo(...args: number[]): void {
      calls.push(`arcTo(${args.join(",")})`);
    },
    ellipse(...args: number[]): void {
      calls.push(`ellipse(${args.join(",")})`);
    },
    roundRect(...args: unknown[]): void {
      calls.push(`roundRect(${args.length})`);
    },
    fill(...args: string[]): void {
      calls.push(`fill(${args.join(",")})`);
    },
    stroke(): void {
      calls.push("stroke()");
    },
    clip(...args: string[]): void {
      calls.push(`clip(${args.join(",")})`);
    },
    getImageData(...args: number[]): FakePixels {
      calls.push(`getImageData(${args.join(",")})`);
      return pixelBuffer(2, 2, [7, 8, 9, 255]);
    },
    createLinearGradient(...args: number[]): FakeGradient {
      calls.push(`createLinearGradient(${args.join(",")})`);
      const gradient = new FakeGradient();
      gradients.push(gradient);
      return gradient;
    },
    // A source a context cannot use answers `null`, which is the one producing call
    // that does and which a recording carries as the nothing it is.
    createPattern(source: unknown, repeat: string): FakePattern | null {
      calls.push(`createPattern(${repeat})`);
      return source == null ? null : new FakePattern();
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
    transform: () => transform,
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

/** The state one frame inherited, resolved through the recording's shared table. */
function frameState(
  recording: Recording,
  at: number,
): Readonly<Record<string, DrawValue>> {
  const frame = recording.frames[at];
  expect(frame).toBeDefined();
  return recording.states[frame?.state ?? -1]?.properties ?? {};
}

/** One entry of the shared state table, which a frame names by index. */
function stateAt(recording: Recording, index: number | undefined): DrawState {
  const state = recording.states[index ?? -1];
  expect(state).toBeDefined();
  return state as DrawState;
}

/** The states one frame had saved under it, outermost first. */
function frameStack(recording: Recording, at: number): DrawState[] {
  const frame = recording.frames[at];
  expect(frame).toBeDefined();
  return (frame?.stack ?? []).map((index) => stateAt(recording, index));
}

/** The one frame a recorder closed, with its operations. */
function closeOne(recorder: ContextRecorder): readonly DrawOp[] {
  recorder.endFrame(
    { count: 1, timeMs: 16, deltaMs: 16 },
    { width: 1280, height: 720 },
  );
  const recording = recorder.stop();
  expect(recording.frames).toHaveLength(1);
  return frameOps(recording, 0);
}

/** The whole recording a recorder closed after one frame. */
function closeOneRecording(recorder: ContextRecorder): Recording {
  recorder.endFrame(
    { count: 1, timeMs: 16, deltaMs: 16 },
    { width: 8, height: 8 },
  );
  const recording = recorder.stop();
  expect(recording.frames).toHaveLength(1);
  return recording;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("reads nothing out of a blit's source while disarmed", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const surface = new FakeSurface("PICTURE");
    const before = ScratchCanvas.reads;

    recorder.context.drawImage(surface as unknown as CanvasImageSource, 0, 0);

    // Resolving a bitmap argument reads its pixels out, which for a full-screen
    // surface is a PNG encode on every blit. Nothing is going to hold the answer
    // while no frame is open, so a build that is not being recorded pays none of it.
    expect(ScratchCanvas.reads).toBe(before);
    expect(stub.calls).toEqual(["drawImage(0,0)"]);
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

    expect(closeOne(recorder)).toEqual([
      { op: "call", method: "fillRect", args: [1, 2, 3, 4] },
    ]);
  });

  it("records a property set as the value the build wrote, not the normalized one", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = "#fff";

    expect(closeOne(recorder)).toEqual([
      { op: "set", property: "fillStyle", value: "#fff" },
    ]);
  });

  it("keeps operations in the order they were issued", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = "#ff0000";
    recorder.context.fillRect(0, 0, 10, 10);
    recorder.context.fillStyle = "#00ff00";

    const ops = closeOne(recorder);
    expect(
      ops.map((op) => (op.op === "call" ? op.method : op.property)),
    ).toEqual(["fillStyle", "fillRect", "fillStyle"]);
  });

  it("writes one entry for two operations whose fields were built in a different order", () => {
    const { recorder } = armed();

    recorder.context.fillRect({ a: 1, b: 2 } as unknown as number, 0, 0, 0);
    recorder.context.fillRect({ b: 2, a: 1 } as unknown as number, 0, 0, 0);

    const recording = closeOneRecording(recorder);
    // Two operations that mean the same thing are one entry, however the objects
    // inside them were assembled: the key a table interns on is canonical, which
    // is what makes deduplication a property of the value rather than of the order
    // a build happened to write its fields in.
    expect(recording.ops).toHaveLength(1);
    expect(recording.frames[0]?.ops).toEqual([0, 0]);
  });

  it("holds a call that produced a value aside, rather than recording it as an operation", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");

    // The gradient is never used, so nothing the picture contains came of it.
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();
    expect(recording.ops).toEqual([]);
    expect(recording.resources).toEqual([]);
    expect(recording.frames[0]?.ops).toEqual([]);
  });

  it("writes an operation many frames issued once, and names it by index from each", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    for (let n = 1; n <= 4; n += 1) {
      recorder.beginFrame();
      recorder.context.fillRect(1, 2, 3, 4);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    expect(recording.ops).toEqual([
      { op: "call", method: "fillRect", args: [1, 2, 3, 4] },
    ]);
    expect(recording.frames.map((frame) => frame.ops)).toEqual([
      [0],
      [0],
      [0],
      [0],
    ]);
    // The state each frame inherited is identical too, and is written once.
    expect(recording.states).toHaveLength(1);
    expect(recording.frames.map((frame) => frame.state)).toEqual([0, 0, 0, 0]);
  });
});

describe("values the context produced", () => {
  it("records a use of a gradient as the recipe that rebuilds it", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");
    recorder.context.fillStyle = gradient;

    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
    ]);
    expect(recording.resources).toEqual([
      {
        make: { method: "createLinearGradient", args: [0, 0, 10, 0] },
        then: [
          { op: "call", method: "addColorStop", args: [0, "#000"] },
          { op: "call", method: "addColorStop", args: [1, "#fff"] },
        ],
      },
    ]);
  });

  it("carries a gradient inherited from an earlier frame as a complete recipe", () => {
    // The defect this format exists to close. A value the context produced used to
    // be named by the operation that produced it, and that operation lived inside
    // one frame — so a fill established on the first frame and still in force on the
    // sixth named nothing the sixth frame contained, and a player that seeked
    // straight to it drew the frame under the wrong fill.
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 640, height: 360, background: null });

    recorder.beginFrame();
    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");
    recorder.context.fillStyle = gradient;
    recorder.context.fillRect(0, 0, 10, 10);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    for (let n = 2; n <= 6; n += 1) {
      recorder.beginFrame();
      recorder.context.fillRect(n, 0, 1, 1);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    const inherited = frameState(recording, 5)["fillStyle"];
    expect(inherited).toEqual({ $res: 0 });
    expect(recording.resources[0]).toEqual({
      make: { method: "createLinearGradient", args: [0, 0, 10, 0] },
      then: [
        { op: "call", method: "addColorStop", args: [0, "#000"] },
        { op: "call", method: "addColorStop", args: [1, "#fff"] },
      ],
    });
  });

  it("writes a second resource for a value that was mutated between two uses", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    recorder.context.fillStyle = gradient;
    gradient.addColorStop(1, "#fff");
    recorder.context.fillStyle = gradient;

    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // Each fill names the stops that fill actually had: capturing the recipe at
    // creation would paint the first fill under a stop it did not yet carry.
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "set", property: "fillStyle", value: { $res: 1 } },
    ]);
    expect(recording.resources[0]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
    ]);
    expect(recording.resources[1]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
      { op: "call", method: "addColorStop", args: [1, "#fff"] },
    ]);
  });

  it("writes one resource for two uses of a value with the same history", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    recorder.context.fillStyle = gradient;
    recorder.context.strokeStyle = gradient;

    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(recording.resources).toHaveLength(1);
    expect(
      frameOps(recording, 0).map((op) => (op.op === "set" ? op.value : null)),
    ).toEqual([{ $res: 0 }, { $res: 0 }]);
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
    expect(ops[0]).toEqual({
      op: "set",
      property: "fillStyle",
      value: { $opaque: "Date" },
    });
  });
});

describe("a value read back off the context", () => {
  it("hands back the wrapper for a value the recorder tracks", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 8, 0);

    recorder.context.fillStyle = gradient;

    // The same object the producing call handed over, so a mutation made through
    // the read-back joins the one recipe that value has always had.
    expect(recorder.context.fillStyle).toBe(gradient);
  });

  it("records a colour stop added through the property the value was assigned to", () => {
    const { recorder, stub } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 8, 0);
    recorder.context.fillStyle = gradient;

    // A build that reads its own fill back and goes on building it. Handing over
    // the raw gradient here makes every mutation through the read invisible, and
    // the replay paints under the stops the assignment happened to have.
    (recorder.context.fillStyle as CanvasGradient).addColorStop(1, "#0000ff");
    recorder.context.fillRect(0, 0, 8, 8);

    const recording = closeOneRecording(recorder);
    // The context itself was given the stop, whatever the recorder made of it.
    expect(stub.gradients[0]?.stops).toEqual([[1, "#0000ff"]]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "set", property: "fillStyle", value: { $res: 1 } },
      { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
    ]);
    expect(recording.resources[1]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [1, "#0000ff"] },
    ]);
  });

  it("hands back a plain property as itself", () => {
    const { recorder } = armed();

    recorder.context.fillStyle = "#ff0000";

    // Only a value the recorder tracks is wrapped. A colour, a number and the
    // canvas element are the build's to read exactly as the context answers them.
    expect(recorder.context.fillStyle).toBe("#ff0000");
    expect(recorder.context.lineWidth).toBe(1);
  });
});

describe("a produced value is resolved at the paint", () => {
  it("re-states a fill that was mutated after it was assigned", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, "#ff0000");
    gradient.addColorStop(1, "#ff0000");

    recorder.context.fillStyle = gradient;
    gradient.addColorStop(0.5, "#0000ff");
    recorder.context.fillRect(0, 0, 64, 64);

    const recording = closeOneRecording(recorder);
    // A style property holds a live reference, so the build paints red to blue to
    // red without ever assigning the gradient again. A recording that stopped at
    // the assignment paints the whole rectangle solid red and reports nothing.
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "set", property: "fillStyle", value: { $res: 1 } },
      { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
    ]);
    expect(recording.resources[1]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#ff0000"] },
      { op: "call", method: "addColorStop", args: [1, "#ff0000"] },
      { op: "call", method: "addColorStop", args: [0.5, "#0000ff"] },
    ]);
  });

  it("re-states nothing for a fill that has not moved since it was assigned", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, "#000");

    recorder.context.fillStyle = gradient;
    recorder.context.fillRect(0, 0, 8, 8);
    recorder.context.fillRect(8, 0, 8, 8);

    const recording = closeOneRecording(recorder);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
      { op: "call", method: "fillRect", args: [8, 0, 8, 8] },
    ]);
    expect(recording.resources).toHaveLength(1);
  });

  it("re-states a fill a restore put back, because a restore restores a reference", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, "#000");

    recorder.context.fillStyle = gradient;
    recorder.context.save();
    recorder.context.fillStyle = "#ffffff";
    recorder.context.restore();
    gradient.addColorStop(1, "#fff");
    recorder.context.fillRect(0, 0, 8, 8);

    const recording = closeOneRecording(recorder);
    // The restore hands the gradient back, and it has grown since the save: the
    // paint that follows is under the stops it has now.
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "call", method: "save", args: [] },
      { op: "set", property: "fillStyle", value: "#ffffff" },
      { op: "call", method: "restore", args: [] },
      { op: "set", property: "fillStyle", value: { $res: 1 } },
      { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
    ]);
    expect(recording.resources[1]?.then).toHaveLength(2);
  });

  it("stops re-stating a fill once the property holds a plain value again", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 8, 0);
    recorder.context.fillStyle = gradient;
    (gradient as unknown as FakeGradient).addColorStop(0, "#ff0000");
    recorder.context.fillStyle = "#00ff00";
    recorder.context.fillRect(0, 0, 1, 1);

    // The gradient moved on after it was assigned, and then the property stopped
    // holding it. A recorder still measuring the property against the gradient
    // would put the gradient back in front of the fill and paint it over the
    // colour the build is actually painting with.
    expect(closeOne(recorder)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
      { op: "set", property: "fillStyle", value: "#00ff00" },
      { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
    ]);
  });

  it("re-states a fill whose recipe ran past what a recording can rebuild", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 8, 0);
    // Exactly as many stops as a recipe carries, so the count stops moving here.
    // What the stop after this changes is only that the recipe can no longer be
    // rebuilt at all, and a recorder watching the count alone sees nothing.
    for (let n = 0; n < 1024; n += 1)
      gradient.addColorStop(n / 1024, "#ff0000");
    recorder.context.fillStyle = gradient;
    gradient.addColorStop(1, "#0000ff");
    recorder.context.fillRect(0, 0, 1, 1);

    const ops = closeOne(recorder);
    expect(ops[1]).toEqual({
      op: "set",
      property: "fillStyle",
      value: { $opaque: "FakeGradient" },
    });
  });

  it("re-states a fill the frame opened under, once the value has moved on", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, "#000");
    recorder.context.fillStyle = gradient;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    gradient.addColorStop(1, "#fff");
    recorder.context.fill();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // The second frame never assigns anything: what it inherits is measured against
    // the encoding its own state block states, and the paint corrects that.
    expect(frameState(recording, 1)["fillStyle"]).toEqual({ $res: 0 });
    expect(frameOps(recording, 1)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 1 } },
      { op: "call", method: "fill", args: [] },
    ]);
  });
});

describe("a recipe is as of the producing call", () => {
  it("keeps a pattern's source as it was when the pattern was made", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const { recorder } = armed();
    const surface = new FakeSurface("BEFORE");

    const pattern = recorder.context.createPattern(
      surface as unknown as CanvasImageSource,
      "repeat",
    ) as unknown as CanvasPattern;
    surface.pixels = "AFTER";
    recorder.context.fillStyle = pattern;

    const recording = closeOneRecording(recorder);
    // `createPattern` copies its source when it is called, so a build that repaints
    // its scratch surface afterwards still paints the picture the pattern took.
    expect(recording.images).toEqual([
      {
        kind: "bitmap",
        width: 4,
        height: 4,
        src: "data:image/png;base64,BEFORE",
      },
    ]);
    expect(recording.resources).toEqual([
      {
        make: { method: "createPattern", args: [{ $img: 0 }, "repeat"] },
        then: [],
      },
    ]);
  });

  it("keeps a produced value nested in a mutation as it stood at that moment", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const sheet = new FakeImage("tile.png", "TILE");
    const pattern = recorder.context.createPattern(
      sheet as unknown as CanvasImageSource,
      "repeat",
    ) as unknown as CanvasPattern;
    const tint = recorder.context.createLinearGradient(0, 0, 4, 0);
    tint.addColorStop(0, "#000");

    pattern.setTransform(tint as unknown as DOMMatrix2DInit);
    tint.addColorStop(1, "#fff");
    recorder.context.fillStyle = pattern;

    // The step is held for as long as the pattern lives, so what it holds has to be
    // a copy of the gradient's history rather than the list the gradient goes on
    // appending to — which would replay the step under stops it did not have.
    const recording = closeOneRecording(recorder);
    const step = recording.resources.find(
      (entry) => entry.make.method === "createPattern",
    )?.then[0];
    expect(step?.op).toBe("call");
    const nested =
      step?.op === "call" ? (step.args[0] as { $res: number }) : { $res: -1 };
    expect(recording.resources[nested.$res]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
    ]);
  });

  it("keeps a mutation's arguments as they were when the mutation was made", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const sheet = new FakeImage("tile.png", "TILE");
    const pattern = recorder.context.createPattern(
      sheet as unknown as CanvasImageSource,
      "repeat",
    ) as unknown as CanvasPattern;
    const placement = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 };

    pattern.setTransform(placement);
    placement.e = 99;
    recorder.context.fillStyle = pattern;

    const recording = closeOneRecording(recorder);
    expect(recording.resources[0]?.then).toEqual([
      {
        op: "call",
        method: "setTransform",
        args: [{ a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 }],
      },
    ]);
  });
});

describe("captured images", () => {
  it("captures a source once and names it from every operation that draws it", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const stub = contextStub();
    const sheet = new FakeImage("sprites.png", "SHEET");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    for (let n = 1; n <= 3; n += 1) {
      recorder.beginFrame();
      recorder.context.drawImage(sheet as unknown as CanvasImageSource, n, 0);
      recorder.context.drawImage(sheet as unknown as CanvasImageSource, n, 8);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    expect(recording.images).toEqual([
      {
        kind: "bitmap",
        width: 4,
        height: 4,
        src: "data:image/png;base64,SHEET",
      },
    ]);
    const drawn = recording.frames.flatMap((_frame, at) =>
      frameOps(recording, at).map((op) =>
        op.op === "call" ? op.args[0] : null,
      ),
    );
    expect(drawn).toEqual(Array.from({ length: 6 }, () => ({ $img: 0 })));
  });

  it("captures a re-pointed image again, so a replay draws the file it now holds", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const stub = contextStub();
    const sheet = new FakeImage("sprites.png", "FIRST");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.drawImage(sheet as unknown as CanvasImageSource, 0, 0);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    sheet.currentSrc = "other.png";
    sheet.pixels = "SECOND";
    recorder.beginFrame();
    recorder.context.drawImage(sheet as unknown as CanvasImageSource, 0, 0);
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(recording.images.map((image) => image.src)).toEqual([
      "data:image/png;base64,FIRST",
      "data:image/png;base64,SECOND",
    ]);
  });

  it("captures a surface once for as long as its pixels do not change", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const stub = contextStub();
    const surface = new FakeSurface("STILL");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    for (let n = 1; n <= 4; n += 1) {
      recorder.beginFrame();
      recorder.context.drawImage(surface as unknown as CanvasImageSource, 0, 0);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    expect(recording.images).toHaveLength(1);
  });

  it("captures a surface again once it has been repainted", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const stub = contextStub();
    const surface = new FakeSurface("FRAME1");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    for (let n = 1; n <= 3; n += 1) {
      surface.pixels = `FRAME${n}`;
      recorder.beginFrame();
      recorder.context.drawImage(surface as unknown as CanvasImageSource, 0, 0);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    expect(recording.images.map((image) => image.src)).toEqual([
      "data:image/png;base64,FRAME1",
      "data:image/png;base64,FRAME2",
      "data:image/png;base64,FRAME3",
    ]);
  });

  it("captures a source that reports its size as an animated length", () => {
    vi.stubGlobal("SVGImageElement", FakeSvgImage);
    const { recorder } = armed();
    const art = new FakeSvgImage({ baseVal: "art.svg" }, "VECTOR");

    recorder.context.drawImage(art as unknown as CanvasImageSource, 0, 0);

    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();
    expect(recording.images).toEqual([
      {
        kind: "bitmap",
        width: 6,
        height: 6,
        src: "data:image/png;base64,VECTOR",
      },
    ]);
  });

  it("captures a pixel buffer as its own bytes rather than as a drawable image", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const { recorder } = armed();
    // A partially transparent pixel is the case a PNG cannot carry: a canvas
    // premultiplies each channel by the alpha on the way in and un-premultiplies on
    // the way out, so this pixel would come back a different colour. `ImageData` is
    // the one kind of image a check compares byte for byte.
    const buffer = pixelBuffer(2, 2, [200, 100, 50, 128]);

    recorder.context.putImageData(buffer as unknown as ImageData, 0, 0);

    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();
    expect(recording.images).toHaveLength(1);
    expect(recording.images[0]).toMatchObject({
      kind: "pixels",
      width: 2,
      height: 2,
    });
    expect(decodePixels(recording.images[0])).toEqual([...buffer.data]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "putImageData", args: [{ $img: 0 }, 0, 0] },
    ]);
  });

  it("refuses a pixel buffer whose bytes do not match its size, rather than carrying half of it", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const { recorder } = armed();
    const short = new FakePixels(2, 2, [1, 2, 3, 4]);

    recorder.context.putImageData(short as unknown as ImageData, 0, 0);

    const recording = closeOneRecording(recorder);
    // A player rebuilds a `width × height` buffer from what it is handed, so a
    // short one is a wrong picture where a marker is a reported one.
    expect(recording.images).toEqual([]);
    expect(frameOps(recording, 0)).toEqual([
      {
        op: "call",
        method: "putImageData",
        args: [{ $opaque: "FakePixels" }, 0, 0],
      },
    ]);
  });

  it("captures a pixel buffer at each use, so two pictures in one frame are two entries", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const { recorder } = armed();
    const buffer = pixelBuffer(2, 2, [10, 20, 30, 255]);

    recorder.context.putImageData(buffer as unknown as ImageData, 0, 0);
    buffer.data.set([90, 80, 70, 255], 0);
    recorder.context.putImageData(buffer as unknown as ImageData, 0, 8);

    const recording = closeOneRecording(recorder);
    // Reading a mutable source once and reusing it is a silently wrong picture,
    // which is worse than the marker it replaces: the second blit drew other pixels.
    expect(recording.images).toHaveLength(2);
    expect(decodePixels(recording.images[0]).slice(0, 4)).toEqual([
      10, 20, 30, 255,
    ]);
    expect(decodePixels(recording.images[1]).slice(0, 4)).toEqual([
      90, 80, 70, 255,
    ]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "putImageData", args: [{ $img: 0 }, 0, 0] },
      { op: "call", method: "putImageData", args: [{ $img: 1 }, 0, 8] },
    ]);
  });

  it("shares one entry between two mutable sources holding the same bytes", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const { recorder } = armed();

    recorder.context.drawImage(
      new FakeSurface("SAME") as unknown as CanvasImageSource,
      0,
      0,
    );
    recorder.context.drawImage(
      new FakeSurface("SAME") as unknown as CanvasImageSource,
      4,
      0,
    );

    const recording = closeOneRecording(recorder);
    expect(recording.images).toHaveLength(1);
    expect(
      frameOps(recording, 0).map((op) =>
        op.op === "call" ? op.args[0] : null,
      ),
    ).toEqual([{ $img: 0 }, { $img: 0 }]);
  });

  it("stops capturing at the budget, and keeps resolving what it already holds", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const stub = contextStub();
    // Once the budget is reached, the next *new* source is the one that degrades.
    const first = new FakeImage("first.png", OVERSIZED);
    const second = new FakeImage("second.png", "B");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.drawImage(first as unknown as CanvasImageSource, 0, 0);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.beginFrame();
    recorder.context.drawImage(first as unknown as CanvasImageSource, 1, 0);
    recorder.context.drawImage(second as unknown as CanvasImageSource, 2, 0);
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(recording.images).toHaveLength(1);
    expect(frameOps(recording, 1)).toEqual([
      { op: "call", method: "drawImage", args: [{ $img: 0 }, 1, 0] },
      {
        op: "call",
        method: "drawImage",
        args: [{ $opaque: "FakeImage" }, 2, 0],
      },
    ]);
  });

  it("captures a source at the resolution its file has, not at the box it was laid out in", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const sheet = new FakeImage("sprites.png", "SHEET");

    recorder.context.drawImage(sheet as unknown as CanvasImageSource, 0, 0);

    const recording = closeOneRecording(recorder);
    // The element is four pixels of file inside a two-pixel box. Capturing at the
    // box would throw half the sprite sheet away before a reviewer ever sees it.
    expect(recording.images[0]).toMatchObject({ width: 4, height: 4 });
  });

  it("captures an SVG image again at the size the drawing resized it to", () => {
    vi.stubGlobal("SVGImageElement", FakeSvgImage);
    const { recorder } = armed();
    const art = new FakeSvgImage({ baseVal: "art.svg" }, "VECTOR");

    recorder.context.drawImage(art as unknown as CanvasImageSource, 0, 0);
    art.width = { baseVal: { value: 12 } };
    art.height = { baseVal: { value: 12 } };
    recorder.context.drawImage(art as unknown as CanvasImageSource, 0, 8);

    const recording = closeOneRecording(recorder);
    // An `<image>` reports no natural size at all, so it is captured at the box the
    // drawing gives it and keyed on that. Keying on the file alone would replay the
    // second blit from the six-pixel capture the first one took, and the drawing
    // asked for twice that.
    expect(
      recording.images.map((image) => `${image.width}x${image.height}`),
    ).toEqual(["6x6", "12x12"]);
    expect(
      frameOps(recording, 0).map((op) =>
        op.op === "call" ? op.args[0] : null,
      ),
    ).toEqual([{ $img: 0 }, { $img: 1 }]);
  });

  it("captures a re-pointed SVG image again, so a replay draws the file it now holds", () => {
    vi.stubGlobal("SVGImageElement", FakeSvgImage);
    const { recorder } = armed();
    const art = new FakeSvgImage({ baseVal: "art.svg" }, "FIRST");

    recorder.context.drawImage(art as unknown as CanvasImageSource, 0, 0);
    art.href = { baseVal: "other.svg" };
    art.pixels = "SECOND";
    recorder.context.drawImage(art as unknown as CanvasImageSource, 0, 8);

    const recording = closeOneRecording(recorder);
    // An SVG image names its file through `href.baseVal` rather than `currentSrc`,
    // and reading only the second leaves a re-pointed one resolving to the bytes it
    // used to hold.
    expect(recording.images.map(bitmapSrc)).toEqual([
      "data:image/png;base64,FIRST",
      "data:image/png;base64,SECOND",
    ]);
  });

  it("blanks the surface it captures through between two captures", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();

    recorder.context.drawImage(
      new FakeImage("a.png", "A") as unknown as CanvasImageSource,
      0,
      0,
    );
    recorder.context.drawImage(
      new FakeImage("b.png", "B") as unknown as CanvasImageSource,
      4,
      0,
    );

    const recording = closeOneRecording(recorder);
    // Drawing composites. A capture that did not prepare its surface would record
    // the second sprite with the first still showing through it.
    expect(recording.images.map(bitmapSrc)).toEqual([
      "data:image/png;base64,A",
      "data:image/png;base64,B",
    ]);
  });

  it("keeps resolving a mutable source's bytes it already holds, past the budget", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const surface = new FakeSurface("STILL");
    const huge = new FakeImage("huge.png", OVERSIZED);

    recorder.context.drawImage(surface as unknown as CanvasImageSource, 0, 0);
    recorder.context.drawImage(huge as unknown as CanvasImageSource, 0, 4);
    recorder.context.drawImage(surface as unknown as CanvasImageSource, 4, 0);
    recorder.context.drawImage(
      new FakeSurface("LATER") as unknown as CanvasImageSource,
      8,
      0,
    );

    const recording = closeOneRecording(recorder);
    // A mutable source is read at every use, so the third blit reaches the table
    // with bytes the recording already holds even though the budget is spent.
    // Refusing it before looking would degrade an image the document carries.
    expect(recording.images).toHaveLength(2);
    expect(
      frameOps(recording, 0).map((op) =>
        op.op === "call" ? op.args[0] : null,
      ),
    ).toEqual([
      { $img: 0 },
      { $img: 1 },
      { $img: 0 },
      { $opaque: "FakeSurface" },
    ]);
  });

  it("captures a blit's source as it stood before the blit ran", () => {
    vi.stubGlobal("OffscreenCanvas", FakeSurface);
    const stub = contextStub();
    const trails = new FakeSurface("BEFORE");
    // A trails blit: `ctx.drawImage(ctx.canvas, …)` draws a surface into itself, so
    // the picture the operation means is the one that surface held before the call
    // ran. Reading it afterwards records the result and the replay composites it on
    // top of itself.
    (
      stub.ctx as unknown as { drawImage: (source: FakeSurface) => void }
    ).drawImage = (source): void => {
      source.pixels = "AFTER";
    };
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.drawImage(trails as unknown as CanvasImageSource, 0, 0);

    const recording = closeOneRecording(recorder);
    expect(trails.pixels).toBe("AFTER");
    expect(recording.images.map(bitmapSrc)).toEqual([
      "data:image/png;base64,BEFORE",
    ]);
  });

  it("reads a pixel buffer handed over from another realm", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const { recorder } = armed();
    // A buffer built in another realm — an `ImageData` reaching a canvas across an
    // iframe boundary — answers to neither this realm's `Uint8ClampedArray` nor its
    // prototype. Asking the internal slot through `ArrayBuffer.isView` is the one
    // question every realm agrees about.
    const Foreign = runInNewContext(
      "Uint8ClampedArray",
    ) as typeof Uint8ClampedArray;
    const buffer = new FakePixels(1, 1, [0, 0, 0, 0]);
    (buffer as unknown as { data: unknown }).data = Foreign.from([
      9, 8, 7, 255,
    ]);

    recorder.context.putImageData(buffer as unknown as ImageData, 0, 0);

    const recording = closeOneRecording(recorder);
    expect(decodePixels(recording.images[0])).toEqual([9, 8, 7, 255]);
  });

  it("carries a source it cannot capture as a marker, rather than failing the frame", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const stub = contextStub();
    // A context whose canvas cannot produce another canvas: the recorder has no way
    // to read pixels out of anything, which is a host it must survive.
    (stub.ctx as unknown as { canvas: unknown }).canvas = {};
    const sheet = new FakeImage("sprites.png", "SHEET");
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.drawImage(sheet as unknown as CanvasImageSource, 0, 0);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(recording.images).toEqual([]);
    expect(frameOps(recording, 0)).toEqual([
      {
        op: "call",
        method: "drawImage",
        args: [{ $opaque: "FakeImage" }, 0, 0],
      },
    ]);
  });
});

describe("numbers", () => {
  it("keeps nine significant digits of an argument, and no more", () => {
    const { recorder } = armed();

    recorder.context.fillRect(1 / 3, 100 / 3, 2 / 3, 1);

    expect(closeOne(recorder)).toEqual([
      {
        op: "call",
        method: "fillRect",
        args: [0.333333333, 33.3333333, 0.666666667, 1],
      },
    ]);
  });

  it("keeps a tiny value's precision rather than its distance from zero", () => {
    const { recorder } = armed();

    recorder.context.fillRect(1e-12 / 3, 0, 0, 0);

    const [op] = closeOne(recorder);
    expect(op).toMatchObject({ args: [3.33333333e-13, 0, 0, 0] });
  });

  it("rounds the transform and the dash pattern a frame inherited", () => {
    const { recorder } = armed();
    recorder.context.setTransform(1 / 3, 0, 0, 1 / 3, 1e-12 / 3, 0);
    recorder.context.setLineDash([1 / 3, 100 / 3]);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    const inherited = stateAt(recording, recording.frames[1]?.state);
    expect(inherited.transform).toEqual([
      0.333333333, 0, 0, 0.333333333, 3.33333333e-13, 0,
    ]);
    expect(inherited.lineDash).toEqual([0.333333333, 33.3333333]);
  });

  it("carries the frame's own figures exactly", () => {
    const { recorder } = armed();

    recorder.endFrame(
      { count: 7, timeMs: 116.66666666666667, deltaMs: 16.666666666666668 },
      {
        width: 1280,
        height: 720,
      },
    );
    const [frame] = recorder.stop().frames;

    // The axis a reviewer scrubs on and a check asserts against, not part of the
    // drawing: carried as the engine reported them.
    expect(frame?.timeMs).toBe(116.66666666666667);
    expect(frame?.deltaMs).toBe(16.666666666666668);
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
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 36 },
    );
    const recording = recorder.stop();

    expect(frameState(recording, 0)["fillStyle"]).toBe("#123456");
  });

  it("carries the transform and the surface each frame was drawn under", () => {
    const { recorder } = armed();
    recorder.context.setTransform(2, 0, 0, 2, 8, 4);

    recorder.endFrame(
      { count: 7, timeMs: 116, deltaMs: 16 },
      { width: 1280, height: 720 },
    );
    const recording = recorder.stop();
    const [frame] = recording.frames;

    expect(frame?.count).toBe(7);
    expect(frame?.timeMs).toBe(116);
    expect(frame?.deltaMs).toBe(16);
    expect(frame?.surface).toEqual({ width: 1280, height: 720 });
    // The transform recorded on the state is the one the frame *inherited*; the
    // frame's own `setTransform` is an operation inside it.
    expect(recording.states[frame?.state ?? -1]?.transform).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
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
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }

    const recording = recorder.stop();
    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(
      recording.frames.map((frame, at) => {
        const [op] = frameOps(recording, at);
        return op?.op === "call" ? op.args[0] : null;
      }),
    ).toEqual([1, 2, 3]);
  });

  it("starts a second recording empty rather than resuming the first", () => {
    const { recorder } = armed();
    recorder.context.fillRect(0, 0, 1, 1);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.stop();

    recorder.start({ width: 8, height: 8, background: null });
    const recording = recorder.stop();

    expect(recording.frames).toEqual([]);
    expect(recording.ops).toEqual([]);
    expect(recording.states).toEqual([]);
  });

  it("carries a value made in one recording into the next, mutations and all", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    recorder.context.fillStyle = gradient;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.stop();

    recorder.start({ width: 8, height: 8, background: null });
    recorder.beginFrame();
    gradient.addColorStop(1, "#fff");
    recorder.context.fillStyle = gradient;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // The frame opens under the fill the first recording left in force, holding the
    // stop it had then, and the assignment names the value as it now stands.
    expect(frameState(recording, 0)["fillStyle"]).toEqual({ $res: 0 });
    expect(recording.resources[0]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
    ]);
    expect(frameOps(recording, 0)).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 1 } },
    ]);
    expect(recording.resources[1]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
      { op: "call", method: "addColorStop", args: [1, "#fff"] },
    ]);
    // The colour stop belongs to the value, not to the frame. A recipe that did not
    // survive the first recording would leave the recorder with a mutation it could
    // not place, and it would land in `ops` as a call the context never performed.
    expect(recording.ops).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 1 } },
    ]);
  });
});

describe("a value the context made before the recording", () => {
  it("resolves a gradient created before the recorder was armed", () => {
    // The defect the format exists to close, and the one a recipe table rebuilt at
    // arming reopens: a build creates its gradients once at startup and fills with
    // them for the rest of its life, so a recorder that only watches what happens
    // while it is armed sees a value it never saw made, and records every fill in
    // every frame as a marker.
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");

    recorder.start({ width: 8, height: 8, background: null });
    recorder.beginFrame();
    recorder.context.fillStyle = gradient;
    recorder.context.fillRect(0, 0, 8, 8);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(frameOps(recording, 0)[0]).toEqual({
      op: "set",
      property: "fillStyle",
      value: { $res: 0 },
    });
    expect(recording.resources).toEqual([
      {
        make: { method: "createLinearGradient", args: [0, 0, 10, 0] },
        then: [
          { op: "call", method: "addColorStop", args: [0, "#000"] },
          { op: "call", method: "addColorStop", args: [1, "#fff"] },
        ],
      },
    ]);
  });

  it("keeps a recipe to a bound, and reports a value past it rather than half of it", () => {
    const { recorder } = armed();
    const held = recorder.context.createLinearGradient(0, 0, 10, 0);
    for (let n = 0; n < 1024; n += 1) held.addColorStop(0, "#000");
    const overgrown = recorder.context.createLinearGradient(0, 0, 10, 0);
    for (let n = 0; n < 1025; n += 1) overgrown.addColorStop(0, "#000");

    recorder.context.fillStyle = held;
    recorder.context.strokeStyle = overgrown;

    const ops = closeOne(recorder);
    expect(ops[0]).toEqual({
      op: "set",
      property: "fillStyle",
      value: { $res: 0 },
    });
    // A value tracked for the engine's whole life is the one thing with no frame
    // boundary to bound it, and a recipe a player cannot finish is worth reporting.
    expect(ops[1]).toEqual({
      op: "set",
      property: "strokeStyle",
      value: { $opaque: "FakeGradient" },
    });
  });

  it("charges nothing for a resource nothing ever used", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const sheet = new FakeImage("tile.png", "TILE");

    recorder.context.createPattern(
      sheet as unknown as CanvasImageSource,
      "repeat",
    );
    recorder.context.fillRect(0, 0, 1, 1);

    const recording = closeOneRecording(recorder);
    // The recipe holds the build's own source image and encodes it only at a use, so
    // a pattern the picture does not contain costs neither a resource nor the
    // megabytes its sheet would have added to the image table.
    expect(recording.resources).toEqual([]);
    expect(recording.images).toEqual([]);
    expect(recording.ops).toEqual([
      { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
    ]);
  });

  it("captures a pattern's source image once the pattern is used", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder } = armed();
    const sheet = new FakeImage("tile.png", "TILE");

    const pattern = recorder.context.createPattern(
      sheet as unknown as CanvasImageSource,
      "repeat",
    ) as unknown as CanvasPattern;
    recorder.context.fillStyle = pattern;

    const recording = closeOneRecording(recorder);
    expect(recording.images).toEqual([
      {
        kind: "bitmap",
        width: 4,
        height: 4,
        src: "data:image/png;base64,TILE",
      },
    ]);
    expect(recording.resources).toEqual([
      {
        make: { method: "createPattern", args: [{ $img: 0 }, "repeat"] },
        then: [],
      },
    ]);
  });
});

describe("what a context call answers", () => {
  it("records a producing call as a recipe and never as an operation of the frame", () => {
    const { recorder } = armed();

    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    recorder.context.fillStyle = gradient;

    const recording = closeOneRecording(recorder);
    expect(recording.ops).toEqual([
      { op: "set", property: "fillStyle", value: { $res: 0 } },
    ]);
  });

  it("produces neither a resource nor an operation for a pattern the context refused", () => {
    const { recorder } = armed();

    const pattern = recorder.context.createPattern(
      null as unknown as CanvasImageSource,
      "repeat",
    ) as unknown as CanvasPattern;
    recorder.context.fillStyle = pattern;

    const recording = closeOneRecording(recorder);
    expect(recording.resources).toEqual([]);
    // The `null` travels as itself: a player assigning a marker here would paint
    // under a fill the build never set.
    expect(recording.ops).toEqual([
      { op: "set", property: "fillStyle", value: null },
    ]);
  });

  it("carries a matrix as the numbers setTransform accepts, so a transform round-trips", () => {
    vi.stubGlobal("DOMMatrix", FakeMatrix);
    const { recorder } = armed();

    recorder.context.setTransform(2, 0, 0, 2, 8, 4);
    const saved = recorder.context.getTransform();
    recorder.context.setTransform(1, 0, 0, 1, 0, 0);
    recorder.context.setTransform(saved);

    const recording = closeOneRecording(recorder);
    expect(recording.resources).toEqual([]);
    const restore = frameOps(recording, 0)[3];
    expect(restore).toEqual({
      op: "call",
      method: "setTransform",
      args: [{ a: 2, b: 0, c: 0, d: 2, e: 8, f: 4 }],
    });

    // Replayed against another context, the recorded argument lands the geometry
    // where the build left it. A matrix carried as a recipe would re-issue
    // `getTransform` and answer whatever the player's own canvas held.
    const player = contextStub();
    expect(restore?.op).toBe("call");
    if (restore?.op !== "call") return;
    (player.ctx as unknown as Record<string, (...args: DrawValue[]) => void>)[
      restore.method
    ]?.(...restore.args);
    expect(player.transform()).toEqual([2, 0, 0, 2, 8, 4]);
  });

  it("rounds a matrix a context answered, the way it rounds every other number", () => {
    vi.stubGlobal("DOMMatrix", FakeMatrix);
    const { recorder } = armed();

    recorder.context.setTransform(1 / 3, 0, 0, 1 / 3, 0, 0);
    const saved = recorder.context.getTransform();
    recorder.context.setTransform(saved);

    const recording = closeOneRecording(recorder);
    // A matrix is data the recording carries, so it is carried under the same rule
    // as every other number: nine significant digits, and no seventeen-character
    // expansion of the arithmetic that produced it.
    expect(frameOps(recording, 0)[2]).toEqual({
      op: "call",
      method: "setTransform",
      args: [{ a: 0.333333333, b: 0, c: 0, d: 0.333333333, e: 0, f: 0 }],
    });
  });

  it("carries the list getLineDash answers as data rather than as a resource", () => {
    const { recorder } = armed();

    recorder.context.setLineDash([4, 2]);
    const dash = recorder.context.getLineDash();
    recorder.context.setLineDash(dash);

    const recording = closeOneRecording(recorder);
    expect(recording.resources).toEqual([]);
    expect(recording.ops).toEqual([
      { op: "call", method: "setLineDash", args: [[4, 2]] },
      { op: "call", method: "getLineDash", args: [] },
    ]);
  });

  it("records a pixel buffer as captured bytes rather than as a recipe, with no canvas to capture through", () => {
    vi.stubGlobal("ImageData", FakePixels);
    const stub = contextStub();
    // A context whose canvas cannot produce another canvas. A pixel buffer is still
    // carried in full, because its bytes are read straight off it — and re-issuing
    // the read against a player's canvas would answer whatever that canvas held.
    (stub.ctx as unknown as { canvas: unknown }).canvas = {};
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });
    recorder.beginFrame();

    const buffer = recorder.context.getImageData(0, 0, 2, 2);
    recorder.context.putImageData(buffer, 0, 0);

    const recording = closeOneRecording(recorder);
    expect(recording.resources).toEqual([]);
    expect(decodePixels(recording.images[0]).slice(0, 4)).toEqual([
      7, 8, 9, 255,
    ]);
    expect(recording.ops).toEqual([
      { op: "call", method: "getImageData", args: [0, 0, 2, 2] },
      { op: "call", method: "putImageData", args: [{ $img: 0 }, 0, 0] },
    ]);
  });
});

describe("the save stack a frame inherits", () => {
  it("names the state saved on an earlier frame, so a restore pops where it did", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.fillStyle = "#111111";
    recorder.context.save();
    recorder.context.fillStyle = "#222222";
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.context.restore();
    recorder.context.fillRect(0, 0, 1, 1);
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // The stack survives the frame boundary along with the state on top of it: the
    // second frame opens inside the save, and its `restore` returns to the fill the
    // first frame was under.
    expect(frameStack(recording, 0)).toEqual([]);
    const [outer] = frameStack(recording, 1);
    expect(outer?.properties["fillStyle"]).toBe("#111111");
    expect(frameState(recording, 1)["fillStyle"]).toBe("#222222");
  });

  it("empties the stack a restore popped", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.save();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.beginFrame();
    recorder.context.restore();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.beginFrame();
    recorder.endFrame(
      { count: 3, timeMs: 48, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(recording.frames.map((frame) => frame.stack.length)).toEqual([
      0, 1, 0,
    ]);
  });

  it("saves a fill as the reference it is, so the stack carries the stops it has now", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");
    recorder.context.fillStyle = gradient;
    recorder.context.save();
    gradient.addColorStop(1, "#fff");
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // A canvas `save` stores a reference, not a copy: what a `restore` puts back is
    // the value as it stands then, so the state the stack carries is encoded at each
    // frame open rather than pinned to the moment of the save.
    const [outer] = frameStack(recording, 1);
    const saved = outer?.properties["fillStyle"] as { $res: number };
    expect(recording.resources[saved.$res]?.then).toEqual([
      { op: "call", method: "addColorStop", args: [0, "#000"] },
      { op: "call", method: "addColorStop", args: [1, "#fff"] },
    ]);
  });

  it("writes the stack innermost last, so a player pushes them in the order they were saved", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.fillStyle = "#outer";
    recorder.context.save();
    recorder.context.fillStyle = "#middle";
    recorder.context.save();
    recorder.context.fillStyle = "#inner";
    recorder.context.save();
    recorder.context.fillStyle = "#current";
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // The order is the whole contract of the field: a player applies each entry and
    // saves, so reversing them would restore the frame to the wrong state and report
    // nothing about it.
    expect(
      frameStack(recording, 1).map((state) => state.properties["fillStyle"]),
    ).toEqual(["#outer", "#middle", "#inner"]);
    expect(frameState(recording, 1)["fillStyle"]).toBe("#current");
  });

  it("keeps the innermost states once a build has saved deeper than the stack carries", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    for (let n = 0; n < 70; n += 1) {
      recorder.context.fillStyle = `#${n}`;
      recorder.context.save();
    }
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // An unbalanced `save` would otherwise cost a longer stack at every frame open
    // for the rest of the recording. What is dropped is the outermost, because a
    // `restore` pops the innermost first — and the frame says it was cut down,
    // because a build that restores past the bound replays under the wrong state
    // and a reviewer has to be able to tell that from a picture that carried.
    const stack = frameStack(recording, 1);
    expect(stack).toHaveLength(64);
    expect(stack[0]?.properties["fillStyle"]).toBe("#6");
    expect(stack[63]?.properties["fillStyle"]).toBe("#69");
    expect(recording.frames[1]?.truncated).toBe(true);
  });
});

describe("the clip a frame inherits", () => {
  it("carries a clip set on one frame into the state a later frame inherits", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.setTransform(2, 0, 0, 2, 0, 0);
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 10, 10);
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    for (let n = 2; n <= 6; n += 1) {
      recorder.beginFrame();
      recorder.context.fillRect(n, 0, 1, 1);
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    // A player blanks the context before every frame, so a clip reaches the sixth
    // frame only by being part of what that frame inherits — and it carries the
    // transform it was applied under, because a clip path is in user space.
    expect(stateAt(recording, recording.frames[5]?.state).clip).toEqual([
      {
        transform: [2, 0, 0, 2, 0, 0],
        ops: [
          { op: "call", method: "beginPath", args: [] },
          { op: "call", method: "rect", args: [0, 0, 10, 10] },
          { op: "call", method: "clip", args: [] },
        ],
      },
    ]);
  });

  it("intersects a second clip rather than replacing the first", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 10, 10);
    recorder.context.clip();
    recorder.context.beginPath();
    recorder.context.rect(4, 4, 2, 2);
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    const { clip } = stateAt(recording, recording.frames[1]?.state);
    expect(clip.map((segment) => segment.ops[1])).toEqual([
      { op: "call", method: "rect", args: [0, 0, 10, 10] },
      { op: "call", method: "rect", args: [4, 4, 2, 2] },
    ]);
  });

  it("takes the clip as the path stood, rather than sharing the buffer it goes on filling", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 10, 10);
    recorder.context.clip();
    // No `beginPath` after the clip: the path buffer the clip was taken from goes
    // on growing, and the clip is what the path was at the moment it was taken. A
    // clip sharing that buffer would go on collecting the build's later path
    // operations and mask the frame to a region the build never asked for.
    recorder.context.lineTo(20, 20);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(
      stateAt(recording, recording.frames[1]?.state).clip.flatMap(
        (segment) => segment.ops,
      ),
    ).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [0, 0, 10, 10] },
      { op: "call", method: "clip", args: [] },
    ]);
  });

  it("carries the clip through a save and a restore", () => {
    const { recorder } = armed();
    recorder.context.save();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.context.restore();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[1]?.state).clip).toEqual([]);
  });

  it("clears the clip and the stack when the context is reset", () => {
    const { recorder } = armed();
    recorder.context.save();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.context.reset();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[1]?.state).clip).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
  });

  it("builds a clip from every call that opens a path, not from rect alone", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.moveTo(0, 0);
    recorder.context.arc(4, 4, 2, 0, 6.28);
    recorder.context.arcTo(0, 0, 4, 4, 1);
    recorder.context.ellipse(4, 4, 2, 1, 0, 0, 6.28);
    recorder.context.roundRect(0, 0, 4, 4, 1);
    recorder.context.closePath();
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // A clip is the path that produced it, and a build draws a path with more than
    // rectangles: a call missing from the path vocabulary is a clip region that
    // replays as a different shape, with nothing reported.
    const [segment] = stateAt(recording, recording.frames[1]?.state).clip;
    expect(
      segment?.ops.map((op) => (op.op === "call" ? op.method : op.property)),
    ).toEqual([
      "beginPath",
      "moveTo",
      "arc",
      "arcTo",
      "ellipse",
      "roundRect",
      "closePath",
      "clip",
    ]);
  });
});

describe("the path a frame inherits", () => {
  it("carries a path opened on one frame into the state a later frame inherits", () => {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.beginPath();
    recorder.context.moveTo(1, 1);
    recorder.context.lineTo(5, 5);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    for (let n = 2; n <= 4; n += 1) {
      recorder.beginFrame();
      recorder.context.fill();
      recorder.endFrame(
        { count: n, timeMs: n * 16, deltaMs: 16 },
        { width: 8, height: 8 },
      );
    }
    const recording = recorder.stop();

    // A canvas keeps its current path across a frame boundary, so a frame whose only
    // operation is a bare `fill` fills the path an earlier frame opened. A player
    // blanks before every frame, so the path reaches it only by being inherited.
    expect(stateAt(recording, recording.frames[3]?.state).path).toEqual([
      {
        transform: [1, 0, 0, 1, 0, 0],
        ops: [
          { op: "call", method: "beginPath", args: [] },
          { op: "call", method: "moveTo", args: [1, 1] },
          { op: "call", method: "lineTo", args: [5, 5] },
        ],
      },
    ]);
  });

  it("replaces the path a beginPath opened, so a frame inherits only what is current", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 30, 30);
    recorder.context.beginPath();
    recorder.context.rect(4, 4, 2, 2);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    const { path } = stateAt(recording, recording.frames[1]?.state);
    expect(path.flatMap((segment) => segment.ops)).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [4, 4, 2, 2] },
    ]);
  });

  it("splits the path into one segment per transform it was issued under", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.moveTo(0, 0);
    recorder.context.translate(10, 4);
    recorder.context.lineTo(2, 2);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // A path is given in user space, so a player replays each run under the
    // transform that run was issued under before setting the frame's own.
    expect(stateAt(recording, recording.frames[1]?.state).path).toEqual([
      {
        transform: [1, 0, 0, 1, 0, 0],
        ops: [
          { op: "call", method: "beginPath", args: [] },
          { op: "call", method: "moveTo", args: [0, 0] },
        ],
      },
      {
        transform: [1, 0, 0, 1, 10, 4],
        ops: [{ op: "call", method: "lineTo", args: [2, 2] }],
      },
    ]);
  });

  it("keeps the path through a save and a restore, which do not carry it", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.save();
    recorder.context.lineTo(8, 8);
    recorder.context.restore();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // The current path sits outside the saved drawing state: a `restore` puts back
    // the clip and the styles and leaves the path where the build left it.
    const { path } = stateAt(recording, recording.frames[1]?.state);
    expect(path.flatMap((segment) => segment.ops)).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [0, 0, 4, 4] },
      { op: "call", method: "lineTo", args: [8, 8] },
    ]);
  });

  it("leaves the path out of the states the stack carries", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.save();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    // A player applies a stack entry and saves, and the path is not part of a saved
    // state: replaying one would leave a path the build did not have current, and a
    // bare `fill` after the restore would fill it.
    const [outer] = frameStack(recording, 1);
    expect(outer?.path).toEqual([]);
    expect(stateAt(recording, recording.frames[1]?.state).path).not.toEqual([]);
  });

  it("clears the path when the context is reset", () => {
    const { recorder } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.reset();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[1]?.state).path).toEqual([]);
  });
});

describe("what the recorder shadows is bounded", () => {
  /** A recorder over a stub, armed, with its first frame open. */
  function opened(): ContextRecorder {
    const stub = contextStub();
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });
    recorder.beginFrame();
    return recorder;
  }

  /** Close the open frame, open and close one more, and hand back the recording. */
  function closeTwo(recorder: ContextRecorder): Recording {
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 8, height: 8 },
    );
    return recorder.stop();
  }

  it("bounds the path it shadows, and says the frame that inherited it was cut down", () => {
    const recorder = opened();
    recorder.context.beginPath();
    // A build that opens one path and never begins another. The buffer would
    // otherwise grow for the rest of the recording, and every frame open would pay
    // to encode all of it into the state that frame inherits — 0.6 ms at frame 0
    // and 12.0 ms by frame 300, past the whole frame budget and still climbing.
    for (let n = 0; n < 1200; n += 1) recorder.context.lineTo(n, n);

    const recording = closeTwo(recorder);
    const { path } = stateAt(recording, recording.frames[1]?.state);
    expect(path.reduce((total, segment) => total + segment.ops.length, 0)).toBe(
      1024,
    );
    expect(recording.frames[1]?.truncated).toBe(true);
    // The frame that opened before any of it was issued carried the whole of what
    // it inherited, and says nothing.
    expect(recording.frames[0]?.truncated).toBeUndefined();
  });

  it("bounds the clip it shadows, and refuses a region it could keep only part of", () => {
    const recorder = opened();
    for (let taken = 0; taken < 4; taken += 1) {
      recorder.context.beginPath();
      for (let n = 0; n < 500; n += 1) recorder.context.lineTo(n, taken);
      recorder.context.clip();
    }

    const recording = closeTwo(recorder);
    // Half a clip path is a region the build never had, so the clip that would take
    // the shadow past its bound is refused whole. Each of the four is 502
    // operations — the `beginPath`, the 500 line segments and the `clip` call that
    // takes them — so the third is the one that would carry the region past 1024,
    // and two of the four survive.
    const { clip } = stateAt(recording, recording.frames[1]?.state);
    expect(clip).toHaveLength(2);
    expect(clip.reduce((total, segment) => total + segment.ops.length, 0)).toBe(
      1004,
    );
    expect(recording.frames[1]?.truncated).toBe(true);
  });

  it("refuses a clip whole rather than carrying the region past the bound", () => {
    const recorder = opened();
    for (let taken = 0; taken < 2; taken += 1) {
      recorder.context.beginPath();
      for (let n = 0; n < 900; n += 1) recorder.context.lineTo(n, taken);
      recorder.context.clip();
    }

    const recording = closeTwo(recorder);
    // A clip is refused on the region it would leave behind rather than on the one
    // in force when it is taken. Refusing only a clip taken from a region already
    // AT the bound would accept the second of these — 902 operations held, 901
    // taken, and a shadow of 1,804 where the format states 1,024. A build that
    // approaches the bound one operation at a time drives it to 2,047, and every
    // frame open re-encodes all of them into the state it inherits.
    const { clip } = stateAt(recording, recording.frames[1]?.state);
    expect(clip).toHaveLength(1);
    expect(clip.reduce((total, segment) => total + segment.ops.length, 0)).toBe(
      902,
    );
    expect(recording.frames[1]?.truncated).toBe(true);
  });

  it("clears what it says about a cut-down shadow when the context is reset", () => {
    const recorder = opened();
    for (let n = 0; n < 70; n += 1) recorder.context.save();
    recorder.context.reset();

    const recording = closeTwo(recorder);
    // A reset empties the stack, the clip and the path outright, so nothing the
    // next frame inherits is missing and the frame has nothing to report.
    expect(recording.frames[1]?.truncated).toBeUndefined();
  });

  it("carries the remainder of a value past the expansion bound as one marker", () => {
    const recorder = opened();
    // Half a million numbers, almost all of them past what one value may expand
    // into. Replacing each of them with its own marker cost 1,720 ms and produced a
    // document larger than the array it declined to carry.
    const bulk = new Array<number>(500_000).fill(1);

    recorder.context.fillRect(bulk as unknown as number, 0, 0, 0);

    const [op] = closeOne(recorder);
    const encoded = op?.op === "call" ? (op.args[0] as DrawValue[]) : [];
    expect(encoded).toHaveLength(65537);
    expect(encoded[65536]).toEqual({ $opaque: "truncated" });
  });

  it("carries the remainder of an object's fields under one name", () => {
    const recorder = opened();
    const bulk: Record<string, number> = {};
    for (let n = 0; n < 70_000; n += 1) bulk[`f${n}`] = n;

    recorder.context.fillRect(bulk as unknown as number, 0, 0, 0);

    const [op] = closeOne(recorder);
    const encoded =
      op?.op === "call" ? (op.args[0] as Record<string, DrawValue>) : {};
    expect(Object.keys(encoded)).toHaveLength(65537);
    expect(encoded["$rest"]).toEqual({ $opaque: "truncated" });
  });
});

describe("a canvas reset throws away what the recorder shadows", () => {
  it("drops the clip, the path and the stack the reset threw away", () => {
    const { recorder, stub } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.context.save();

    // Writing either dimension resets the context: transform, styles, clip and the
    // whole save stack. The engine synchronizes its backing store from inside the
    // frame bracket, so this is reachable in the code that exists today.
    (stub.ctx.canvas as unknown as { width: number }).width = 32;
    recorder.context.fillRect(0, 0, 1, 1);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 32, height: 64 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 32, height: 64 },
    );
    const recording = recorder.stop();

    const inherited = stateAt(recording, recording.frames[1]?.state);
    expect(inherited.clip).toEqual([]);
    expect(inherited.path).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
  });

  it("notices the resize where it happened, so a clip taken after it survives", () => {
    const { recorder, stub } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();

    (stub.ctx.canvas as unknown as { width: number }).width = 32;
    recorder.context.beginPath();
    recorder.context.rect(1, 1, 2, 2);
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 32, height: 64 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 32, height: 64 },
    );
    const recording = recorder.stop();

    // The reset is noticed at the operation that follows it rather than at the next
    // frame open, so the clip the build set afterwards is the region in force and
    // the one it set before is gone. Noticing it late would throw away both.
    const { clip } = stateAt(recording, recording.frames[1]?.state);
    expect(clip.flatMap((segment) => segment.ops)).toEqual([
      { op: "call", method: "beginPath", args: [] },
      { op: "call", method: "rect", args: [1, 1, 2, 2] },
      { op: "call", method: "clip", args: [] },
    ]);
  });

  it("re-takes the state a frame inherits when the reset landed before its first operation", () => {
    const { recorder, stub } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );

    // Where the engine resizes: inside the frame bracket, before anything the frame
    // draws. What the frame inherited is what its first operation runs under.
    recorder.beginFrame();
    (stub.ctx.canvas as unknown as { width: number }).width = 32;
    recorder.context.setTransform(1, 0, 0, 1, 0, 0);
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 32, height: 64 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[1]?.state).clip).toEqual([]);
  });

  it("notices a clear that writes the size back unchanged", () => {
    const { recorder, stub } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.context.save();

    // `canvas.width = canvas.width` is the ordinary way a build clears its surface.
    // It resets the context completely and leaves the size exactly where it was, so
    // a comparison of sizes sees nothing at all and every following frame goes on
    // inheriting a clip and a stack the context no longer has.
    const canvas = stub.ctx.canvas as unknown as { width: number };
    canvas.width = canvas.width;
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    const recording = recorder.stop();

    const inherited = stateAt(recording, recording.frames[1]?.state);
    expect(inherited.clip).toEqual([]);
    expect(inherited.path).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
  });

  it("drops the operations the reset erased and takes the frame's state again", () => {
    const { recorder, stub } = armed();
    recorder.context.fillRect(0, 0, 64, 64);
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();

    const canvas = stub.ctx.canvas as unknown as { width: number };
    canvas.width = canvas.width;
    recorder.context.fillRect(1, 1, 2, 2);

    const recording = closeOneRecording(recorder);
    // The wipe erased the pixels the operations before it drew. Replaying them
    // would paint a full-surface fill back over a frame that ended up holding a
    // two-pixel square, and the state the frame inherited would describe a clip the
    // wipe discarded.
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "fillRect", args: [1, 1, 2, 2] },
    ]);
    expect(stateAt(recording, recording.frames[0]?.state).clip).toEqual([]);
  });

  it("holds no table entry the wipe left with no frame naming it", () => {
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const { recorder, stub } = armed();
    const sheet = new FakeImage("sprites.png", "SHEET");
    const fill = recorder.context.createLinearGradient(0, 0, 8, 0);
    fill.addColorStop(0, "#ff0000");
    recorder.context.fillStyle = fill;
    recorder.context.fillRect(0, 0, 64, 64);
    recorder.context.drawImage(sheet as unknown as CanvasImageSource, 0, 0);
    // Back to a plain colour before the wipe, so the gradient is named by the
    // dropped operations and by nothing else: what the rest of the frame inherits
    // is a table entry the recording holds by right.
    recorder.context.fillStyle = "#0000ff";

    const canvas = stub.ctx.canvas as unknown as { width: number };
    canvas.width = canvas.width;
    recorder.context.fillRect(1, 1, 2, 2);

    const recording = closeOneRecording(recorder);
    // An operation the wipe dropped takes its table entry with it. The tables are
    // what the recording holds — `ops` states every distinct operation in it — so
    // an entry no frame names is a gradient rebuilt and an image decoded by every
    // reader of a document that never draws either.
    expect(frameOps(recording, 0)).toEqual([
      { op: "call", method: "fillRect", args: [1, 1, 2, 2] },
    ]);
    expect(recording.ops).toHaveLength(1);
    expect(recording.resources).toEqual([]);
    expect(recording.images).toEqual([]);
  });

  it("asks the context for the transform again once a reset moved it", () => {
    const { recorder, stub } = armed();
    recorder.context.setTransform(2, 0, 0, 2, 0, 0);
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);

    // A reset returns the transform to the identity, and the transform is held
    // rather than asked for on every path operation. A cache the reset did not
    // clear would file every segment after it under a transform the context no
    // longer has, and a player would replay the path at twice its size.
    const canvas = stub.ctx.canvas as unknown as { width: number };
    canvas.width = canvas.width;
    recorder.context.beginPath();
    recorder.context.rect(1, 1, 2, 2);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );

    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 64, height: 64 },
    );
    const recording = recorder.stop();

    expect(
      stateAt(recording, recording.frames[1]?.state).path.map(
        (segment) => segment.transform,
      ),
    ).toEqual([[1, 0, 0, 1, 0, 0]]);
  });

  it("falls back to comparing sizes on a canvas it cannot watch", () => {
    const stub = contextStub();
    // A canvas carrying its dimensions as plain fields: there is no accessor to
    // forward to, so the recorder leaves the element alone. The comparison of sizes
    // is what is left, and it sees every reset but the one that keeps the size.
    const canvas = { width: 64, height: 64 };
    (stub.ctx as unknown as { canvas: unknown }).canvas = canvas;
    const recorder = new ContextRecorder(stub.ctx);
    recorder.start({ width: 8, height: 8, background: null });

    recorder.beginFrame();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    canvas.width = 32;
    recorder.context.fillRect(0, 0, 1, 1);
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 32, height: 64 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[0]?.state).clip).toEqual([]);
  });

  it("notices a resize between two frames, at the state snapshot", () => {
    const { recorder, stub } = armed();
    recorder.context.beginPath();
    recorder.context.rect(0, 0, 4, 4);
    recorder.context.clip();
    recorder.endFrame(
      { count: 1, timeMs: 16, deltaMs: 16 },
      { width: 64, height: 64 },
    );

    // Nothing is issued through the context between the two frames, so the frame
    // open is the only place the reset can be noticed.
    (stub.ctx.canvas as unknown as { height: number }).height = 128;
    recorder.beginFrame();
    recorder.endFrame(
      { count: 2, timeMs: 32, deltaMs: 16 },
      { width: 64, height: 128 },
    );
    const recording = recorder.stop();

    expect(stateAt(recording, recording.frames[1]?.state).clip).toEqual([]);
  });
});

describe("the recorder is invisible to the build", () => {
  it("carries a cyclic value as a marker, and leaves the assignment alone", () => {
    const { recorder, stub } = armed();
    const cycle: Record<string, unknown> = { name: "loop" };
    cycle["self"] = cycle;

    recorder.context.fillStyle = cycle as unknown as string;
    recorder.context.fillRect(0, 0, 1, 1);

    // A bare canvas makes a silent no-op of this; so does a canvas being watched.
    expect(stub.assigned).toEqual([["fillStyle", cycle]]);
    expect(stub.calls).toEqual(["fillRect(0,0,1,1)"]);
    expect(closeOne(recorder)).toEqual([
      {
        op: "set",
        property: "fillStyle",
        value: { name: "loop", self: { $opaque: "Object" } },
      },
      { op: "call", method: "fillRect", args: [0, 0, 1, 1] },
    ]);
  });

  it("carries a value whose getter throws as a marker, and still draws the call", () => {
    const { recorder, stub } = armed();
    const hostile = {
      get boom(): never {
        throw new Error("read me and see");
      },
    };

    recorder.context.fillRect(hostile as unknown as number, 0, 0, 0);

    expect(stub.calls).toHaveLength(1);
    expect(closeOne(recorder)).toEqual([
      {
        op: "call",
        method: "fillRect",
        args: [{ $opaque: "Object" }, 0, 0, 0],
      },
    ]);
  });

  it("sees through a wrapper carried inside a value the build assembled", () => {
    const { recorder } = armed();
    const gradient = recorder.context.createLinearGradient(0, 0, 10, 0);
    gradient.addColorStop(0, "#000");

    // A call takes its arguments unwrapped, so anything holding one is where a
    // wrapper can still reach the encoder.
    recorder.context.fillRect(
      { paint: gradient } as unknown as number,
      0,
      0,
      0,
    );

    const [op] = closeOne(recorder);
    expect(op).toEqual({
      op: "call",
      method: "fillRect",
      args: [{ paint: { $res: 0 } }, 0, 0, 0],
    });
  });

  it("encodes a value that appears twice inside one argument, both times", () => {
    const { recorder } = armed();
    const shared = { tint: "#abc" };

    recorder.context.fillRect(
      { near: shared, far: shared } as unknown as number,
      0,
      0,
      0,
    );

    // The guard is against a cycle, which is the path currently being followed —
    // not against a value that simply turns up twice under two fields. A guard that
    // never let go would report the second one as unencodable and leave the
    // operation half told.
    const [op] = closeOne(recorder);
    expect(op).toEqual({
      op: "call",
      method: "fillRect",
      args: [{ near: { tint: "#abc" }, far: { tint: "#abc" } }, 0, 0, 0],
    });
  });

  it("encodes a value again in a later operation, as it stands then", () => {
    const { recorder } = armed();
    const bag = { tint: "#111111" };

    recorder.context.fillRect(bag as unknown as number, 0, 0, 1);
    bag.tint = "#222222";
    recorder.context.fillRect(bag as unknown as number, 0, 0, 2);

    // Sharing is resolved once per operation and no further: an object the build
    // repaints between two calls is two different arguments, and a memo that
    // outlived the operation would draw the second call under the first's value.
    const ops = closeOne(recorder);
    expect(ops.map((op) => (op.op === "call" ? op.args[0] : null))).toEqual([
      { tint: "#111111" },
      { tint: "#222222" },
    ]);
  });

  it("resolves a value reached down many paths once, however many reach it", () => {
    const { recorder } = armed();
    let reads = 0;
    const leaf = {
      get tint(): string {
        reads += 1;
        return "#abc";
      },
    };
    // Ten levels, each naming the level below it twice: one node at the bottom, and
    // 1,024 distinct paths down to it. The cycle guard has to be the path currently
    // being followed rather than everything seen, and without a memo beside it the
    // walk expands two to the tenth times — measured at eleven seconds inside a
    // trap the build was standing in for a graph a few levels deeper than this.
    let node: object = leaf;
    for (let level = 0; level < 10; level += 1)
      node = { left: node, right: node };

    recorder.context.fillRect(node as unknown as number, 0, 0, 0);

    expect(reads).toBe(1);
    const [op] = closeOne(recorder);
    const encoded = op?.op === "call" ? op.args[0] : null;
    // Resolved once and written out in full: the document says the same thing down
    // every path, because JSON has no way to say "the same one again".
    expect(JSON.parse(JSON.stringify(encoded)) as unknown).toEqual(
      JSON.parse(JSON.stringify(node)) as unknown,
    );
  });

  it("bounds what one value may expand into, rather than following sharing forever", () => {
    const { recorder, stub } = armed();
    // Twenty-four levels, each naming the level below it twice. It is shallower
    // than the depth bound and expands to sixteen million values, because JSON has
    // no way to say "the same one again" — eleven seconds inside a trap the build
    // is standing in, for a document nothing could load afterwards.
    let node: Record<string, unknown> = { leaf: 1 };
    for (let level = 0; level < 24; level += 1)
      node = { left: node, right: node };

    recorder.context.fillRect(node as unknown as number, 0, 0, 0);

    const [op] = closeOne(recorder);
    expect(stub.calls).toHaveLength(1);
    expect(op?.op).toBe("call");
    const encoded = op?.op === "call" ? op.args[0] : null;
    expect(JSON.stringify(encoded).length).toBeLessThan(4 * 1024 * 1024);
  });

  it("carries a value nested past the encoder's bound as a marker", () => {
    const { recorder } = armed();
    const deep: Record<string, unknown> = {};
    let leaf = deep;
    for (let n = 0; n < 64; n += 1) {
      const next: Record<string, unknown> = {};
      leaf["down"] = next;
      leaf = next;
    }
    leaf["value"] = 1;

    recorder.context.fillRect(deep as unknown as number, 0, 0, 0);

    const [op] = closeOne(recorder);
    expect(op?.op).toBe("call");
    let walked: unknown = op?.op === "call" ? op.args[0] : null;
    let depth = 0;
    while (typeof walked === "object" && walked !== null && "down" in walked) {
      walked = (walked as Record<string, unknown>)["down"];
      depth += 1;
    }
    expect(walked).toEqual({ $opaque: "Object" });
    // The bound EXACTLY, because it is a fixed part of the format rather than a
    // choice this recorder makes: `ENCODE_DEPTH` is 32, so the containers reached
    // at depths 0 through 31 resolve and the one reached at depth 32 — the first
    // past the bound — is the marker. Counting the `down` links walked pins both
    // ends at once. A ceiling loose enough to admit anything shallower would pass
    // just as happily on a recorder that gave up at depth 20, which is a recorder
    // writing a different document from the one a validator injects.
    expect(depth).toBe(32);
  });
});

describe("fields a build named for itself", () => {
  it("carries a field called __proto__ as a field", () => {
    const { recorder } = armed();
    // `JSON.parse` is one of the two ways to hold this as an own property, and a
    // recording is JSON: a field assigned by name would reach the prototype setter
    // and leave the recording without it.
    const bag = JSON.parse(
      '{"__proto__": {"tainted": true}, "kept": 1}',
    ) as unknown;

    recorder.context.fillRect(bag as number, 0, 0, 0);

    const [op] = closeOne(recorder);
    expect(op?.op).toBe("call");
    const encoded = op?.op === "call" ? (op.args[0] as object) : {};
    expect(Object.getOwnPropertyNames(encoded).sort()).toEqual([
      "__proto__",
      "kept",
    ]);
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(bag);
  });
});
