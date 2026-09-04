// Spectra — watching the engine's cue bus frame by frame, for the `audio/*`
// points. CASE-PROVIDED.
//
// `specs/ui.md` fixes nine cues, one per event, and one sentence governs all nine
// of them: "Each is played on the frame its event happens and at most once on
// that frame." So every cue check in this directory is the same measurement in a
// different scenario — pose the one event, step ONE FRAME AT A TIME so a play can
// be attributed to the frame that produced it, and read the cue against the
// event's own frame and against the frames before it.
//
// ONE FRAME AT A TIME IS THE WHOLE POINT. The engine announces a play
// synchronously, from inside `audio.play`, but a batched `advance` reaches the
// same state and says nothing about WHEN inside it a cue sounded. A check that
// read only "the cue happened somewhere in this window" would pass a build that
// plays it every frame as readily as one that plays it on the shot. Bracketing
// each single frame is what turns the announcement into a frame number.
//
// WHAT THE ENGINE GIVES THAT AN ENGINELESS BUILD CANNOT. The NAME. Under this
// engine the game defines its cues from the instance's `initialize` and plays one
// by name from the world's audio inside a tick, and the bus announces the play
// (`specs/ui.md`), so these checks assert the exact name `CUES` fixes, sounding
// exactly ONCE on the event's own frame — which is the "at most once on that
// frame" half of the requirement — and not at all on the frames before it. A play
// is announced whether or not the bus is unlocked and whether or not it is muted,
// so nothing here has to arm anything.
//
// WHY THE "NOT BEFORE" READING NAMES A CUE. Each check asks only that ITS OWN cue
// stayed quiet before its event, not that the window was silent. `specs/ui.md`
// allows a frame to raise more than one cue and plays each of those once, so a
// scenario in which a second event legitimately sounds — a kill that also clears
// the stage — must not be read as a failure of the cue under test. The name is
// what makes that distinction available, and it is the whole reason these checks
// are stronger here than under an engineless build.
//
// NOTHING IS POSED HERE. `harness.ts` already places a bullet without driving a
// frame (`posePlayerBullet`, `poseEnemyBullet`), which is what a cue check needs:
// it steps the flight itself, one frame at a time, rather than sweeping it in one
// batched advance. So this module is the WATCHING alone.

import { fail } from "../assert";
import { droneById, type DroneSnapshot } from "../harness";
import type { Harness, PlayedCue, SpectraSnapshot } from "../harness";

/** What one driven frame played. */
export interface FrameCues {
  /** Which frame of this watch it was, from `1`. */
  step: number;
  /** The cues the build played on it, as the bus announced them, in order. */
  played: PlayedCue[];
}

/** What a watch saw. */
export interface CueWatch {
  /** The event was reached inside the budget. */
  hit: boolean;
  /** The frame of the watch the event was first seen on, or `-1`. */
  at: number;
  /** One record per frame driven, in order. */
  frames: FrameCues[];
  /** The state the watch ended on. */
  snapshot: SpectraSnapshot;
}

/** How a watch is staged around the event it is about. */
export interface WatchOptions {
  /**
   * Frames driven before {@link WatchOptions.arm} is called.
   *
   * For an event that lands on the first frame it possibly can — a key read once
   * per press, a flip that is instant — the frames before it would otherwise be
   * none at all, and "the cue did not sound before the event" would be a reading
   * of an empty window. A lead gives that reading something to be quiet across,
   * driven on exactly the field the event is then staged on.
   */
  quietLead?: number;
  /** The gesture that stages the event, run after the quiet lead. */
  arm?: () => void | Promise<void>;
}

/**
 * Step one frame at a time until `event` holds, keeping what played on each.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each frame, so the frame a
 * check calls the event's is the frame during which the build's own code produced
 * it — which is the frame `specs/ui.md` requires the cue on.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: SpectraSnapshot) => boolean,
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
    frames.push({ step, played: h.cues.slice(read) });

    const snapshot = h.snapshot();
    if (armed && event(snapshot)) {
      return { hit: true, at: step, frames, snapshot };
    }
  }
  return { hit: false, at: -1, frames, snapshot: h.snapshot() };
}

/** Every play of `cue` on the event's own frame, as the bus announced them. */
export function playsOnEvent(watch: CueWatch, cue: string): PlayedCue[] {
  const on = watch.frames.find((one) => one.step === watch.at);
  return on === undefined ? [] : on.played.filter((one) => one.cue === cue);
}

/** How many times `cue` played on the event's own frame. */
export function cuesOnEvent(watch: CueWatch, cue: string): number {
  return playsOnEvent(watch, cue).length;
}

/** How many times `cue` played on any frame before the event's. */
export function cuesBeforeEvent(watch: CueWatch, cue: string): number {
  return watch.frames
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce(
      (total, one) =>
        total + one.played.filter((play) => play.cue === cue).length,
      0,
    );
}

/**
 * The gain the first play of `cue` on the event's frame was announced at, or `-1`
 * where it never played there.
 *
 * The bus reports `gain: 0` for a play made while it is muted and the cue's own
 * gain otherwise, so this is how a check says the cue was AUDIBLE. None of these
 * scenarios mutes anything, and `specs/ui.md` asks for nine distinct short SOUNDS,
 * so a build that plays every cue into a bus it muted for itself is playing
 * nothing a player hears.
 */
export function gainOnEvent(watch: CueWatch, cue: string): number {
  return playsOnEvent(watch, cue)[0]?.gain ?? -1;
}

/** How many frames of quiet the watch actually read before the event. */
export function quietFrames(watch: CueWatch): number {
  return watch.at < 0 ? watch.frames.length : watch.at - 1;
}

/* -------------------------------------------------------------------------- */
/* Sounds started, for the two silence points                                 */
/* -------------------------------------------------------------------------- */

/** One sound the build started: a cue played once, or a cue set looping. */
export interface StartedSound {
  /** The name the build asked the bus for. */
  cue: string;
  /** Which of the bus's two ways of starting a sound it was. */
  how: "played" | "looped";
}

/**
 * Record every sound the build STARTS from now on, by either door.
 *
 * The two silence points — `audio/mute-silences` and `audio/no-autoplay` — are
 * about the game starting no sound at all, and the engine's bus has two ways to
 * start one: `play` sounds a cue once and announces `cue:played`, `loop` sets one
 * running and announces `cue:looped`. A build that opened a looping drone would
 * be making sound while announcing no play, so both doors are watched.
 */
export function watchSounds(h: Harness): StartedSound[] {
  const started: StartedSound[] = [];
  h.engine.events.on("cue:played", ({ cue }) => {
    started.push({ cue, how: "played" });
  });
  h.engine.events.on("cue:looped", ({ cue }) => {
    started.push({ cue, how: "looped" });
  });
  return started;
}

/* -------------------------------------------------------------------------- */
/* Reading back a posed drone                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The drone `poseDrone` put on the field, read back off the snapshot.
 *
 * A cue check that sends a shot at a drone needs the band the drone READS AS —
 * `effectiveBand`, which `specs/bands.md` makes the shot's target — and that is
 * only available from the snapshot. A build whose `addDrone` left no drone behind
 * fails here naming the operation rather than further down, where the failure
 * would read as a missing cue.
 */
export function posedDrone(h: Harness, id: number): DroneSnapshot {
  const drone = droneById(h.snapshot(), id);
  if (drone === undefined) {
    fail(
      `the drone posed as id ${String(id)} to stand in the roster ` +
        "(specs/instrumentation.md)",
      "no drone on the field carries that id",
    );
  }
  return drone;
}
