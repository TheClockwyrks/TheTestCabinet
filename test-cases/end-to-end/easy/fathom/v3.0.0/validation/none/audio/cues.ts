// Fathom — watching the cue bus tick by tick, for the `audio/*` points.
// CASE-PROVIDED.
//
// `specs/progression.md` fixes seven cues, one per event, and one sentence
// governs all seven of these points: "Each is played on the tick its event
// happens, and at most once on that tick". So every audio check is the same
// measurement in a different scenario — stage the event, step ONE TICK AT A TIME
// so a sound can be attributed to the tick that produced it, and read what
// sounded on the event's own tick against what sounded on the ticks before it.
//
// ONE TICK AT A TIME IS THE WHOLE POINT. A batched advance reaches the same state
// and says nothing about WHEN inside it a sound was made, and a check that read
// only "a sound happened somewhere in this window" would pass a build that blips
// continuously as readily as one that blips on the bite.
//
// WHAT THIS ENGINE CAN AND CANNOT SEE. Under an engine the cue bus belongs to the
// runtime: the game asks for a cue BY NAME and the bus announces the play, so a
// check reads the name. An engineless build writes the whole audio layer itself,
// so there is no bus to subscribe to and no name to read — `specs/progression.md`
// fixes the seven names inside the build's own code and says nothing about how a
// build makes a sound. What is observable here is that a sound was emitted and on
// which tick, which `validation/audio-init.js` obtains by watching the two doors a
// browser can emit sound through. Two consequences follow, and both are honest
// reductions rather than choices:
//
//   * A cue is counted as SOUNDS, not as one play. A blip made of a tone and a
//     noise burst is two sources and one cue, and the specification never fixed
//     the number, so these checks ask that the event's tick SOUNDED — not that it
//     sounded once. "At most once on that tick" is not decidable here.
//   * The quiet before the event is read as total silence rather than as the
//     absence of one named cue. Every scenario in this directory stages exactly
//     one event and holds everything else still, so on a conforming build there is
//     nothing else for the window to carry.
//
// ONLY A TICK STEPPED ON ITS OWN ATTRIBUTES A SOUND TO A TICK. `Harness.scan`
// reports what sounded over each step it took, so a watch stepping one tick at a
// time reads a tick's own sounds; a `skip` runs its ticks in one call and can say
// nothing about which of them sounded, so no watch here skips.

import type { FathomSnapshot, Harness } from "../harness";

/**
 * How many ticks one crossing into the page carries.
 *
 * THE MEASUREMENT IS STILL PER TICK. Every tick is stepped on its own — one
 * `advance(1)`, one reading, one sound count — because that is what attributes a
 * sound to the tick that made it. What this decides is only how many of those
 * readings are carried back out at a time, and so how many round trips a watch
 * costs: a tenth of a second's worth, rather than one apiece.
 *
 * WHAT IT COSTS. A watch stops at the end of the chunk its event landed in rather
 * than on the event's own tick, so the run can stand up to a chunk short of a
 * tenth of a second past it. Nothing a check reads moves — the tick the event
 * landed on, the sounds on it, the sounds before it and the state it left are all
 * read out of the chunk exactly as a tick-at-a-time loop read them — and every
 * scenario in this directory is held still around its event, so the ticks past it
 * carry nothing.
 */
const CHUNK_TICKS = 12;

/**
 * Ticks per step over the stretch of a watch where the event is still a long way
 * off, for the two points whose event is minutes of cadence rather than a press.
 *
 * WHY A LEAD EXISTS AT ALL. `specs/instrumentation.md` has `advance` REDRAW, so a
 * tick stepped on its own costs the build a whole frame of its own rendering — a
 * few milliseconds of processor on an idle machine and tens of times that on one
 * that is busy. The events here are not always near: a Flarefish's bloom is
 * `FLARE_INTERVAL` (`7 s`) of wandering away and a Gloamfin's ping
 * `GLOAMFIN_PING_INTERVAL` (`4 s`), which is eight hundred to a thousand ticks of
 * waiting for a reading that concerns one of them. Stepping every one of those
 * one at a time makes the point's verdict a reading of how busy the host was,
 * which is exactly what a verdict must never be.
 *
 * WHAT THE LEAD READS. The same two things a tick-at-a-time watch reads — whether
 * the event has happened, and what sounded — except that a sound is attributed to
 * the STEP it landed in rather than to its own tick. So a step that sounded before
 * the event is still a violation, a step in which the event arrived and nothing
 * sounded is still a violation, and only one distinction is lost: a build that
 * sounded inside the same fifteenth of a second as its event but not on the event's
 * own tick reads as conforming. `specs/progression.md` asks that the seven cues be
 * told apart by ear, and a fifteenth of a second is not a difference any ear or
 * any clause in that file draws.
 *
 * WHERE THE LEAD STOPS. A watch that names a `lead.until` — `audio/flare` names
 * the charge-up that `specs/predators/flarefish.md` puts in front of every bloom —
 * steps one tick at a time from there, so the near miss the point is actually
 * about is decided at the tick's own grain and the lead only covers the wait.
 */
export const LEAD_POLL = 8;

/** What one driven step sounded. */
export interface TickCues {
  /** Which tick of this watch the step ENDED on, from `1`. */
  step: number;
  /** How many ticks the step covered: one, except over a {@link LEAD_POLL} lead. */
  ticks: number;
  /** How many sounds the build emitted over them. */
  sounds: number;
}

/** What a watch saw. */
export interface CueWatch {
  /** The event was reached inside the budget. */
  hit: boolean;
  /** The tick of the watch the event was first seen on, or `-1`. */
  at: number;
  /** The tick `mark` was first seen on, or `-1` where none was asked for. */
  marked: number;
  /** One record per tick driven, in order. */
  ticks: TickCues[];
  /** The state the watch ended on. */
  snapshot: FathomSnapshot;
}

/** How a watch is staged around the event it is about. */
export interface WatchOptions {
  /**
   * Ticks driven before {@link WatchOptions.arm} is called.
   *
   * For an event that lands on the first tick it possibly can — a key read once
   * per press, a hunter already standing on the forager — the ticks before it
   * would otherwise be none at all, and "nothing sounded before the event" would
   * be a reading of an empty window. A lead gives that reading something to be
   * quiet across, driven on exactly the same board the event is then staged on.
   */
  quietLead?: number;
  /** The gesture that stages the event, run after the quiet lead. */
  arm?: () => void | Promise<void>;
  /** A second reading, whose first tick is reported as `marked`. */
  mark?: (snapshot: FathomSnapshot) => boolean;
  /**
   * How the stretch before the event is covered, for an event that is seconds of
   * the build's own cadence away rather than one press off. See {@link LEAD_POLL}.
   *
   * `until` is where the tick-at-a-time watch takes over; a lead without one runs
   * at its own grain for the whole window.
   */
  lead?: {
    poll: number;
    until?: (snapshot: FathomSnapshot) => boolean;
  };
}

/**
 * Watch until `event` holds, keeping what sounded on each step, and stop there.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each step, so the step a check
 * calls the event's is the step during which the build's own code produced it —
 * and at the tick-at-a-time grain, which is every step of every watch without a
 * {@link WatchOptions.lead}, that is the tick `specs/progression.md` requires the
 * cue on.
 *
 * ONE CROSSING PER {@link CHUNK_TICKS}, NOT PER TICK. The steps are stepped on the
 * page's side of the line, a chunk at a time, and the series comes back in one
 * crossing. A watch therefore stops at the end of the chunk its event landed in
 * rather than on the event's own step, so the run can stand a chunk short of a
 * tenth of a second past it. Nothing a check reads moves — the step the event
 * landed on, the sounds on it, the sounds before it and the state it left are all
 * read out of the chunk exactly as a step-at-a-time loop read them — and every
 * scenario in this directory is held still around its event, so the ticks past it
 * carry nothing.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: FathomSnapshot) => boolean,
  maxTicks: number,
  options: WatchOptions = {},
): Promise<CueWatch> {
  const { quietLead = 0, arm, mark, lead } = options;
  const ticks: TickCues[] = [];
  // The harness's tick counter as this watch opened: what makes `step` a count of
  // this watch's own ticks rather than of everything the check drove before it.
  const startedAt = h.tick();
  let taken = 0;
  let marked = -1;
  let last: FathomSnapshot | null = null;

  /**
   * Step one chunk in `poll`-tick steps, and report where the event first held.
   *
   * `watching` is false only over a {@link WatchOptions.quietLead}, where the
   * event has not been staged yet and there is nothing to look for.
   */
  const chunk = async (
    length: number,
    poll: number,
    watching: boolean,
  ): Promise<CueWatch | null> => {
    for (const reading of await h.scan(length, poll)) {
      const covered = reading.tick - startedAt - taken;
      taken = reading.tick - startedAt;
      ticks.push({ step: taken, ticks: covered, sounds: reading.sounds });
      last = reading.snapshot;
      if (marked < 0 && mark?.(reading.snapshot) === true) marked = taken;
      if (watching && event(reading.snapshot)) {
        return {
          hit: true,
          at: taken,
          marked,
          ticks,
          snapshot: reading.snapshot,
        };
      }
    }
    return null;
  };

  // The quiet lead, at the tick's own grain: it exists so that "nothing sounded
  // before the event" is a reading of something, and it is short by construction.
  const opening = Math.min(arm === undefined ? 0 : quietLead, maxTicks);
  if (opening > 0) {
    const seen = await chunk(opening, 1, false);
    if (seen !== null) return seen;
  }
  await arm?.();

  // The lead: `lead.poll` ticks a step, for as long as the event is a long way
  // off. A lead that names no `until` runs the whole window at that grain.
  let done = opening;
  if (lead !== undefined) {
    const poll = Math.max(1, lead.poll);
    while (done < maxTicks) {
      const length = Math.min(CHUNK_TICKS * poll, maxTicks - done);
      const seen = await chunk(length, poll, true);
      if (seen !== null) return seen;
      done += length;
      if (lead.until !== undefined && last !== null && lead.until(last)) break;
    }
  }

  // The event's own neighbourhood, one tick at a time.
  for (; done < maxTicks; done += CHUNK_TICKS) {
    const seen = await chunk(Math.min(CHUNK_TICKS, maxTicks - done), 1, true);
    if (seen !== null) return seen;
  }
  return {
    hit: false,
    at: -1,
    marked,
    ticks,
    snapshot: last ?? (await h.snapshot()),
  };
}

/** How many sounds the build emitted on the event's own tick. */
export function soundsOnEvent(watch: CueWatch): number {
  return watch.ticks.find((one) => one.step === watch.at)?.sounds ?? 0;
}

/** How many sounds it emitted on one numbered tick of the watch. */
export function soundsOnTick(watch: CueWatch, step: number): number {
  return watch.ticks.find((one) => one.step === step)?.sounds ?? 0;
}

/** How many sounds it emitted on the ticks strictly between two of them. */
export function soundsBetween(
  watch: CueWatch,
  after: number,
  before: number,
): number {
  return watch.ticks
    .filter((one) => one.step > after && one.step < before)
    .reduce((total, one) => total + one.sounds, 0);
}

/** How many sounds it emitted on any tick before the event's. */
export function soundsBeforeEvent(watch: CueWatch): number {
  return watch.ticks
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce((total, one) => total + one.sounds, 0);
}
