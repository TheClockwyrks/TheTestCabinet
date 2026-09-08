import { describe, expect, it, vi } from "vitest";
import { RECORDING_FORMAT, type Recording } from "./format";
import {
  encodeReplayWebm,
  exportSize,
  pickWebmType,
  type WebmCanvas,
  type WebmCapture,
  type WebmHost,
  type WebmRecorder,
} from "./replayWebm";

/**
 * The replay-to-WebM export.
 *
 * Nothing is encoded here — jsdom has no canvas and no `MediaRecorder` — so the
 * host is faked and what is checked is the contract that makes the clip what the
 * player shows: every frame is drawn and pushed into the stream in order, each
 * held for exactly what the player's clock holds it, so the file is paced as the
 * on-screen replay is.
 */

/** A recording of `deltas.length` frames, each worth its delta. */
function recording(deltas: readonly number[], surface = 320): Recording {
  return {
    format: RECORDING_FORMAT,
    width: 640,
    height: 360,
    background: "#000000",
    images: [],
    resources: [],
    ops: deltas.map((_, i) => ({
      op: "call",
      method: "fillRect",
      args: [i, 0, 4, 4],
    })),
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames: deltas.map((deltaMs, i) => ({
      count: i,
      timeMs: deltaMs * (i + 1),
      deltaMs,
      surface: { width: surface, height: surface / 2 },
      state: 0,
      stack: [],
      ops: [i],
    })),
  } as unknown as Recording;
}

/** A 2D context that records nothing and accepts everything. */
function fakeContext(canvas: WebmCanvas): CanvasRenderingContext2D {
  return new Proxy({ canvas } as unknown as CanvasRenderingContext2D, {
    get(target, key) {
      if (key === "canvas") return target.canvas;
      // Every property read is a method the drawer may call, or a style it may
      // set; a no-op function satisfies both.
      return () => undefined;
    },
    set: () => true,
  });
}

interface FakeHost extends WebmHost {
  /** The clock reading at each frame push. */
  readonly pushedAt: number[];
  readonly waits: number[];
  readonly recorder: WebmRecorder & { started: boolean; stopped: boolean };
  /** The one capture the export opens over its output canvas. */
  readonly frames: WebmCapture & { stopped: boolean };
  /** Fail the recorder, as the browser would mid-export. */
  fail(reason: unknown): void;
  /** How late every timer fires, in ms — the fake's model of a busy browser. */
  lateBy: number;
}

/** A host with a clock the waits advance, a recorder that hands back one
 * canned chunk, and a capture that counts the frames pushed into it. */
function fakeHost(supported: readonly string[] = ["video/webm"]): FakeHost {
  const pushedAt: number[] = [];
  const waits: number[] = [];
  let clock = 1000;
  let onData: ((chunk: Blob) => void) | null = null;
  let onStop: (() => void) | null = null;
  let onError: ((reason: unknown) => void) | null = null;
  const recorder = {
    started: false,
    stopped: false,
    active: false,
    start() {
      this.started = true;
      this.active = true;
    },
    stop() {
      if (!this.active) throw new Error("InvalidStateError");
      this.active = false;
      this.stopped = true;
      onData?.(new Blob(["chunk"]));
      onStop?.();
    },
    onData: (listener: (chunk: Blob) => void) => {
      onData = listener;
    },
    onStop: (listener: () => void) => {
      onStop = listener;
    },
    onError: (listener: (reason: unknown) => void) => {
      onError = listener;
    },
  };
  const frames = {
    stopped: false,
    requestFrame: () => {
      pushedAt.push(clock);
    },
    stop: () => {
      frames.stopped = true;
    },
  };
  const host: FakeHost = {
    pushedAt,
    waits,
    recorder,
    frames,
    lateBy: 0,
    fail(reason) {
      recorder.active = false;
      onError?.(reason);
    },
    createCanvas(width, height) {
      const canvas: WebmCanvas = {
        width,
        height,
        getContext: () => fakeContext(canvas),
      };
      return canvas;
    },
    capture: () => frames,
    isTypeSupported: (type) => supported.includes(type),
    createRecorder: () => recorder,
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms + host.lateBy;
    },
  };
  return host;
}

/** To a thousandth of a millisecond, so a sixtieth of a second compares. */
const round = (ms: number): number => Math.round(ms * 1000) / 1000;

describe("encodeReplayWebm", () => {
  it("pushes every frame once, held for what the player holds it", async () => {
    const host = fakeHost();
    // 16 ms frames, one worth nothing (held for a nominal sixtieth), one worth
    // four seconds (held for the player's quarter-second ceiling).
    const blob = await encodeReplayWebm(
      recording([16, 16, 0, 4000, 16]),
      { images: [] },
      host,
    );

    expect(host.recorder.started).toBe(true);
    expect(host.recorder.stopped).toBe(true);
    expect(host.frames.stopped).toBe(true);
    expect(host.waits.map(round)).toEqual([16, 16, 16.667, 250, 16]);
    // Five frames, each stamped a hold after the last — plus the last frame
    // pushed once more after its own hold, so it too has a duration in the file.
    const start = host.pushedAt[0]!;
    expect(host.pushedAt.map((t) => round(t - start))).toEqual([
      0, 16, 32, 48.667, 298.667, 314.667,
    ]);
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("schedules against absolute deadlines, so a late timer does not accumulate", async () => {
    const host = fakeHost();
    // Every timer fires 4 ms late. Chained relative waits would put each frame
    // 4 ms further behind than the last (20, 40, 60, …); deadlines from the
    // start absorb each overshoot in the next wait, so every frame lands
    // exactly one late timer after where it belongs and no further.
    host.lateBy = 4;
    await encodeReplayWebm(recording([16, 16, 16, 16]), { images: [] }, host);
    expect(host.waits).toEqual([16, 12, 12, 12]);
    const start = host.pushedAt[0]!;
    expect(host.pushedAt.map((t) => t - start)).toEqual([0, 20, 36, 52, 68]);
  });

  it("ends the export the moment the recorder fails, with the recorder's reason", async () => {
    const host = fakeHost();
    const original = host.wait;
    // The recorder dies while the second frame is being held.
    host.wait = async (ms) => {
      await original(ms);
      if (host.waits.length === 2) host.fail(new Error("encoder gone"));
    };
    await expect(
      encodeReplayWebm(recording([16, 16, 16, 16, 16]), { images: [] }, host),
    ).rejects.toThrow("encoder gone");
    // Not every frame was walked, and the capture was still released.
    expect(host.waits.length).toBeLessThan(5);
    expect(host.frames.stopped).toBe(true);
  });

  it("prefers the most efficient codec the browser records", () => {
    expect(
      pickWebmType({
        isTypeSupported: (t) =>
          t === "video/webm;codecs=vp8" || t === "video/webm",
      }),
    ).toBe("video/webm;codecs=vp8");
    expect(pickWebmType({ isTypeSupported: () => true })).toBe(
      "video/webm;codecs=vp9",
    );
    expect(pickWebmType({ isTypeSupported: () => false })).toBeNull();
  });

  it("refuses when the browser cannot record WebM, before touching a canvas", async () => {
    const host = fakeHost([]);
    const createCanvas = vi.spyOn(host, "createCanvas");
    await expect(
      encodeReplayWebm(recording([16]), { images: [] }, host),
    ).rejects.toThrow(/cannot record WebM/);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("refuses a recording with nothing to draw", async () => {
    await expect(
      encodeReplayWebm(recording([]), { images: [] }, fakeHost()),
    ).rejects.toThrow(/no frames/);
  });

  it("exports at the first frame's surface, falling back to the design size", () => {
    expect(exportSize(recording([16], 320))).toEqual({
      width: 320,
      height: 160,
    });
    // A surface never laid out is zero-sized; the logical size is what is left.
    expect(exportSize(recording([16], 0))).toEqual({ width: 640, height: 360 });
    expect(exportSize(recording([]))).toEqual({ width: 640, height: 360 });
  });
});
