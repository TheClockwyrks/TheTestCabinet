// The written recording: what the writer keeps of an over-long section, and what
// re-interning the tables carries through.
//
// Driven over STATED recordings rather than over a captured section, because the
// recorder in the page thins as the section runs — it halves its own kept set at
// twice the written cap, so a section however long hands the writer somewhere
// between the cap and twice it, and never the exact multiple of the cap the
// writer's arithmetic turns on. What the writer does with a frame list is decided
// by how long the list is, so a list of the length in question is the whole of
// what this needs.

import { expect, it } from "vitest";
import {
  MAX_REPLAY_FRAMES,
  retable,
  thinReplay,
  type RecordedFrame,
  type RecordedOp,
  type Recording,
} from "../src/index";

/** The rate the fixture's frames are stamped at. */
const TICK_MS = 1000 / 60;

const WIDTH = 200;
const HEIGHT = 100;

/** A recording of `length` frames, one operation of its own apiece. */
function synthetic(length: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < length; i += 1) {
    frames.push({
      count: i + 1,
      timeMs: (i + 1) * TICK_MS,
      deltaMs: TICK_MS,
      surface: { width: WIDTH, height: HEIGHT },
      state: 0,
      stack: [],
      ops: [i],
    });
  }
  return {
    format: 1,
    width: WIDTH,
    height: HEIGHT,
    background: "#000",
    images: [],
    resources: [],
    // One operation of its own per frame, so what the tables are rebuilt out of
    // is the frames that survived rather than a single entry every frame shares.
    ops: frames.map((frame) => ({
      op: "call" as const,
      method: "fillRect",
      args: [frame.count, 0, 1, 1],
    })),
    states: [
      {
        properties: { fillStyle: "#101820" },
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames,
  };
}

it("leaves a section inside the cap exactly as it was", () => {
  const recording = thinReplay(synthetic(20));

  expect(recording.frames).toHaveLength(20);
  expect(recording.frames.map((frame) => frame.count)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  expect(recording.ops).toHaveLength(20);
});

it("spends the budget on the section, never one frame past it", () => {
  // The stride the writer thins by rounds up, which puts the sharp edge of the
  // cap at a section whose length is an exact multiple of it: the strided frames
  // come to exactly the cap and stop one stride short of the end. Both rules
  // still hold there. Nothing over the cap, because the cap is what makes
  // `captureReplay` safe to wrap any section in; and the section's last frame
  // written, because it is the frame the check's sweep stopped at. So the last
  // frame takes the place of the frame the stride stopped on rather than being
  // written beside it, and the three lengths here are that multiple and one frame
  // either side of it.
  for (const length of [
    MAX_REPLAY_FRAMES * 2 - 1,
    MAX_REPLAY_FRAMES * 2,
    MAX_REPLAY_FRAMES * 2 + 1,
  ]) {
    const at = `${length} frames`;
    const { frames } = thinReplay(synthetic(length));

    expect(frames.length, at).toBeLessThanOrEqual(MAX_REPLAY_FRAMES);
    // The first frame of a section is always kept — the stride opens on it — so
    // the span between the first count and the last is the whole section exactly
    // when the frame it ended on is the frame written last.
    const first = frames[0];
    const last = frames[frames.length - 1];
    expect(last!.count - first!.count, at).toBe(length - 1);
    // Displacing a frame leaves the deltas summing to the elapsed time, the same
    // as dropping one does: the frame that replaces it is measured from where the
    // frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo(length * TICK_MS, 3);
  }
});

it("rebuilds the tables out of the frames that survived, and only those", () => {
  const thinned = thinReplay(synthetic(1200));

  // Nothing a dropped frame alone drew with is still being carried, and every
  // index a kept frame holds addresses the table it was interned into. A table
  // rebuilt against the wrong indices is the same SIZE as one rebuilt against the
  // right ones and addresses entries that are not there, so both halves matter.
  const named = new Set(thinned.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(thinned.ops.length);
  for (const frame of thinned.frames) {
    for (const op of frame.ops) {
      expect(op).toBeGreaterThanOrEqual(0);
      expect(op).toBeLessThan(thinned.ops.length);
    }
    expect(thinned.states[frame.state]).toBeDefined();
  }
  // The states table is one entry every frame shares, interned once.
  expect(thinned.states).toHaveLength(1);
});

it("writes one entry for an operation many frames issue identically", () => {
  const recording = synthetic(4);
  const shared: RecordedOp = { op: "call", method: "clearRect", args: [0, 0] };
  recording.ops = [shared, shared, shared, shared];

  const rewritten = retable(recording, recording.frames);

  expect(rewritten.ops).toHaveLength(1);
  for (const frame of rewritten.frames) expect(frame.ops).toEqual([0]);
});

it("rewrites a field named __proto__ as a field", () => {
  // A build's own object may carry a field named `__proto__` — a tile key, a
  // palette entry, whatever it happened to index by — and rewriting a table by
  // ASSIGNING that name reaches the prototype setter instead of writing a field
  // the document carries, so the value silently disappears from the replay.
  //
  // Driven through `retable` directly rather than through a captured section:
  // Playwright's serializer drops an own field of that name on the way out of the
  // page, so a recording carrying one cannot be produced by driving a build.
  const carrier: Record<string, unknown> = {};
  Object.defineProperty(carrier, "__proto__", {
    value: "kept",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const recording = synthetic(1);
  recording.ops = [{ op: "call", method: "fillRect", args: [carrier] }];

  const rewritten = retable(recording, recording.frames);

  const op = rewritten.ops[0]!;
  expect(op.op).toBe("call");
  const arg = op.op === "call" ? (op.args[0] as Record<string, unknown>) : {};
  expect(Object.prototype.hasOwnProperty.call(arg, "__proto__")).toBe(true);
  expect(Object.getOwnPropertyDescriptor(arg, "__proto__")?.value).toBe("kept");
});
