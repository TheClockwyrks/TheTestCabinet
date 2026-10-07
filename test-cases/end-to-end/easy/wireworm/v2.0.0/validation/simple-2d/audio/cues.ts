// Wireworm — watching the cue bus one frame at a time, for the `audio/*` points.
// CASE-PROVIDED.
//
// specs/ui.md fixes ten cues, one per event, and one sentence governs every point
// in this directory: "Each is played on the frame its event happens and at most
// once on that frame; a frame that raises more than one of them plays each of
// those once." So each audio check is the same measurement in a different
// scenario: pose the event's world, step ONE FRAME AT A TIME so a play can be
// attributed to the frame that produced it, and read the cue against the event's
// own frame and against the frames before it.
//
// ONE FRAME AT A TIME IS THE WHOLE POINT. The runtime announces a play
// synchronously, inside `audio.play`, but it stamps the announcement with its own
// audio clock rather than with a frame, so nothing in a batched `advance` says
// WHEN inside it a cue sounded. A check that read only "the cue happened somewhere
// in this window" would pass a build that plays it on every frame as readily as
// one that plays it on the event. Bracketing each single frame is what turns the
// announcement into a frame number.
//
// THE FRAMES BEFORE THE EVENT ARE HALF THE READING. A build that blips its cue
// continuously sounds on the event's frame too, and is separated from a conforming
// one only by the quiet that should have come first. Every check here therefore
// runs a QUIET LEAD on the board the event is then staged on: frames during which
// the scenario is posed and nothing has happened yet, so "nothing sounded before"
// is a reading of a real window rather than of an empty one.
//
// WHAT THE ENGINE GIVES THAT AN ENGINELESS BUILD CANNOT. The NAME and the GAIN.
// The game asks the runtime's cue bus for a cue by name and the bus announces the
// play, so these checks assert the exact names `CUES` fixes. And the bus announces
// a play whether or not it is muted, carrying a gain of zero while it is
// (specs/ui.md leaves the mute bit to the engine), which is what lets
// `audio/mute-silences` tell a build that went silent apart from one that stopped
// reacting.

import type { Harness } from "../harness";
import type { WirewormSnapshot } from "../surface";

/** One cue the bus announced: the name the build asked for, and its gain. */
export interface PlayedName {
  cue: string;
  /** Zero while the bus is muted, positive otherwise. */
  gain: number;
}

/** What one driven frame played. */
export interface FrameCues {
  /** Which frame of this watch it was, from `1`. */
  step: number;
  /** The cues the build played on it, in order. */
  played: PlayedName[];
}

/** What a watch saw. */
export interface CueWatch {
  /** The event was reached inside the budget. */
  hit: boolean;
  /** The frame of the watch the event was first seen on, or `-1`. */
  at: number;
  /** How many frames ran before the event was staged. */
  lead: number;
  /** One record per frame driven, in order. */
  frames: FrameCues[];
  /** The state the watch ended on. */
  snapshot: WirewormSnapshot;
}

/** How a watch is staged around the event it is about. */
export interface WatchOptions {
  /**
   * Frames driven on the posed board before {@link WatchOptions.arm} runs.
   *
   * This is the quiet the "and not before" half of every check is read across, so
   * it is stated by the check rather than defaulted to something invisible.
   */
  quietLead?: number;
  /** The gesture that stages the event, run after the quiet lead. */
  arm?: () => void | Promise<void>;
}

/**
 * Step one frame at a time until `event` holds, keeping what played on each frame.
 *
 * `maxFrames` counts the whole watch, quiet lead included, and is a HARD window
 * rather than an open-ended wait: a build whose event never arrives fails on the
 * bound the check stated rather than running the suite out.
 *
 * The event is read from the snapshot taken AFTER each frame, so the frame a check
 * calls the event's is the frame during which the build's own code produced it,
 * which is the frame specs/ui.md requires the cue on.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: WirewormSnapshot) => boolean,
  maxFrames: number,
  options: WatchOptions = {},
): Promise<CueWatch> {
  const { quietLead = 0, arm } = options;
  const frames: FrameCues[] = [];
  let armed = arm === undefined;

  for (let step = 1; step <= maxFrames; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
    }
    const read = h.cues.length;
    await h.advance(1);
    frames.push({
      step,
      played: h.cues.slice(read).map(({ cue, gain }) => ({ cue, gain })),
    });

    const snapshot = h.snapshot();
    if (armed && event(snapshot)) {
      return { hit: true, at: step, lead: quietLead, frames, snapshot };
    }
  }
  return {
    hit: false,
    at: -1,
    lead: quietLead,
    frames,
    snapshot: h.snapshot(),
  };
}

/** How many times `cue` played on the event's own frame. */
export function cuesOnEvent(watch: CueWatch, cue: string): number {
  const on = watch.frames.find((frame) => frame.step === watch.at);
  return on === undefined
    ? 0
    : on.played.filter((one) => one.cue === cue).length;
}

/**
 * How many times `cue` played on any frame before the event's.
 *
 * A watch that never reached its event counts every frame it drove, so a build
 * that sounded the cue without ever producing the event is named for the noise as
 * well as for the miss.
 */
export function cuesBeforeEvent(watch: CueWatch, cue: string): number {
  return watch.frames
    .filter((frame) => watch.at < 0 || frame.step < watch.at)
    .reduce(
      (total, frame) =>
        total + frame.played.filter((one) => one.cue === cue).length,
      0,
    );
}

/** Every cue announced over the frames of a watch, in order, by name. */
export function playedNames(watch: CueWatch): string[] {
  return watch.frames.flatMap((frame) => frame.played.map((one) => one.cue));
}
