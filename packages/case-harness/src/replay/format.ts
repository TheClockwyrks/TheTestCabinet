// The recording format the console's player reads.
//
// A frame names its state and its operations by INDEX, and the values those
// operations draw with — the gradients, the captured images — live in tables the
// whole recording shares. So every reference a frame makes resolves at whichever
// frame a reviewer lands on, and each distinct thing is written once.

import type { RecordedOp } from "../draw-calls";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harness writes under,
 * so a replay recorded under either engine is the same size of thing.
 */
export const MAX_REPLAY_FRAMES = 300;

/** One frame of a recording, as the console's player reads it. */
export interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into the recording's `states` of the states saved under this frame,
   * outermost first.
   *
   * A build may `save` on one frame and `restore` on the next, so the stack of
   * saved states survives a frame boundary along with the state on top of it. A
   * player pushes these before the frame's own state, which is what makes a
   * `restore` among the frame's operations return where the original returned.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound.
   *
   * The save stack, the clip region and the current path are each shadowed by the
   * recorder and each bounded. Past a bound the recorder keeps what a following
   * operation can still reach and drops the rest, so the frame replays under a
   * state close to the build's rather than equal to it — and the player reports
   * that beside everything else it could not reproduce. Present only on a frame
   * that was in fact cut down.
   */
  truncated?: boolean;
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are split
 * into one segment per transform and a player replays each under its own.
 */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** The context state a frame is drawn from, before its own operations. */
export interface RecordedState {
  properties: Record<string, unknown>;
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /**
   * The current path, as the operations issued since the last `beginPath`.
   *
   * A canvas keeps its path across a frame boundary, so a build is free to open
   * one on one frame and fill it on the next. Carrying it is also what an
   * inherited clip makes unavoidable: applying a clip means replaying that clip's
   * own path operations, which leaves the clip outline current, and a frame that
   * then issues a bare `fill` would fill the outline of its clip.
   */
  path: RecordedPathSegment[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/** A recording, as the console's player reads it. */
export interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: unknown[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: RecordedFrame[];
}
