// Cascade — reading the cue bus one window at a time, for the `audio/*` points.
// CASE-PROVIDED.
//
// specs/audio.md fixes ten cues, one per event, and one sentence governs every
// point in this directory: "Each is played on the frame its event happens and at
// most once on that frame." So every check here is the same measurement in a
// different scenario: pose the event's world, run a stretch of frames on which
// nothing happens, make the ONE event, and read what the bus announced across
// the event against what it announced over the quiet before and after it.
//
// WHERE A CUE LANDS UNDER THIS ENGINE. A debug operation acts on the live game at
// the moment of the call and routes through exactly the code a player's gesture
// routes through (specs/instrumentation.md), so a `turnStock()`, a `move()` or a
// `pointerDown()` raises its cue AT THE CALL, between two frames, rather than
// inside a frame's own update. A build that instead carries what an operation
// raised into the next tick has played the cue on the first frame after the
// event, and specs/ fixes nothing either way — so a check here reads a WINDOW
// that covers the call and the one frame that follows it, and asserts a count
// over that window rather than a frame number. The one event this case can put
// INSIDE a frame is the cascade's launch, which happens in the game's own tick;
// `audio/cue-launch` reads its frame number as well as its count.
//
// THE QUIET BEFORE AND AFTER IS HALF THE READING. A build that blips a cue on a
// timer sounds on the event too, and a build that raises a flag it never clears
// sounds on every frame after it; both are separated from a conforming build only
// by the silence that should surround the event. Each check therefore states its
// own quiet window, in frames, derived from a duration the case fixes, and reads
// "not before, and not after" across real frames rather than empty ones.
//
// WHAT THE ENGINE GIVES THAT AN ENGINELESS BUILD CANNOT. The NAME and the GAIN.
// The game asks the engine's cue bus for a cue by name and the bus announces the
// play, so these checks assert the exact names `CUES` fixes (specs/audio.md). And
// the bus announces a play whether or not anything is audible, carrying a gain of
// zero while it is muted (muting is the engine's, specs/audio.md), which is what
// lets `audio/mute-silences` tell a build that went silent apart from one that
// stopped reacting — and what lets each per-cue point ask for a cue that could
// actually be heard.
//
// Nothing in this module holds a threshold: every figure a check asserts is
// stated in the check itself, beside the spec line it comes from.

import type { TimedCue } from "../harness";

/**
 * Every cue the bus announced from `mark` onward, in the order it played.
 *
 * `mark` is a length of the watched list taken before the window opened, so what
 * this reports is the window's own announcements whatever their names.
 */
export function since(cues: readonly TimedCue[], mark: number): TimedCue[] {
  return cues.slice(mark);
}

/** Every firing of the cue named `name` from `mark` onward, in order. */
export function playedSince(
  cues: readonly TimedCue[],
  mark: number,
  name: string,
): TimedCue[] {
  return since(cues, mark).filter((one) => one.cue === name);
}

/**
 * The names of every cue announced from `mark` onward that sounded at a gain
 * anything could hear, in the order they played.
 *
 * A build that silenced the cues a check drives and left some other one audible
 * is caught by this too, because it reports every audible name and not only the
 * ones the check asked for.
 */
export function audibleSince(
  cues: readonly TimedCue[],
  mark: number,
): string[] {
  return since(cues, mark)
    .filter((one) => one.gain > 0)
    .map((one) => one.cue);
}
