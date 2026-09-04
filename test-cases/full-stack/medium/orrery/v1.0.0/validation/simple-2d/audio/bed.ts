// audio/bed — how the music bed is read, written once for the nine checks that
// decide it. CASE-PROVIDED, and the SAME FILE in all three engine projects.
//
// A PRIVATE MODULE OF THIS DIRECTORY, named for the thing it reads rather than
// for a review item, and no manifest entry points at it — the precedent
// `validation/README.md` sets with `collision/examples.ts`. IT ARRANGES NOTHING
// AND IT ASSERTS NOTHING: it runs the frames a check asks for and hands back what
// each of them reported, and the check that called it decides the point.
//
// WHY THE BED IS READ THROUGH TWO NUMBERS RATHER THAN ONE. `specs/ui.md` fixes
// what the bed SOUNDS like — "`LOOPING_CUES` holds the one cue that loops until
// stopped rather than playing once. `music` is looping on every frame the game
// runs" — and says nothing about how a build makes it seamless. A build that sets
// the loop flag on one source is read directly by {@link BedFrame.looping}. A
// build that instead re-schedules the buffer end to end is playing exactly the
// same bed and reports no looping source at all; what it does report is SOUND,
// frame after frame, which is why {@link BedWindow.sounded} is carried beside the
// looping count and why {@link BedWindow.stopped} counts a frame against the
// build only when NEITHER reading found the bed.
//
// So a window decides three ways, and each is the honest one for the build it
// describes: a looping build is held to every frame of the window; a
// re-scheduling build is held to sounding within it; and a build with no bed at
// all reports neither and fails — which is the whole point, and is why every
// check that opens a window opens it where nothing BUT the bed can sound.

import type { ScreenName, SimStatusName } from "../constants";
import type { OrrerySnapshot } from "../snapshot";

/**
 * The slice of a harness this module drives.
 *
 * Declared structurally rather than imported, exactly as `scenario.ts`'s `Driven`
 * is, so this one file serves all three projects: each project's own `Harness`
 * satisfies it, and none of them is named here.
 */
export interface Sounding {
  /** The frames this harness has driven, 1-based. */
  frame(): number;
  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Run `frames` frames at the harness's own clock. */
  advance(frames?: number): Promise<void>;
  /** How many sounds the build has emitted since the game stood up, in total. */
  sounds(): Promise<number>;
  /** How many of the sources the build started are still live and LOOPING. */
  loopingSounds(): Promise<number>;
  /** How many of the sounds emitted were looping when they started. */
  loopStarts(): Promise<number>;
}

/** What one frame of a window reported. */
export interface BedFrame {
  /** The frame, 1-based, as `Harness.frame()` counts them. */
  frame: number;
  /** Looping sources live at the end of it. A looped bed is at least one. */
  looping: number;
  /** Sounds the build has emitted in total by the end of it. */
  sounds: number;
  /** The screen the game was on. */
  screen: ScreenName;
  /** The run's status, or `null` with no run live. */
  status: SimStatusName | null;
}

/** What a stretch of frames reported about the bed. */
export interface BedWindow {
  /** Every frame of the window, in order. */
  readings: BedFrame[];
  /** Sounds emitted in total when the window opened. */
  opened: number;
  /** Loop starts counted when the window opened. */
  loopsOpened: number;
  /** Loop starts counted when it closed. A bed stopped and restarted moves this. */
  loopsClosed: number;
  /** Whether the build emitted any sound at all within the window. */
  sounded: boolean;
  /**
   * The frames of the window on which the bed was found neither looping nor
   * sounding, as `Harness.frame()` counts them: the frames a check reports.
   *
   * Empty on a build that loops the bed, empty on a build that re-schedules it,
   * and every frame of the window on a build that runs no bed.
   */
  stopped: number[];
}

/**
 * Run `frames` frames one at a time, reading the bed after each, and hand back
 * what they reported.
 *
 * One frame per read on purpose: the bed is required on EVERY frame, so a window
 * that ran its frames in one call and read once afterwards could not tell a bed
 * that held from one that stopped in the middle and started again.
 */
export async function watchBed(
  h: Sounding,
  frames: number,
): Promise<BedWindow> {
  const opened = await h.sounds();
  const loopsOpened = await h.loopStarts();
  const readings: BedFrame[] = [];
  for (let i = 0; i < frames; i += 1) {
    await h.advance(1);
    const snapshot = await h.snapshot();
    readings.push({
      frame: h.frame(),
      looping: await h.loopingSounds(),
      sounds: await h.sounds(),
      screen: snapshot.screen,
      status: snapshot.sim?.status ?? null,
    });
  }
  const last = readings[readings.length - 1];
  const sounded = (last?.sounds ?? opened) > opened;
  return {
    readings,
    opened,
    loopsOpened,
    loopsClosed: await h.loopStarts(),
    sounded,
    stopped: sounded
      ? []
      : readings.filter((r) => r.looping === 0).map((r) => r.frame),
  };
}

/** The screens the window's frames were drawn on, in order, without repeats. */
export function screensOf(window: BedWindow): ScreenName[] {
  const seen: ScreenName[] = [];
  for (const reading of window.readings) {
    if (seen[seen.length - 1] !== reading.screen) seen.push(reading.screen);
  }
  return seen;
}

/** The run statuses the window's frames were drawn under, in order, without repeats. */
export function statusesOf(window: BedWindow): (SimStatusName | null)[] {
  const seen: (SimStatusName | null)[] = [];
  for (const reading of window.readings) {
    if (seen.length === 0 || seen[seen.length - 1] !== reading.status) {
      seen.push(reading.status);
    }
  }
  return seen;
}
