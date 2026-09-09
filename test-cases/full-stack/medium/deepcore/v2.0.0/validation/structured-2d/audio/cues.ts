// Deepcore — reading WHICH cue sounded, and WHEN. CASE-PROVIDED.
//
// WHAT THESE POINTS CAN READ HERE THAT THE ENGINELESS PROJECT CANNOT. The audio
// bus belongs to the Structured 2D engine (`engine/audio.md`): the game declares
// the thirteen names `specs/assets.md` fixes and asks for one BY NAME, and the
// engine announces every play, every loop start and every loop stop as an event
// carrying that name, the frame's simulated time, and the gain it sounded at. So
// a check here decides WHICH cue the build played, not merely that a sound came
// out — a build that plays its launch roar on every drill hit fails its points
// rather than being left to the reviewer's ear.
//
// A CUE SOUNDS IN TWO SHAPES, and `specs/assets.md` fixes neither for most of the
// thirteen. `drill` and `thrust` are stated as looping and the alarms as playing
// while their condition holds, and a build is free to satisfy either with one
// looping source or with a cue re-triggered as the condition runs. So what these
// helpers answer is whether a NAME WAS AUDIBLE over a stretch of frames: a
// one-shot played inside it, or a loop of that name running across it. Both
// readings pass, and a name that neither played nor looped fails.
//
// NOTHING HERE ARMS ANYTHING. The engine announces a cue whether or not a device
// could sound it, so there is no unlock gesture to fake, no decode to wait for,
// and no real time to burn: a check poses its scene, drives its frames, and reads
// what arrived. A muted play still reports, at `gain: 0`, which is what
// `audio/mute-toggle` reads.

import type { Harness, PlayedCue } from "../harness";

/** One loop the build ended, as the engine announced it. */
export interface StoppedCue {
  cue: string;
  /** The frame of the drive it stopped on, as `engine.frame().count` reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** Everything the audio bus announced from the moment it was watched. */
export interface AudioLog {
  /** One-shots, oldest first. */
  played: PlayedCue[];
  /** Loop starts, oldest first. */
  looped: PlayedCue[];
  /** Loop ends, oldest first. */
  stopped: StoppedCue[];
}

/** A run of frames, named by the frame counts either side of it. */
export interface FrameWindow {
  /** The count before the first frame of the run. */
  from: number;
  /** The count after the last. */
  to: number;
}

/**
 * Record every play, loop start and loop stop the build makes from now on, over
 * every loop already running.
 *
 * Subscribed at the moment it is called, so a check that watches AFTER posing its
 * scene reads the drive alone. The engine's frame counter is stamped on each, and
 * it is incremented before an update runs — so a cue raised by the `n`th frame of
 * a run that opened at count `c` carries `c + n`, and a window is the half-open
 * `(from, to]` the helpers below use.
 *
 * A loop is announced ONCE, when it starts, and a loop running when the watch
 * opens is sounding through every window the watch will read — a music bed the
 * build started as the expedition opened, which `engine/audio.md` has play on
 * across levels, is the case `specs/assets.md` names. So `looped` opens holding
 * each loop running at this moment, with the frame it started on, read through
 * the harness's own record of the engine's starts and stops; a loop the build
 * has since stopped is not in it, and one it stops later lands in `stopped`.
 */
export function watchAudio(h: Harness): AudioLog {
  const log: AudioLog = { played: [], looped: [], stopped: [] };
  for (const running of h.loopsRunning()) log.looped.push({ ...running });
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    log.played.push({ cue, frame: h.frame(), t, gain });
  });
  h.engine.events.on("cue:looped", ({ cue, t, gain }) => {
    log.looped.push({ cue, frame: h.frame(), t, gain });
  });
  h.engine.events.on("cue:stopped", ({ cue, t }) => {
    log.stopped.push({ cue, frame: h.frame(), t });
  });
  return log;
}

/** Drive `run` and report the frames it covered. */
export async function over(
  h: Harness,
  run: () => Promise<unknown>,
): Promise<FrameWindow> {
  const from = h.frame();
  await run();
  return { from, to: h.frame() };
}

/** Drive `seconds` of game time in `frames` frames and report the window. */
export function overSeconds(
  h: Harness,
  seconds: number,
  frames: number,
): Promise<FrameWindow> {
  return over(h, () => h.advanceSeconds(seconds, frames));
}

/** Every one-shot of `cue` the window holds. */
export function playsIn(
  log: AudioLog,
  cue: string,
  window: FrameWindow,
): PlayedCue[] {
  return log.played.filter(
    (entry) =>
      entry.cue === cue &&
      entry.frame > window.from &&
      entry.frame <= window.to,
  );
}

/**
 * The stretches a loop of `cue` was running over, as `[start, end]` frame pairs.
 *
 * `end` is `null` for a loop still running at the end of the log. The engine
 * emits `cue:looped` once when a loop starts and `cue:stopped` once when it ends,
 * and a cue is either looping or not, so the two interleave into plain runs.
 */
function loopRuns(
  log: AudioLog,
  cue: string,
): { start: number; end: number | null }[] {
  const marks = [
    ...log.looped
      .filter((entry) => entry.cue === cue)
      .map((entry) => ({ frame: entry.frame, starts: true })),
    ...log.stopped
      .filter((entry) => entry.cue === cue)
      .map((entry) => ({ frame: entry.frame, starts: false })),
  ].sort((a, b) => a.frame - b.frame);

  const runs: { start: number; end: number | null }[] = [];
  for (const mark of marks) {
    const open = runs[runs.length - 1];
    if (mark.starts) {
      if (open === undefined || open.end !== null) {
        runs.push({ start: mark.frame, end: null });
      }
    } else if (open !== undefined && open.end === null) {
      open.end = mark.frame;
    }
  }
  return runs;
}

/**
 * Whether `cue` was audible anywhere in the window: a one-shot played inside it,
 * or a loop of that name running across any part of it.
 *
 * A loop that started before the window and has not stopped counts, because it is
 * sounding through the whole of it; a loop that stopped on the window's opening
 * frame does not, because that frame is the last one before the window.
 */
export function audibleIn(
  log: AudioLog,
  cue: string,
  window: FrameWindow,
): boolean {
  if (playsIn(log, cue, window).length > 0) return true;
  return loopRuns(log, cue).some(
    (run) =>
      run.start <= window.to && (run.end === null || run.end > window.from),
  );
}

/** Whether a loop of `cue` is running at the end of the log. */
export function loopingNow(log: AudioLog, cue: string): boolean {
  const runs = loopRuns(log, cue);
  const last = runs[runs.length - 1];
  return last !== undefined && last.end === null;
}

/**
 * Drive `seconds` of game time in `frames` frames and report whether `cue` was
 * audible over them.
 *
 * The window a "silent, then sounding, then silent" reading is built out of.
 */
export async function audibleOver(
  h: Harness,
  log: AudioLog,
  cue: string,
  seconds: number,
  frames: number,
): Promise<boolean> {
  return audibleIn(log, cue, await overSeconds(h, seconds, frames));
}

/** Every cue of any name the window holds, played or started looping. */
export function soundedIn(log: AudioLog, window: FrameWindow): PlayedCue[] {
  return [...log.played, ...log.looped]
    .filter((entry) => entry.frame > window.from && entry.frame <= window.to)
    .sort((a, b) => a.frame - b.frame);
}

/** Each cue in the window as `name@offset`, offsets measured from its opening. */
export function transcript(log: AudioLog, window: FrameWindow): string[] {
  return soundedIn(log, window).map(
    (entry) => `${entry.cue}@${entry.frame - window.from}`,
  );
}
