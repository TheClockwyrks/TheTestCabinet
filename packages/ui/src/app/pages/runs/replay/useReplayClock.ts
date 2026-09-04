// The replay player's clock.
//
// A recording says what each of its frames was worth (`deltaMs`), which is the
// time the build's simulation advanced by — not the time the frame took to arrive
// and not the rate anything has to be shown at. The clock here is a PRESENTATION
// clock: it walks real elapsed time, scaled by the reviewer's chosen speed, over
// those recorded durations and reports which frame should be on screen. So a
// recording captured by a validator stepping a fixed clock as fast as the machine
// managed plays back at the pace the build believed it was running at, and the
// same recording plays at half or four times that on request without any of the
// recorded numbers changing meaning. This is the same separation the adversarial
// and performance players make between simulation ticks and animation frames.
//
// The clock is a hook rather than something each canvas owns, because the thing it
// makes possible is two canvases sharing it: the reviewer's pair of recordings —
// the case's reference beside this run's build — is driven by ONE clock reporting
// ONE frame index to both panes, which is what "in step" means. A pane whose
// recording is shorter clamps to its last frame; nothing about the clock changes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnyRecording } from "./format";

/** The playback rates offered, as multiples of the recorded pace. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/**
 * How long a frame is held when the recording does not say.
 *
 * A delta of zero is what a recording taken under a stepped clock that was never
 * given a step looks like. Holding such a frame for no time at all would run the
 * whole recording out within one animation frame, so it is shown for a frame at
 * sixty per second instead — the pace a reviewer expects of a game.
 */
const NOMINAL_FRAME_MS = 1000 / 60;

/**
 * The longest a single frame is held.
 *
 * A build that stalled for four seconds recorded a frame worth four seconds, and
 * replaying that faithfully looks exactly like a player that has hung. The stall is
 * real evidence, but it belongs in the run's frame metrics, not in a player the
 * reviewer is waiting on: a quarter of a second still reads as a stutter and still
 * lets the recording finish.
 */
const LONGEST_HOLD_MS = 250;

/**
 * The most real time one animation frame may advance playback by.
 *
 * A backgrounded tab delivers no animation frames and then delivers one carrying
 * the whole gap. Without this a reviewer who switches away mid-replay comes back to
 * a finished one.
 */
const LONGEST_STEP_MS = 250;

/** How long frame `i` is held, with the recording's own answer preferred. */
function holdMs(delta: number | undefined): number {
  if (delta === undefined || !Number.isFinite(delta) || delta <= 0) {
    return NOMINAL_FRAME_MS;
  }
  return Math.min(delta, LONGEST_HOLD_MS);
}

/**
 * The per-frame durations that pace a set of recordings shown together.
 *
 * The longest recording supplies the timeline. The alternative — pacing by the
 * shorter one — would leave the tail of the longer one unreachable, and the two
 * are recordings of the same scenario under the same clock, so their timings agree
 * frame for frame until one of them ends.
 *
 * The result is worth memoizing on the recordings, but only to save the array: the
 * clock reads the timeline through a ref and keys its position on the frame count,
 * so handing it a freshly built array every render costs nothing but garbage.
 *
 * The drawing space does not enter into it. `count`, `timeMs` and `deltaMs` are
 * the same axis in every recording an engine writes, and a 3D frame is drawn
 * from itself as exactly as a 2D one is — more exactly, in fact, since there is
 * no save stack to inherit — so the clock below paces and seeks both spaces
 * with nothing but this widened type to say so.
 */
export function timelineFor(
  recordings: readonly (AnyRecording | null)[],
): readonly number[] {
  let longest: AnyRecording | null = null;
  for (const recording of recordings) {
    if (recording === null) continue;
    if (longest === null || recording.frames.length > longest.frames.length) {
      longest = recording;
    }
  }
  if (longest === null) return [];
  return longest.frames.map((frame) => holdMs(frame.deltaMs));
}

/** The transport a player's controls drive and its canvases read. */
export interface ReplayClock {
  /** The frame index every pane should currently be showing. */
  readonly frame: number;
  /** How many frames the timeline holds. */
  readonly frames: number;
  /** Whether the clock is running. */
  readonly playing: boolean;
  /** The chosen rate, as a multiple of the recorded pace. */
  readonly speed: number;
  /** Whether the last frame is showing (so Play restarts rather than resumes). */
  readonly atEnd: boolean;
  /** Start, stop, or restart-from-the-top at the end. */
  readonly toggle: () => void;
  /** Move to a frame, stopping playback — what the scrubber does. */
  readonly seek: (frame: number) => void;
  /** Choose a playback rate. */
  readonly setSpeed: (speed: number) => void;
}

/** How a clock behaves at the two ends of the timeline. */
export interface ReplayClockOptions {
  /**
   * Start running rather than stopped on frame 0.
   *
   * A reviewer's page can carry several clocks, and one that played every
   * recording it mounted would be unreadable, so the review surfaces leave this
   * off and let the reviewer choose what to watch. A showcase carousel stages one
   * recording at a time and turns it on.
   */
  readonly autoPlay?: boolean;
  /** Wrap to frame 0 at the end of the timeline rather than coming to rest. */
  readonly loop?: boolean;
}

/**
 * Drive a frame index over `timeline` from an animation-frame loop.
 */
export function useReplayClock(
  timeline: readonly number[],
  options: ReplayClockOptions = {},
): ReplayClock {
  const { autoPlay = false, loop = false } = options;
  const frames = timeline.length;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);

  // A live mirror of the position for the loop, so advancing the frame does not
  // resubscribe the loop, and the part of a frame's hold already spent, so a slow
  // frame is not rounded away every animation frame.
  const frameRef = useRef(0);
  frameRef.current = frame;
  const spentRef = useRef(0);

  // The durations, read by the loop rather than closed over, so the loop survives a
  // render that rebuilt the array. A caller who does not memoize `timelineFor` hands
  // us a new array every render, and a loop keyed on that identity would tear itself
  // down and restart on every frame it advanced.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // A timeline of a different length is a different recording — it arrived, or the
  // reviewer moved to another output — so the position starts over rather than
  // pointing at a frame the new one may not have. Keyed on the length rather than the
  // array's identity for the reason above: identity changes every render.
  useEffect(() => {
    frameRef.current = 0;
    spentRef.current = 0;
    setFrame(0);
    setPlaying(autoPlay);
  }, [frames, autoPlay]);

  useEffect(() => {
    if (!playing || frames === 0) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      spentRef.current += Math.min(now - last, LONGEST_STEP_MS) * speed;
      last = now;
      // Advance as many frames as the elapsed time paid for. A reviewer watching at
      // 4× on a recording of short frames crosses several per animation frame, and
      // skipping them is right: they are drawn from their own state, so the frame we
      // land on is complete whether or not the ones passed over were drawn.
      const durations = timelineRef.current;
      let next = frameRef.current;
      // A looping clock wraps past the last frame; one that does not stops on it.
      // The step count is capped at the timeline's length so a long real-time gap
      // costs at most one pass rather than spinning.
      let steps = 0;
      while (
        (loop ? steps < frames : next < frames - 1) &&
        spentRef.current >= (durations[next] ?? NOMINAL_FRAME_MS)
      ) {
        spentRef.current -= durations[next] ?? NOMINAL_FRAME_MS;
        next = next + 1 >= frames ? 0 : next + 1;
        steps += 1;
      }
      if (next !== frameRef.current) {
        frameRef.current = next;
        setFrame(next);
      }
      if (!loop && next >= frames - 1) {
        // Stop ON the last frame. The pair is evidence a reviewer reads: it should
        // come to rest where the build did, and Play from there restarts
        // deliberately.
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, frames, loop]);

  const seek = useCallback(
    (to: number) => {
      setPlaying(false);
      spentRef.current = 0;
      const clamped = Math.max(0, Math.min(to, frames - 1));
      frameRef.current = clamped;
      setFrame(clamped);
    },
    [frames],
  );

  const toggle = useCallback(() => {
    setPlaying((on) => {
      if (on) return false;
      if (frames === 0) return false;
      // Play pressed on the last frame restarts from the top; resuming there would
      // start the loop past the end and stop it again immediately.
      if (frameRef.current >= frames - 1) {
        frameRef.current = 0;
        spentRef.current = 0;
        setFrame(0);
      }
      return true;
    });
  }, [frames]);

  return {
    frame,
    frames,
    playing,
    speed,
    atEnd: frames > 0 && frame >= frames - 1,
    toggle,
    seek,
    setSpeed,
  };
}
