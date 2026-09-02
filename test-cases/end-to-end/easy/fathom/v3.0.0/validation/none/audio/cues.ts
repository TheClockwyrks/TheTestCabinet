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
// ONLY `advance` ATTRIBUTES A SOUND TO A TICK (see {@link watchCues} in
// `harness.ts`), so every watch here advances and none of them skips.

import type { FathomSnapshot, Harness } from "../harness";
import { watchCues } from "../harness";

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

/** What one driven tick sounded. */
export interface TickCues {
  /** Which tick of this watch it was, from `1`. */
  step: number;
  /** How many sounds the build emitted on it. */
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
}

/**
 * Step one tick at a time until `event` holds, keeping what sounded on each tick.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each tick, so the tick a check
 * calls the event's is the tick during which the build's own code produced it —
 * which is the tick `specs/progression.md` requires the cue on.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: FathomSnapshot) => boolean,
  maxTicks: number,
  options: WatchOptions = {},
): Promise<CueWatch> {
  const { quietLead = 0, arm, mark } = options;
  // A sink attached for the whole check, before a tick runs. The counts below are
  // read straight off the readings rather than out of it, but a harness with a
  // sink on it steps EVERY drive one tick at a time (see the harness's own
  // `strideFor`), which is what keeps the tail a capture films after the watch as
  // fine-grained as the watch itself.
  watchCues(h);
  const ticks: TickCues[] = [];
  let taken = 0;
  let marked = -1;
  let last: FathomSnapshot | null = null;

  /** Step one chunk, one tick at a time, and report where the event first held. */
  const chunk = async (
    length: number,
    watching: boolean,
  ): Promise<CueWatch | null> => {
    for (const reading of await h.scan(length, 1)) {
      taken += 1;
      ticks.push({ step: taken, sounds: reading.sounds });
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

  const lead = Math.min(arm === undefined ? 0 : quietLead, maxTicks);
  if (lead > 0) {
    const seen = await chunk(lead, false);
    if (seen !== null) return seen;
  }
  await arm?.();

  for (let done = lead; done < maxTicks; done += CHUNK_TICKS) {
    const seen = await chunk(Math.min(CHUNK_TICKS, maxTicks - done), true);
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
