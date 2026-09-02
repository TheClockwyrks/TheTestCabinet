// Cascade — reading the cue bus one frame at a time, for the `audio/*` points.
// CASE-PROVIDED.
//
// specs/audio.md fixes ten cues, one per event, and one sentence governs every
// point in this directory: "Each is played on the frame its event happens and at
// most once on that frame; a frame that raises more than one of them plays each of
// those once." So every check here is the same measurement in a different
// scenario: pose the event's world, drive frames that carry nothing, then drive the
// ONE frame the event happens on, and read the cue against that frame and against
// the frames before it.
//
// A CUE BELONGS TO A FRAME, NOT TO A POSE. Under this engine a debug pose is a pure
// `(state, ...) => state` transform with no route to the audio bus, so a gesture
// driven through the surface's `pointerDown`/`pointerUp`, or a `deal()` or
// `turnStock()` pose, is free to sound nothing at all (`harness.ts`,
// {@link watchCues}). Every check here therefore drives its event through the
// ENGINE's own pointer, or through a frame of the running cascade, and reads
// `watchCues`'s frame-stamped record afterwards.
//
// THE FRAMES BEFORE THE EVENT ARE HALF THE READING. A build that blips its cue on a
// timer sounds on the event's frame too, and is separated from a conforming one
// only by the quiet that should have come first. Each check therefore states its own
// quiet lead, in frames, derived from a duration the case fixes, and reads "and not
// before" across a real window rather than an empty one.
//
// WHAT THE ENGINE GIVES THAT AN ENGINELESS BUILD CANNOT. The NAME and the GAIN. The
// game asks the engine's cue bus for a cue by name and the bus announces the play,
// so these checks assert the exact names `CUES` fixes (specs/audio.md). And the bus
// announces a play whether or not anything is audible, carrying a gain of zero while
// it is muted (muting is the engine's, specs/audio.md), which is what lets
// `audio/mute-silences` tell a build that went silent apart from one that stopped
// reacting.
//
// Nothing in this module holds a threshold: every figure a check asserts is stated
// in the check itself, beside the spec line it comes from.

import type { Harness, Point, TimedCue } from "../harness";
import type { Rect } from "../constants";

/** The center of a control's hit rectangle, which is a point inside it. */
export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Run exactly one frame, and report the number that frame carried.
 *
 * `engine.frame().count` is raised before the frame's update runs, so the value
 * this hands back is the same number {@link watchCues} stamped onto whatever that
 * frame played. `stage` runs BEFORE the frame, which is where a pointer sample is
 * dispatched so the frame's update is handed it.
 */
export async function frameWith(
  h: Harness,
  stage?: () => void,
): Promise<number> {
  stage?.();
  await h.advance(1);
  return h.engine.frame().count;
}

/**
 * Press at a stage point through the ENGINE's pointer and run the frame that
 * delivers it, reporting that frame's number.
 *
 * The press is left held: the gesture is split across two frames deliberately, so
 * the cue a press raises and the cue a release raises land on frames a check can
 * tell apart. A build that sounded `drop` on the press would otherwise be
 * indistinguishable from one that sounded it on the release.
 */
export async function pressFrame(h: Harness, at: Point): Promise<number> {
  return frameWith(h, () => {
    h.pointer("pointerdown", at.x, at.y);
  });
}

/**
 * Carry the held run to a stage point and release it there, in one frame, and
 * report that frame's number.
 *
 * The move and the release are dispatched together, so the frame's update is handed
 * both in arrival order (specs/controls.md) and the run's leading card is over `to`
 * when the release resolves.
 */
export async function releaseFrame(h: Harness, to: Point): Promise<number> {
  return frameWith(h, () => {
    h.pointer("pointermove", to.x, to.y);
    h.pointer("pointerup", to.x, to.y);
  });
}

/** How many times `cue` played on frame `frame`. */
export function playedOn(
  cues: readonly TimedCue[],
  frame: number,
  cue: string,
): number {
  return cues.filter((one) => one.frame === frame && one.cue === cue).length;
}

/** How many times `cue` played on any frame before `frame`. */
export function playedBefore(
  cues: readonly TimedCue[],
  frame: number,
  cue: string,
): number {
  return cues.filter((one) => one.frame < frame && one.cue === cue).length;
}

/**
 * How many times `cue` played on any frame after `frame`.
 *
 * The far half of {@link playedBefore}. A cue belongs to the ONE frame its event
 * happened on (specs/audio.md), so a check that read only the frames before the
 * event and the event's own frame would pass a build that echoed the cue on the
 * frame after it, or that left it repeating once started. Every `audio/cue-*` point
 * therefore reads a quiet window on BOTH sides of its event.
 */
export function playedAfter(
  cues: readonly TimedCue[],
  frame: number,
  cue: string,
): number {
  return cues.filter((one) => one.frame > frame && one.cue === cue).length;
}

/** How many times `cue` played on frame `frame` at a gain anything could hear. */
export function audibleOn(
  cues: readonly TimedCue[],
  frame: number,
  cue: string,
): number {
  return cues.filter(
    (one) => one.frame === frame && one.cue === cue && one.gain > 0,
  ).length;
}

/**
 * The names of every cue announced from `mark` onward that sounded at an audible
 * gain, in the order they played.
 *
 * `mark` is a length of the watched list taken before the window opened, so what
 * this reports is every audible cue of the window, whatever its name: a build that
 * silenced the cues a check drives and left some other one audible is caught too.
 */
export function audibleAfter(
  cues: readonly TimedCue[],
  mark: number,
): string[] {
  return cues
    .slice(mark)
    .filter((one) => one.gain > 0)
    .map((one) => one.cue);
}
