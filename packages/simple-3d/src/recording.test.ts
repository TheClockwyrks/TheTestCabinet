import { afterEach, describe, expect, it } from "vitest";
import type { FrameInfo } from "./contract";
import type { CapturedChunk } from "./recording";
import {
  FRAME_BOUND,
  FrameRecorder,
  KEYFRAME_INTERVAL,
  TIMECODE_SCALE_NS,
  VP9_CODEC,
  writeWebm,
} from "./recording";
import type { Context2dStub, InstalledContexts } from "./testing/canvas";
import { createStubCanvas, installCanvasContexts } from "./testing/canvas";
import type {
  FakeEncoderBehaviour,
  FakeVideoEncoder,
  FakeVideoFrame,
  InstalledCodecs,
} from "./testing/codecs";
import { installCodecs } from "./testing/codecs";

/**
 * Unit tests over the recorder alone, driven frame by frame rather than by an engine.
 *
 * What a recorder test can honestly claim is everything except the encoding itself:
 * that the right picture was composed, in the right order, at the right size, that
 * the right frames were handed over with the right timestamps and the right keyframe
 * requests, that every `VideoFrame` was closed, and that the container holds the
 * encoder's bytes laid out as a WebM parser reads them. Whether VP9 came out the
 * other end is a question for a browser with a real codec, and a case's validators
 * ask it there, where the evidence is a video that plays.
 *
 * The container is checked by parsing it back with a reader written here rather than
 * by comparing against a recorded byte string. A golden buffer would pass for a file
 * whose sizes and ids were consistently wrong; a parser that walks the tree by the
 * sizes the writer stated cannot finish unless those sizes are right.
 */

/* -------------------------------------------------------------------------- */
/* The rig                                                                    */
/* -------------------------------------------------------------------------- */

/** Undo for whatever a test installed on the document or the global object. */
const teardown: (() => void)[] = [];

afterEach(() => {
  while (teardown.length > 0) teardown.pop()?.();
});

/** How a rig is sized, and how its stubbed encoder should behave. */
interface RigOptions {
  /** The stage canvas's backing store, which is the recording's size. */
  width?: number;
  height?: number;
  /** Passed through to the fake `VideoEncoder`. */
  behaviour?: FakeEncoderBehaviour;
}

/** A recorder over two stub canvases, with WebCodecs stood in for. */
interface Rig {
  readonly recorder: FrameRecorder;
  readonly stage: HTMLCanvasElement;
  readonly screen: HTMLCanvasElement;
  readonly codecs: InstalledCodecs;
  readonly contexts: InstalledContexts;
  /** The encoder this recording opened, which a test asserts against. */
  encoder(): FakeVideoEncoder;
  /** The frames handed to it, oldest first. */
  frames(): readonly FakeVideoFrame[];
  /** The canvas the recorder composes onto, found through the frames it handed over. */
  captureCanvas(): HTMLCanvasElement;
  /** What was drawn onto that canvas, in order. */
  composed(): Context2dStub;
  /** Capture one frame at an explicit position on the engine's counters. */
  step(count: number, timeMs: number, deltaMs?: number): void;
  /** Capture `frames` frames of `deltaMs` each, starting from where the last left off. */
  run(frames: number, deltaMs?: number): void;
}

function rig(options: RigOptions = {}): Rig {
  const width = options.width ?? 320;
  const height = options.height ?? 180;

  // Installed before the canvases are built so the recorder's own capture canvas —
  // which it creates from the document rather than being handed — answers
  // `getContext` too. Both stage and screen shadow this with their own stubs.
  const contexts = installCanvasContexts();
  teardown.push(() => {
    contexts.uninstall();
  });

  const codecs = installCodecs(options.behaviour);
  teardown.push(() => {
    codecs.uninstall();
  });

  const stage = createStubCanvas({ width, height }).canvas;
  const screen = createStubCanvas({ width, height }).canvas;
  const recorder = new FrameRecorder(stage, screen);
  teardown.push(() => {
    recorder.discard();
  });

  let time = 0;
  let count = 0;

  const captureCanvas = (): HTMLCanvasElement => {
    const source = codecs.frames[0]?.source;
    if (!(source instanceof HTMLCanvasElement)) {
      throw new Error(
        "no frame has been captured yet, so the capture canvas is not reachable",
      );
    }
    return source;
  };

  return {
    recorder,
    stage,
    screen,
    codecs,
    contexts,
    encoder: () => {
      const encoder = codecs.encoder();
      if (encoder === undefined) {
        throw new Error("the recorder opened no encoder");
      }
      return encoder;
    },
    frames: () => codecs.frames,
    captureCanvas,
    composed: () => {
      const stub = contexts.context2dFor(captureCanvas());
      if (stub === undefined) {
        throw new Error("the capture canvas was never asked for a 2d context");
      }
      return stub;
    },
    step: (at, timeMs, deltaMs = 16) => {
      count = at;
      time = timeMs;
      recorder.capture({ count: at, timeMs, lastDeltaMs: deltaMs });
    },
    run: (frames, deltaMs = 16) => {
      for (let n = 0; n < frames; n += 1) {
        count += 1;
        time += deltaMs;
        recorder.capture({ count, timeMs: time, lastDeltaMs: deltaMs });
      }
    },
  };
}

/** One frame's position on the engine's counters, as `capture` takes it. */
function frameAt(count: number, timeMs: number, deltaMs = 16): FrameInfo {
  return { count, timeMs, lastDeltaMs: deltaMs };
}

/* -------------------------------------------------------------------------- */
/* A WebM reader, so the writer is checked against a parse rather than a blob  */
/* -------------------------------------------------------------------------- */

/** One parsed element: what it is, how long it said it was, and what it holds. */
interface Element {
  readonly id: number;
  readonly size: number;
  readonly data: Uint8Array;
  readonly children: readonly Element[];
}

/** The ids whose payload is more elements rather than bytes. */
const MASTERS = new Set([
  0x1a45dfa3, // EBML
  0x18538067, // Segment
  0x1549a966, // Info
  0x1654ae6b, // Tracks
  0xae, // TrackEntry
  0xe0, // Video
  0x1f43b675, // Cluster
]);

/**
 * The whole file as a tree.
 *
 * Every element is reached by the size the writer stated for the one before it, so a
 * parse that finishes is a proof that the sizes are consistent end to end: an element
 * one byte long or short would leave the reader standing on a byte that is not an
 * element id, or overrunning its parent, and both are refused below.
 */
function parseWebm(bytes: Uint8Array): readonly Element[] {
  return parseRange(bytes, 0, bytes.length);
}

function parseRange(bytes: Uint8Array, from: number, to: number): Element[] {
  const elements: Element[] = [];
  let at = from;
  while (at < to) {
    const id = readId(bytes, at);
    const size = readSize(bytes, id.next);
    const end = size.next + size.value;
    if (end > to) {
      throw new Error(
        `element ${id.value.toString(16)} states ${String(size.value)} bytes of payload and only ${String(to - size.next)} remain`,
      );
    }
    const data = bytes.subarray(size.next, end);
    elements.push({
      id: id.value,
      size: size.value,
      data,
      children: MASTERS.has(id.value) ? parseRange(bytes, size.next, end) : [],
    });
    at = end;
  }
  return elements;
}

/** An element id, whose leading one bit says how many bytes it occupies. */
function readId(
  bytes: Uint8Array,
  at: number,
): { value: number; next: number } {
  const first = bytes[at];
  if (first === undefined) throw new Error(`no element id at ${String(at)}`);
  const length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : 4;
  if (first < 0x10) {
    throw new Error(
      `the byte at ${String(at)} is 0x${first.toString(16)}, which begins no element id`,
    );
  }
  let value = 0;
  for (let n = 0; n < length; n += 1)
    value = value * 256 + (bytes[at + n] ?? 0);
  return { value, next: at + length };
}

/** A size, whose leading one bit is a length marker rather than part of the value. */
function readSize(
  bytes: Uint8Array,
  at: number,
): { value: number; next: number } {
  const first = bytes[at];
  if (first === undefined) throw new Error(`no element size at ${String(at)}`);
  let length = 1;
  while (length <= 8 && first < 0x100 >> length) length += 1;
  if (length > 8) {
    throw new Error(`the size at ${String(at)} states no length`);
  }
  let value = first & (0xff >> length);
  for (let n = 1; n < length; n += 1)
    value = value * 256 + (bytes[at + n] ?? 0);
  return { value, next: at + length };
}

function find(elements: readonly Element[], id: number): Element | undefined {
  return elements.find((element) => element.id === id);
}

function findAll(elements: readonly Element[], id: number): Element[] {
  return elements.filter((element) => element.id === id);
}

/** An unsigned integer payload, big-endian in as many bytes as it was written in. */
function uintOf(element: Element | undefined): number {
  let value = 0;
  for (const byte of element?.data ?? []) value = value * 256 + byte;
  return value;
}

function textOf(element: Element | undefined): string {
  return String.fromCharCode(...(element?.data ?? []));
}

function floatOf(element: Element | undefined): number {
  const data = element?.data;
  if (data === undefined || data.length !== 8) return Number.NaN;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(
    0,
    false,
  );
}

/** A `SimpleBlock` taken apart: track, offset from its cluster, flags, payload. */
interface Block {
  readonly track: number;
  readonly offset: number;
  readonly flags: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

function blockOf(element: Element): Block {
  const view = new DataView(
    element.data.buffer,
    element.data.byteOffset,
    element.data.byteLength,
  );
  return {
    track: element.data[0] ?? 0,
    offset: view.getInt16(1, false),
    flags: element.data[3] ?? 0,
    key: ((element.data[3] ?? 0) & 0x80) !== 0,
    data: element.data.subarray(4),
  };
}

/** The Segment's children, which is where everything but the magic lives. */
function segmentOf(video: Uint8Array): readonly Element[] {
  return find(parseWebm(video), 0x18538067)?.children ?? [];
}

/** Every frame in the file, in the order a player would show them. */
function blocksOf(video: Uint8Array): {
  readonly timecode: number;
  readonly block: Block;
}[] {
  const found: { timecode: number; block: Block }[] = [];
  for (const cluster of findAll(segmentOf(video), 0x1f43b675)) {
    const timecode = uintOf(find(cluster.children, 0xe7));
    for (const element of findAll(cluster.children, 0xa3)) {
      found.push({ timecode, block: blockOf(element) });
    }
  }
  return found;
}

/** A chunk of `bytes` bytes all equal to `fill`, as the fake encoder produces. */
function chunk(
  timestampUs: number,
  type: "key" | "delta",
  fill: number,
  bytes = 4,
): CapturedChunk {
  return { type, timestampUs, data: new Uint8Array(bytes).fill(fill) };
}

/* -------------------------------------------------------------------------- */
/* Arming and disarming                                                       */
/* -------------------------------------------------------------------------- */

describe("arming and disarming", () => {
  it("is not recording until it is armed", () => {
    const r = rig();

    expect(r.recorder.active).toBe(false);
    expect(r.codecs.encoders).toHaveLength(0);
  });

  it("is recording once armed, and not once stopped", async () => {
    const r = rig();

    r.recorder.start();
    expect(r.recorder.active).toBe(true);

    await r.recorder.stop();
    expect(r.recorder.active).toBe(false);
  });

  it("refuses a second arming, naming the unbalanced call", () => {
    const r = rig();
    r.recorder.start();

    expect(() => {
      r.recorder.start();
    }).toThrow(/startRecording\(\) was called while already recording/);
    expect(() => {
      r.recorder.start();
    }).toThrow(/call engine\.stopRecording\(\) first/);
  });

  it("keeps the frames it holds when a second arming is refused", async () => {
    const r = rig();
    r.recorder.start();
    r.run(3);

    expect(() => {
      r.recorder.start();
    }).toThrow();

    const recording = await r.recorder.stop();
    expect(recording.frames).toHaveLength(3);
  });

  it("refuses a disarm while not recording, naming the unbalanced call", () => {
    const r = rig();

    expect(() => r.recorder.stop()).toThrow(
      /stopRecording\(\) was called while not recording/,
    );
    expect(() => r.recorder.stop()).toThrow(
      /call engine\.startRecording\(\) first/,
    );
  });

  it("refuses a second disarm rather than handing back an empty recording", async () => {
    const r = rig();
    r.recorder.start();
    r.run(2);
    await r.recorder.stop();

    expect(() => r.recorder.stop()).toThrow(/while not recording/);
  });

  it("refuses to arm where the host has no WebCodecs, and says so", () => {
    const r = rig();
    const host = globalThis as Record<string, unknown>;
    const previous = host["VideoEncoder"];
    delete host["VideoEncoder"];

    try {
      expect(() => {
        r.recorder.start();
      }).toThrow(/WebCodecs/);
      expect(() => {
        r.recorder.start();
      }).toThrow(/VideoEncoder/);
      expect(r.recorder.active).toBe(false);
    } finally {
      host["VideoEncoder"] = previous;
    }
  });

  it("configures the encoder for VP9 at the stage canvas's backing store", () => {
    const r = rig({ width: 640, height: 360 });

    r.recorder.start();

    expect(r.encoder().configs).toHaveLength(1);
    expect(r.encoder().configs[0]).toMatchObject({
      codec: VP9_CODEC,
      width: 640,
      height: 360,
      latencyMode: "realtime",
      alpha: "discard",
    });
  });

  it("starts a second recording empty rather than resuming the first", async () => {
    const r = rig();
    r.recorder.start();
    r.run(4);
    await r.recorder.stop();

    r.recorder.start();
    r.run(1);
    const second = await r.recorder.stop();

    expect(second.frames).toHaveLength(1);
    expect(r.codecs.encoders).toHaveLength(2);
  });

  it("turns away the frame it was armed in, and takes every frame past it", async () => {
    // What an engine passes is the frame counter as it stood at the arming, so a
    // recorder armed part-way through frame two is handed `2` and the recording
    // opens at frame three.
    const r = rig();
    r.recorder.start(2);

    r.recorder.capture(frameAt(2, 32));
    r.recorder.capture(frameAt(3, 48));
    r.recorder.capture(frameAt(4, 64));

    const recording = await r.recorder.stop();
    expect(recording.frames.map((frame) => frame.count)).toEqual([3, 4]);
    // The turned-away frame reached neither the encoder nor the first keyframe.
    expect(r.codecs.frames).toHaveLength(2);
    expect(r.encoder().encoded[0]?.options?.keyFrame).toBe(true);
  });

  it("takes every frame when nothing was in flight at the arming", () => {
    // The default boundary, which is what a caller driving the recorder itself
    // between frames gets: no frame counter is below one, so none is turned away.
    const r = rig();
    r.recorder.start();

    r.run(3);

    expect(r.codecs.frames).toHaveLength(3);
  });

  it("costs nothing per frame while idle", () => {
    const r = rig();

    for (let n = 1; n <= 5; n += 1) r.recorder.capture(frameAt(n, n * 16));

    expect(r.codecs.encoders).toHaveLength(0);
    expect(r.codecs.frames).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Composing a frame                                                          */
/* -------------------------------------------------------------------------- */

describe("composing a frame", () => {
  it("clears the capture surface, then draws the stage, then the screen layer", () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 16);

    expect(r.composed().names()).toEqual([
      "clearRect",
      "drawImage",
      "drawImage",
    ]);
    const [stage, screen] = r.composed().opsOf("drawImage");
    expect(stage?.args[0]).toBe(r.stage);
    expect(screen?.args[0]).toBe(r.screen);
  });

  it("draws both surfaces over the whole capture surface", () => {
    const r = rig({ width: 256, height: 128 });
    r.recorder.start();

    r.step(1, 16);

    for (const op of r.composed().opsOf("drawImage")) {
      expect(op.args.slice(1)).toEqual([0, 0, 256, 128]);
    }
    expect(r.composed().opsOf("clearRect")[0]?.args).toEqual([0, 0, 256, 128]);
  });

  it("hands the composed surface to the encoder as a VideoFrame", () => {
    const r = rig({ width: 128, height: 64 });
    r.recorder.start();

    r.step(1, 16);

    const [frame] = r.frames();
    expect(frame?.source).toBe(r.captureCanvas());
    expect(frame?.codedWidth).toBe(128);
    expect(frame?.codedHeight).toBe(64);
    expect(r.encoder().encoded[0]?.frame).toBe(frame);
  });

  it("closes every frame it hands over", async () => {
    const r = rig();
    r.recorder.start();
    r.run(5);
    await r.recorder.stop();

    expect(r.frames()).toHaveLength(5);
    expect(r.frames().every((frame) => frame.closed)).toBe(true);
  });

  it("clears the surface again on every frame, so a transparent frame is not the last one", () => {
    const r = rig();
    r.recorder.start();

    r.run(3);

    expect(r.composed().opsOf("clearRect")).toHaveLength(3);
    expect(r.composed().names()).toEqual([
      "clearRect",
      "drawImage",
      "drawImage",
      "clearRect",
      "drawImage",
      "drawImage",
      "clearRect",
      "drawImage",
      "drawImage",
    ]);
  });

  it("draws a stage that has since been resized scaled into the recording's size", async () => {
    const r = rig({ width: 320, height: 180 });
    r.recorder.start();
    r.step(1, 16);

    r.stage.width = 640;
    r.stage.height = 360;
    r.screen.width = 640;
    r.screen.height = 360;
    r.step(2, 32);

    // Both frames were composed onto the same surface, at the size the recorder was
    // armed with, so the encoder was never handed a frame of another size.
    for (const op of r.composed().opsOf("drawImage")) {
      expect(op.args.slice(1)).toEqual([0, 0, 320, 180]);
    }
    expect(r.frames().map((frame) => frame.codedWidth)).toEqual([320, 320]);

    const recording = await r.recorder.stop();
    expect(recording.width).toBe(320);
    expect(recording.height).toBe(180);
  });

  it("reports the size the stage had when it was armed, not when it was stopped", async () => {
    const r = rig({ width: 800, height: 600 });
    r.recorder.start();
    r.run(2);
    r.stage.width = 100;
    r.stage.height = 50;

    const recording = await r.recorder.stop();

    expect(recording.width).toBe(800);
    expect(recording.height).toBe(600);
    expect(
      uintOf(
        find(
          find(segmentOf(recording.video), 0x1654ae6b)?.children[0]?.children ??
            [],
          0xe0,
        )?.children.find((child) => child.id === 0xb0),
      ),
    ).toBe(800);
  });
});

/* -------------------------------------------------------------------------- */
/* The frames a recording holds                                               */
/* -------------------------------------------------------------------------- */

describe("the frames a recording holds", () => {
  it("carries the engine's counters beside each video frame", async () => {
    const r = rig();
    r.recorder.start();

    r.step(7, 116, 16);
    r.step(8, 132.5, 16.5);
    const recording = await r.recorder.stop();

    expect(recording.frames).toEqual([
      { count: 7, timeMs: 116, deltaMs: 16 },
      { count: 8, timeMs: 132.5, deltaMs: 16.5 },
    ]);
  });

  it("keeps the frames in the order they were captured", async () => {
    const r = rig();
    r.recorder.start();

    r.run(5);
    const recording = await r.recorder.stop();

    expect(recording.frames.map((frame) => frame.count)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("holds one entry per video frame the container carries", async () => {
    const r = rig();
    r.recorder.start();

    r.run(12);
    const recording = await r.recorder.stop();

    expect(recording.frames).toHaveLength(12);
    expect(blocksOf(recording.video)).toHaveLength(12);
  });

  it("is empty, and still a readable file, when nothing was captured", async () => {
    const r = rig();
    r.recorder.start();

    const recording = await r.recorder.stop();

    expect(recording.frames).toEqual([]);
    expect(recording.ended).toBe(false);
    expect(blocksOf(recording.video)).toEqual([]);
    expect(
      textOf(find(parseWebm(recording.video)[0]?.children ?? [], 0x4282)),
    ).toBe("webm");
    expect(
      floatOf(
        find(segmentOf(recording.video), 0x1549a966)?.children.find(
          (c) => c.id === 0x4489,
        ),
      ),
    ).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Timestamps                                                                 */
/* -------------------------------------------------------------------------- */

describe("timestamps", () => {
  it("times a frame at its simulated time in microseconds", () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 16);
    r.step(2, 1500);

    expect(r.frames().map((frame) => frame.timestamp)).toEqual([
      16_000, 1_500_000,
    ]);
  });

  it("rounds to the nearest microsecond", () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 16.6666);
    r.step(2, 33.3334);

    expect(r.frames().map((frame) => frame.timestamp)).toEqual([
      16_667, 33_333,
    ]);
  });

  it("times a frame whose simulated time repeats one microsecond after the last", () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 100, 0);
    r.step(2, 100, 0);
    r.step(3, 100, 0);

    expect(r.frames().map((frame) => frame.timestamp)).toEqual([
      100_000, 100_001, 100_002,
    ]);
  });

  it("keeps timestamps strictly increasing even when simulated time goes backwards", () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 100);
    r.step(2, 50);
    r.step(3, 60);

    const timestamps = r.frames().map((frame) => frame.timestamp);
    expect(timestamps).toEqual([100_000, 100_001, 100_002]);
  });

  it("carries the same timestamps into the container", async () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 1, 1);
    r.step(2, 2, 1);
    r.step(3, 3, 1);
    const recording = await r.recorder.stop();

    expect(
      blocksOf(recording.video).map(
        (entry) => entry.timecode + entry.block.offset,
      ),
    ).toEqual([1000, 2000, 3000]);
  });

  it("ends the segment where the last frame stops being shown", async () => {
    const r = rig();
    r.recorder.start();

    r.step(1, 16, 16);
    r.step(2, 32, 16);
    const recording = await r.recorder.stop();

    const info = find(segmentOf(recording.video), 0x1549a966);
    expect(floatOf(find(info?.children ?? [], 0x4489))).toBe(48_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Keyframes                                                                  */
/* -------------------------------------------------------------------------- */

describe("keyframes", () => {
  it("asks for a keyframe on the first frame of a recording", () => {
    const r = rig();
    r.recorder.start();

    r.run(1);

    expect(r.encoder().encoded[0]?.options?.keyFrame).toBe(true);
  });

  it("asks for one at least every sixty frames, and not in between", () => {
    const r = rig();
    r.recorder.start();

    r.run(KEYFRAME_INTERVAL * 2 + 1);

    const asked = r
      .encoder()
      .encoded.map((entry, at) => (entry.options?.keyFrame === true ? at : -1))
      .filter((at) => at >= 0);
    expect(asked).toEqual([0, KEYFRAME_INTERVAL, KEYFRAME_INTERVAL * 2]);
  });

  it("counts the interval from the arming, so a second recording keys its own first frame", async () => {
    const r = rig();
    r.recorder.start();
    r.run(5);
    await r.recorder.stop();

    r.recorder.start();
    r.run(1);

    expect(r.encoder().encoded[0]?.options?.keyFrame).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The frame bound                                                            */
/* -------------------------------------------------------------------------- */

describe("the frame bound", () => {
  it("captures no more than the bound, and stays armed", () => {
    const r = rig();
    r.recorder.start();

    r.run(FRAME_BOUND + 40, 1);

    expect(r.encoder().encoded).toHaveLength(FRAME_BOUND);
    expect(r.recorder.active).toBe(true);
  });

  it("says the bound is what stopped it", async () => {
    const r = rig();
    r.recorder.start();

    r.run(FRAME_BOUND + 1, 1);
    const recording = await r.recorder.stop();

    expect(recording.frames).toHaveLength(FRAME_BOUND);
    expect(recording.ended).toBe(true);
  });

  it("does not claim the bound stopped a recording that reached it exactly", async () => {
    const r = rig();
    r.recorder.start();

    r.run(FRAME_BOUND, 1);
    const recording = await r.recorder.stop();

    expect(recording.frames).toHaveLength(FRAME_BOUND);
    expect(recording.ended).toBe(false);
  });

  it("keeps every frame it holds whole", async () => {
    const r = rig();
    r.recorder.start();

    r.run(FRAME_BOUND + 5, 1);
    const recording = await r.recorder.stop();

    // The frames a capture past the bound would have added never reached the
    // encoder, so the container holds exactly what the frame list claims.
    expect(blocksOf(recording.video)).toHaveLength(FRAME_BOUND);
    expect(recording.frames.at(-1)?.count).toBe(FRAME_BOUND);
  });
});

/* -------------------------------------------------------------------------- */
/* Stopping                                                                   */
/* -------------------------------------------------------------------------- */

describe("stopping", () => {
  it("flushes the encoder before the container is closed", async () => {
    // `manual` holds every chunk inside the encoder until a flush releases it, so a
    // container that holds the frames can only have been written after the flush.
    const r = rig({ behaviour: { manual: true } });
    r.recorder.start();
    r.run(4);

    expect(r.encoder().emitted).toHaveLength(0);
    const recording = await r.recorder.stop();

    expect(r.encoder().flushes).toBe(1);
    expect(blocksOf(recording.video)).toHaveLength(4);
  });

  it("closes the encoder once the recording is in hand", async () => {
    const r = rig();
    r.recorder.start();
    r.run(2);

    await r.recorder.stop();

    expect(r.encoder().closes).toBe(1);
    expect(r.encoder().state).toBe("closed");
  });

  it("refuses a frame captured after the disarm, however late the flush settles", async () => {
    const r = rig({ behaviour: { manual: true } });
    r.recorder.start();
    r.run(2);

    const pending = r.recorder.stop();
    r.recorder.capture(frameAt(99, 9_000));
    const recording = await pending;

    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2]);
    expect(r.encoder().encoded).toHaveLength(2);
  });

  it("reports the frame size and the bound alongside the bytes", async () => {
    const r = rig({ width: 480, height: 270 });
    r.recorder.start();
    r.run(3);

    const recording = await r.recorder.stop();

    expect(recording.width).toBe(480);
    expect(recording.height).toBe(270);
    expect(recording.ended).toBe(false);
    expect(recording.video).toBeInstanceOf(Uint8Array);
    expect(recording.video.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Discarding                                                                 */
/* -------------------------------------------------------------------------- */

describe("discarding", () => {
  it("disarms and closes the encoder", () => {
    const r = rig();
    r.recorder.start();
    r.run(3);

    r.recorder.discard();

    expect(r.recorder.active).toBe(false);
    expect(r.encoder().closes).toBe(1);
    expect(r.encoder().flushes).toBe(0);
  });

  it("leaves nothing to stop", () => {
    const r = rig();
    r.recorder.start();
    r.run(1);

    r.recorder.discard();

    expect(() => r.recorder.stop()).toThrow(/while not recording/);
  });

  it("does nothing at all when the recorder is idle", () => {
    const r = rig();

    expect(() => {
      r.recorder.discard();
      r.recorder.discard();
    }).not.toThrow();
    expect(r.codecs.encoders).toHaveLength(0);
  });

  it("leaves the recorder able to arm again", async () => {
    const r = rig();
    r.recorder.start();
    r.run(2);
    r.recorder.discard();

    r.recorder.start();
    r.run(1);
    const recording = await r.recorder.stop();

    // The rig keeps counting frames across the discard, as an engine does; what the
    // second recording holds is the one frame captured after it was armed again.
    expect(recording.frames.map((frame) => frame.count)).toEqual([3]);
  });
});

/* -------------------------------------------------------------------------- */
/* A host that fails                                                          */
/* -------------------------------------------------------------------------- */

describe("a host that fails", () => {
  it("reports an encoder failure from the disarm, naming the encoder", async () => {
    const r = rig({ behaviour: { errorOn: 1 } });
    r.recorder.start();
    r.run(3);

    await expect(r.recorder.stop()).rejects.toThrow(/VideoEncoder failed/);
  });

  it("stops encoding once the encoder has failed, rather than piling frames on it", () => {
    const r = rig({ behaviour: { errorOn: 1 } });
    r.recorder.start();

    r.run(6);

    expect(r.encoder().encoded).toHaveLength(2);
  });

  it("does not break the frame it was capturing", () => {
    const r = rig({ behaviour: { errorOn: 0 } });
    r.recorder.start();

    expect(() => {
      r.run(3);
    }).not.toThrow();
  });

  it("disarms and closes the encoder even when it failed", async () => {
    const r = rig({ behaviour: { errorOn: 0 } });
    r.recorder.start();
    r.run(2);

    await expect(r.recorder.stop()).rejects.toThrow();

    expect(r.recorder.active).toBe(false);
    expect(r.encoder().state).toBe("closed");
  });

  it("carries the failure's own message as the cause", async () => {
    const r = rig({ behaviour: { errorOn: 0 } });
    r.recorder.start();
    r.run(1);

    await expect(r.recorder.stop()).rejects.toThrow(
      /the encoder failed on frame 0/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The container                                                              */
/* -------------------------------------------------------------------------- */

describe("the container", () => {
  it("is an EBML header followed by one segment", async () => {
    const r = rig();
    r.recorder.start();
    r.run(2);
    const recording = await r.recorder.stop();

    const top = parseWebm(recording.video);
    expect(top.map((element) => element.id)).toEqual([0x1a45dfa3, 0x18538067]);
  });

  it("declares itself a webm document a version-2 reader can open", async () => {
    const r = rig();
    r.recorder.start();
    r.run(1);
    const recording = await r.recorder.stop();

    const header = parseWebm(recording.video)[0]?.children ?? [];
    expect(textOf(find(header, 0x4282))).toBe("webm");
    expect(uintOf(find(header, 0x4287))).toBe(2);
    expect(uintOf(find(header, 0x4285))).toBe(2);
    expect(uintOf(find(header, 0x4286))).toBe(1);
    expect(uintOf(find(header, 0x42f2))).toBe(4);
    expect(uintOf(find(header, 0x42f3))).toBe(8);
  });

  it("puts the metadata before the frames", async () => {
    const r = rig();
    r.recorder.start();
    r.run(3, 1);
    const recording = await r.recorder.stop();

    const ids = segmentOf(recording.video).map((element) => element.id);
    expect(ids[0]).toBe(0x1549a966);
    expect(ids[1]).toBe(0x1654ae6b);
    expect(ids.slice(2).every((id) => id === 0x1f43b675)).toBe(true);
  });

  it("scales its timecodes so a tick is a microsecond", async () => {
    const r = rig();
    r.recorder.start();
    r.run(1);
    const recording = await r.recorder.stop();

    const info = find(segmentOf(recording.video), 0x1549a966);
    expect(uintOf(find(info?.children ?? [], 0x2ad7b1))).toBe(
      TIMECODE_SCALE_NS,
    );
    expect(TIMECODE_SCALE_NS).toBe(1000);
    expect(textOf(find(info?.children ?? [], 0x4d80))).toBe(
      "@test-cabinet/simple-3d",
    );
    expect(textOf(find(info?.children ?? [], 0x5741))).toBe(
      "@test-cabinet/simple-3d",
    );
  });

  it("declares one VP9 video track at the recording's size", async () => {
    const r = rig({ width: 512, height: 288 });
    r.recorder.start();
    r.run(1);
    const recording = await r.recorder.stop();

    const tracks = find(segmentOf(recording.video), 0x1654ae6b);
    expect(tracks?.children).toHaveLength(1);
    const entry = tracks?.children[0]?.children ?? [];
    expect(uintOf(find(entry, 0xd7))).toBe(1);
    expect(uintOf(find(entry, 0x73c5))).toBe(1);
    expect(uintOf(find(entry, 0x83))).toBe(1);
    expect(uintOf(find(entry, 0x9c))).toBe(0);
    expect(textOf(find(entry, 0x86))).toBe("V_VP9");
    const video = find(entry, 0xe0)?.children ?? [];
    expect(uintOf(find(video, 0xb0))).toBe(512);
    expect(uintOf(find(video, 0xba))).toBe(288);
  });

  it("writes one block per frame, on track one, in order", async () => {
    const r = rig();
    r.recorder.start();
    r.run(5, 1);
    const recording = await r.recorder.stop();

    const blocks = blocksOf(recording.video);
    expect(blocks).toHaveLength(5);
    expect(blocks.every((entry) => entry.block.track === 0x81)).toBe(true);
  });

  it("writes the encoder's own bytes, each block holding its own frame's", async () => {
    const r = rig();
    r.recorder.start();
    r.run(4, 1);
    const recording = await r.recorder.stop();

    // The fake encoder fills frame n's chunk with the byte n % 251, so a container
    // that wrote one chunk twice, or wrote them out of order, is visible here.
    blocksOf(recording.video).forEach((entry, at) => {
      expect(entry.block.data).toHaveLength(128);
      expect([...new Set(entry.block.data)]).toEqual([at]);
    });
  });

  it("flags a keyframe and leaves a delta frame unflagged", async () => {
    const r = rig({ behaviour: { keyframeInterval: 3 } });
    r.recorder.start();
    r.run(6, 1);
    const recording = await r.recorder.stop();

    expect(blocksOf(recording.video).map((entry) => entry.block.key)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(blocksOf(recording.video).map((entry) => entry.block.flags)).toEqual(
      [0x80, 0, 0, 0x80, 0, 0],
    );
  });

  it("opens a cluster at each keyframe", async () => {
    const r = rig({ behaviour: { keyframeInterval: 3 } });
    r.recorder.start();
    r.run(9, 1);
    const recording = await r.recorder.stop();

    const clusters = findAll(segmentOf(recording.video), 0x1f43b675);
    expect(clusters).toHaveLength(3);
    expect(
      clusters.map((cluster) => findAll(cluster.children, 0xa3).length),
    ).toEqual([3, 3, 3]);
    expect(
      clusters.map((cluster) => uintOf(find(cluster.children, 0xe7))),
    ).toEqual([1000, 4000, 7000]);
  });

  it("writes each block's offset from the cluster it sits in", async () => {
    const r = rig({ behaviour: { keyframeInterval: 4 } });
    r.recorder.start();
    r.run(4, 2);
    const recording = await r.recorder.stop();

    const [cluster] = findAll(segmentOf(recording.video), 0x1f43b675);
    expect(uintOf(find(cluster?.children ?? [], 0xe7))).toBe(2000);
    expect(
      findAll(cluster?.children ?? [], 0xa3).map(
        (element) => blockOf(element).offset,
      ),
    ).toEqual([0, 2000, 4000, 6000]);
  });
});

/* -------------------------------------------------------------------------- */
/* The container writer on its own                                            */
/* -------------------------------------------------------------------------- */

describe("the container writer", () => {
  const video = { width: 64, height: 32, durationUs: 4000 };

  it("opens a fresh cluster before a block's offset could overflow sixteen bits", () => {
    // A SimpleBlock's offset is a signed sixteen-bit number of microseconds, so a
    // cluster spans at most 32,767 of them however few frames that is.
    const bytes = writeWebm(
      [
        chunk(0, "key", 1),
        chunk(20_000, "delta", 2),
        chunk(40_000, "delta", 3),
        chunk(50_000, "delta", 4),
      ],
      video,
    );

    const clusters = findAll(segmentOf(bytes), 0x1f43b675);
    expect(
      clusters.map((cluster) => uintOf(find(cluster.children, 0xe7))),
    ).toEqual([0, 40_000]);
    expect(
      blocksOf(bytes).map((entry) => entry.timecode + entry.block.offset),
    ).toEqual([0, 20_000, 40_000, 50_000]);
    for (const entry of blocksOf(bytes)) {
      expect(Math.abs(entry.block.offset)).toBeLessThanOrEqual(32_767);
    }
  });

  it("keeps a cluster open across frames that do fit", () => {
    const bytes = writeWebm(
      [
        chunk(0, "key", 1),
        chunk(16_000, "delta", 2),
        chunk(32_000, "delta", 3),
      ],
      video,
    );

    expect(findAll(segmentOf(bytes), 0x1f43b675)).toHaveLength(1);
  });

  it("times a cluster at its own first block", () => {
    const bytes = writeWebm(
      [chunk(500_000, "key", 1), chunk(516_000, "delta", 2)],
      video,
    );

    const [cluster] = findAll(segmentOf(bytes), 0x1f43b675);
    expect(uintOf(find(cluster?.children ?? [], 0xe7))).toBe(500_000);
    expect(blocksOf(bytes).map((entry) => entry.block.offset)).toEqual([
      0, 16_000,
    ]);
  });

  it("states every element's size in as many bytes as the size needs", () => {
    // Payloads either side of the one-byte size boundary (127) and past the two-byte
    // one (16,383): a writer that used a fixed size width would produce a file the
    // parser could not walk to the end of.
    for (const size of [1, 120, 126, 127, 200, 16_000, 20_000]) {
      const bytes = writeWebm([chunk(0, "key", 7, size)], video);
      const [entry] = blocksOf(bytes);
      expect(entry?.block.data).toHaveLength(size);
      expect([...new Set(entry?.block.data ?? [])]).toEqual([7]);
    }
  });

  it("writes a header, an info and a track for a capture with no frames", () => {
    const bytes = writeWebm([], { width: 8, height: 8, durationUs: 0 });

    expect(parseWebm(bytes).map((element) => element.id)).toEqual([
      0x1a45dfa3, 0x18538067,
    ]);
    expect(segmentOf(bytes).map((element) => element.id)).toEqual([
      0x1549a966, 0x1654ae6b,
    ]);
    expect(blocksOf(bytes)).toEqual([]);
  });

  it("carries a duration a player can read back exactly", () => {
    const bytes = writeWebm([chunk(0, "key", 1)], {
      width: 8,
      height: 8,
      durationUs: 1_234_567,
    });

    const info = find(segmentOf(bytes), 0x1549a966);
    expect(floatOf(find(info?.children ?? [], 0x4489))).toBe(1_234_567);
  });

  it("writes a timecode that needs more than four bytes without wrapping", () => {
    // Two hours of microseconds is past what a thirty-two-bit shift can carry, and a
    // writer that reached for one would fold the timecode back to a small number.
    const late = 7_200_000_000;
    const bytes = writeWebm([chunk(late, "key", 5)], video);

    const [cluster] = findAll(segmentOf(bytes), 0x1f43b675);
    expect(uintOf(find(cluster?.children ?? [], 0xe7))).toBe(late);
  });
});
