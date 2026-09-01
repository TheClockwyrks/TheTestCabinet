// audio/cues — what the points of this category share: the two readings every
// one of them makes off the engine's cue bus, and the keys the menu points
// press. CASE-PROVIDED.
//
// No review item names this file. Each helper is one reading stated once, so
// the points below read a cue the same way; nothing here poses a night, because
// each point's pose is the part of it worth reading beside its assertion.
//
// WHERE THE READINGS COME FROM. specs/ui.md, Audio: "Audio plays through the
// engine's cue bus"; "Each is played on the tick its event happens, or on the
// frame for a menu event, and at most once on that tick". The Simple 2D engine
// announces every play as `cue:played` and every loop start as `cue:looped`,
// and `harness.ts` keeps both, so a drive's cues are exactly what the build
// asked the bus for. "A cue is played by a tick or a frame, never by a pose of
// the debug surface" (specs/ui.md), so every point arranges its night, opens a
// recording, and only then runs the frames it is about.
//
// WHY THE LOOPS ARE READ FRAME BY FRAME. specs/ui.md, The loops: "music is
// looping on every frame exactly when screen is playing, levelup, chest, or
// paused", and "Both loops are reconciled from the state on every frame". A
// reading taken once at the end of a stretch would pass a build that dropped
// the loop in the middle and started it again, so the stretch is walked one
// frame at a time and every frame is read.

import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { cuesNamed, type Harness, type TimedCue } from "../harness";

/**
 * The key `specs/controls.md` binds `down` to first: "`down` | `ArrowDown`,
 * `KeyS`". It moves a menu highlight on every screen that has one.
 */
export const DOWN_KEY = BINDINGS.down[0];

/**
 * The key `specs/controls.md` binds `confirm` to first: "`confirm` | `Enter`,
 * `Space`". It accepts the highlighted item.
 */
export const CONFIRM_KEY = BINDINGS.confirm[0];

/**
 * The key `specs/controls.md` binds `back` to: "`back` | `Escape`". On
 * `paused` it "abandons the run and returns to `title`" (specs/ui.md).
 */
export const BACK_KEY = BINDINGS.back[0];

/**
 * How many frames a point that reads a loop "on every frame" of a screen walks:
 * one second of frames at `TICK_HZ`. The specification states no length, so the
 * span is the tolerance: a build that dropped the loop anywhere in a second of
 * the screen fails, and one that holds it for a second passes.
 */
export const LOOP_FRAMES = 60;

/** Every recorded play of `name`, oldest first. */
export function playsOf(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cuesNamed(cues, name);
}

/**
 * `name` sounded exactly `count` times across the recorded drive.
 *
 * The whole of the once-per-tick rule is a count: "a tick on which twenty
 * enemies take damage plays `hit` once" (specs/ui.md, Audio). A drive of one
 * tick therefore reads `1`, and a cue an event must not raise reads `0`.
 */
export function assertPlayed(
  cues: readonly TimedCue[],
  name: string,
  count: number,
  context: string,
): void {
  assertLength(playsOf(cues, name), count, context);
}

/**
 * Walk `frames` frames one at a time, reading `looping(cue)` after each and
 * failing on the first frame that disagrees with `expected`.
 *
 * The frames run through `tick`, one frame of the harness's constant clock
 * each, which is one tick on `playing` and nothing at all on every other
 * screen (specs/ui.md, What advances on each screen).
 */
export async function assertLoopAcross(
  h: Harness,
  cue: string,
  frames: number,
  expected: boolean,
  context: string,
): Promise<void> {
  for (let frame = 1; frame <= frames; frame += 1) {
    await h.tick(1);
    assertEqual(h.looping(cue), expected, `${context}: frame ${frame}`);
  }
}
