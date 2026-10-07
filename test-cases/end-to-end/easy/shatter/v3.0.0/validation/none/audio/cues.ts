// Shatter — watching the build's sound tick by tick, for the `audio/*` points.
//
// `specs/audio.md` fixes six cues, one per event, and one sentence governs all of
// them: "Each is played on the tick its event happens and at most once on that
// tick; a tick that raises more than one of them plays each of those once." So
// every cue check in this directory is the same measurement in a different
// scenario — pose the event, step ONE TICK AT A TIME so a sound can be attributed
// to the tick that produced it, and read what sounded on the event's own tick
// against what sounded on the ticks before it.
//
// ONE TICK AT A TIME IS THE WHOLE POINT. A batched advance reaches the same state
// and says nothing about WHEN inside it a sound was made, and a check that read
// only "a sound happened somewhere in this window" would pass a build that blips
// continuously as readily as one that blips on the event. Only
// {@link Harness.advance} attributes a sound to a tick (see {@link watchCues} in
// `../harness.ts`), so everything here advances and nothing here skips.
//
// WHAT THIS ENGINE CAN AND CANNOT HEAR. Under an engine the cue bus belongs to the
// runtime: the game asks for a cue BY NAME and the bus announces the play, so a
// check reads the name. An engineless build writes the whole audio layer itself —
// `specs/audio.md` says in as many words that it synthesizes its sounds with the
// Web Audio API — so there is no bus to subscribe to and no name to read. What is
// observable is that a sound was emitted and on which tick, which
// `../audio-init.js` obtains by watching the two doors a browser can emit sound
// through. Two consequences follow, and both are honest reductions rather than
// choices:
//
//   * A cue is counted as SOUNDS, not as one play. A blip made of a tone and a
//     noise burst is two sources and one cue, and `specs/audio.md` never fixed the
//     number, so these checks ask that the event's tick SOUNDED — not that it
//     sounded once. "At most once on that tick" is therefore not decidable here,
//     and `audio/fire-cue` reads the tail of silence after the shot instead, which
//     is the part of that rule this engine can hear.
//   * The quiet before an event is read as total silence rather than as the
//     absence of one named cue. Every scenario in this directory poses exactly one
//     event on an emptied field, so on a conforming build there is nothing else
//     for the window to carry.
//
// A CUE MAY ALSO BE RAISED BETWEEN TICKS. `specs/audio.md` puts each cue on the
// tick its event happens, and the two key-driven events — the gun and the burn —
// reach the game through a key that is pressed between two driven ticks. A build
// that answers the key from its own DOM handler emits a sound that no driven tick
// accounts for, which is why {@link CueWatch.soundsSinceArm} exists: it counts
// everything the build emitted from the arming gesture through the end of the
// event's tick, whether a tick accounted for it or not. A check that uses it also
// asserts the ticks between the gesture and the event were silent, so the window
// stays the event's own moment.

import type { Harness, ShatterSnapshot } from "../harness";
import { stops as stopsSoFar, watchCues } from "../harness";

/** What one driven tick of a watch sounded and stopped. */
export interface TickSound {
  /** Which tick of this watch it was, from `1`. */
  step: number;
  /** How many sounds the build emitted on it. */
  sounds: number;
  /** How many sounding voices the build stopped on it. */
  stops: number;
}

/** What a watch saw. */
export interface CueWatch {
  /** The event was reached inside the budget. */
  hit: boolean;
  /** The step the event was first seen on, or `-1` where it never was. */
  at: number;
  /** The step {@link WatchOptions.arm} ran after; `0` when nothing was armed. */
  armedAt: number;
  /** One record per tick driven, in order. */
  ticks: TickSound[];
  /**
   * Every sound the build emitted from the arming gesture through the end of the
   * event's tick, whether a driven tick accounted for it or not.
   *
   * `0` where the event was never reached.
   */
  soundsSinceArm: number;
  /** The state the watch ended on. */
  snapshot: ShatterSnapshot;
}

/** How a watch is posed around the event it is about. */
export interface WatchOptions {
  /**
   * Ticks driven before {@link WatchOptions.arm} is called.
   *
   * For an event that lands on the first tick it possibly can — a key read once
   * per press — the ticks before it would otherwise be none at all, and "nothing
   * sounded before the event" would be a reading of an empty window. A lead gives
   * that reading something to be quiet across, driven on exactly the field the
   * event is then posed on.
   */
  quietLead?: number;
  /** The gesture that poses the event, run after the quiet lead. */
  arm?: () => void | Promise<void>;
}

/**
 * Step one tick at a time until `event` holds, keeping what each tick sounded.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each tick, so the tick a check
 * calls the event's is the tick during which the build's own code produced it —
 * which is the tick `specs/audio.md` requires the cue on.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: ShatterSnapshot) => boolean,
  maxTicks: number,
  options: WatchOptions = {},
): Promise<CueWatch> {
  const { quietLead = 0, arm } = options;
  const sounds = watchCues(h);
  const ticks: TickSound[] = [];
  let readSounds = 0;
  // The stop count is a RUNNING TOTAL read across each tick rather than a sink the
  // drive fills, because a stop cannot honestly be attributed to a tick: a key
  // comes up between two driven ticks, and a build that answers the release from
  // its own DOM handler stops its voice at a moment no tick accounts for. Reading
  // the total either side of the tick puts that moment inside the window it
  // belongs to. See {@link stopsSoFar}.
  let readStops = await stopsSoFar(h);
  let armed = arm === undefined;
  let armedAt = 0;
  let armedTotal = await h.sounds();

  for (let step = 1; step <= maxTicks; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
      armedAt = step - 1;
      armedTotal = await h.sounds();
    }
    // The state the tick left comes back off the step that ran it, rather than
    // from a second crossing asking for the reading the first one already had.
    const snapshot = await h.step(1);
    const tick = h.tick();
    const stoppedSoFar = await stopsSoFar(h);
    ticks.push({
      step,
      sounds: sounds.slice(readSounds).filter((cue) => cue.tick === tick)
        .length,
      stops: stoppedSoFar - readStops,
    });
    readSounds = sounds.length;
    readStops = stoppedSoFar;

    if (armed && event(snapshot)) {
      return {
        hit: true,
        at: step,
        armedAt,
        ticks,
        soundsSinceArm: (await h.sounds()) - armedTotal,
        snapshot,
      };
    }
  }
  return {
    hit: false,
    at: -1,
    armedAt,
    ticks,
    soundsSinceArm: 0,
    snapshot: await h.snapshot(),
  };
}

/** Drive `ticks` ticks with nothing posed, and report what they sounded. */
export async function driveQuiet(
  h: Harness,
  ticks: number,
): Promise<{ sounds: number; stops: number }> {
  const sounds = watchCues(h);
  const before = await stopsSoFar(h);
  await h.advance(ticks);
  return { sounds: sounds.length, stops: (await stopsSoFar(h)) - before };
}

/** How many sounds the build emitted on one numbered step of a watch. */
export function soundsOnTick(watch: CueWatch, step: number): number {
  return watch.ticks.find((one) => one.step === step)?.sounds ?? 0;
}

/** How many sounds it emitted on the event's own tick. */
export function soundsOnEvent(watch: CueWatch): number {
  return soundsOnTick(watch, watch.at);
}

/** How many it emitted on the steps strictly between two of them. */
export function soundsBetween(
  watch: CueWatch,
  after: number,
  before: number,
): number {
  return watch.ticks
    .filter((one) => one.step > after && one.step < before)
    .reduce((total, one) => total + one.sounds, 0);
}

/**
 * How many it emitted on every step before the event's.
 *
 * A watch that never reached its event reports every step it drove, so a build
 * that sounded when nothing happened is still named by the check that read it.
 */
export function soundsBeforeEvent(watch: CueWatch): number {
  return watch.ticks
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce((total, one) => total + one.sounds, 0);
}

/** How many sounding voices it stopped on one numbered step. */
export function stopsOnTick(watch: CueWatch, step: number): number {
  return watch.ticks.find((one) => one.step === step)?.stops ?? 0;
}

/** How many it stopped from the event's own tick onward. */
export function stopsFromEvent(watch: CueWatch): number {
  return watch.ticks
    .filter((one) => watch.at >= 0 && one.step >= watch.at)
    .reduce((total, one) => total + one.stops, 0);
}
