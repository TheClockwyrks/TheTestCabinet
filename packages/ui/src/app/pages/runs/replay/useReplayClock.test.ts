import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT, type RecordedFrame, type Recording } from "./format";
import { timelineFor, useReplayClock } from "./useReplayClock";

/**
 * The transport a replay is driven by.
 *
 * The parts checked here are the ones a reviewer's comparison rests on and that
 * hold without an animation frame ever arriving: which recording paces a pair, and
 * that one clock reports one frame index whoever asks. The playback loop itself is
 * left to the browser — it is a rAF over `performance.now`, and a test that faked
 * both would be asserting that arithmetic is arithmetic.
 */

/** A recording of `count` frames, each worth `deltaMs`. */
function recordingOf(count: number, deltaMs: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    frames.push({
      count: i,
      timeMs: deltaMs * (i + 1),
      deltaMs,
      surface: { width: 800, height: 600 },
      state: 0,
      stack: [],
      ops: [],
    });
  }
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background: null,
    images: [],
    resources: [],
    ops: [],
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames,
  };
}

describe("the timeline a pair is paced by", () => {
  it("takes its durations from the recording's own frames", () => {
    expect(timelineFor([recordingOf(3, 20)])).toEqual([20, 20, 20]);
  });

  it("paces a pair by the longer recording, so none of its frames is unreachable", () => {
    const timeline = timelineFor([recordingOf(2, 16), recordingOf(5, 16)]);
    expect(timeline).toHaveLength(5);
  });

  it("holds a frame the recording gave no duration for at a sixtieth of a second", () => {
    const [hold] = timelineFor([recordingOf(1, 0)]);
    expect(hold).toBeCloseTo(1000 / 60);
  });

  it("caps a frame a stalled build recorded, so a replay is not mistaken for a hang", () => {
    const [hold] = timelineFor([recordingOf(1, 4000)]);
    expect(hold).toBe(250);
  });

  it("has no timeline when neither side has a recording", () => {
    expect(timelineFor([null, null])).toEqual([]);
  });
});

describe("the clock", () => {
  it("starts stopped on the first frame, so a page of replays is readable", () => {
    const { result } = renderHook(() =>
      useReplayClock(timelineFor([recordingOf(4, 16)])),
    );
    expect(result.current.frame).toBe(0);
    expect(result.current.playing).toBe(false);
    expect(result.current.frames).toBe(4);
  });

  it("seeks to the frame asked for, and stops", () => {
    const timeline = timelineFor([recordingOf(10, 16)]);
    const { result } = renderHook(() => useReplayClock(timeline));
    act(() => result.current.toggle());
    act(() => result.current.seek(6));
    expect(result.current.frame).toBe(6);
    expect(result.current.playing).toBe(false);
  });

  it("clamps a seek into the timeline rather than leaving the panes off the end", () => {
    const timeline = timelineFor([recordingOf(3, 16)]);
    const { result } = renderHook(() => useReplayClock(timeline));
    act(() => result.current.seek(99));
    expect(result.current.frame).toBe(2);
    expect(result.current.atEnd).toBe(true);
    act(() => result.current.seek(-4));
    expect(result.current.frame).toBe(0);
  });

  it("restarts from the top when play is pressed on the last frame", () => {
    const timeline = timelineFor([recordingOf(3, 16)]);
    const { result } = renderHook(() => useReplayClock(timeline));
    act(() => result.current.seek(2));
    act(() => result.current.toggle());
    expect(result.current.frame).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("starts a new recording from the top rather than at the old one's position", () => {
    const first = timelineFor([recordingOf(10, 16)]);
    const second = timelineFor([recordingOf(4, 16)]);
    const { result, rerender } = renderHook(
      ({ timeline }: { timeline: readonly number[] }) =>
        useReplayClock(timeline),
      { initialProps: { timeline: first } },
    );
    act(() => result.current.seek(8));
    expect(result.current.frame).toBe(8);
    rerender({ timeline: second });
    expect(result.current.frame).toBe(0);
    expect(result.current.frames).toBe(4);
  });

  it("offers a rate without touching the position", () => {
    const { result } = renderHook(() =>
      useReplayClock(timelineFor([recordingOf(5, 16)])),
    );
    act(() => result.current.seek(3));
    act(() => result.current.setSpeed(4));
    expect(result.current.speed).toBe(4);
    expect(result.current.frame).toBe(3);
  });
});
