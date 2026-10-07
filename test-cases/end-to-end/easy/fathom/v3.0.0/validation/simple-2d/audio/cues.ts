// Fathom — watching the cue bus tick by tick, for the `audio/*` points.
// CASE-PROVIDED.
//
// `specs/progression.md` fixes seven cues, one per event, and one sentence
// governs all seven of these points: "Each is played on the tick its event
// happens, and at most once on that tick." So every audio check is the same
// measurement in a different scenario — stage the event, step ONE FRAME AT A TIME
// so a play can be attributed to the tick that produced it, and read the cue
// against the event's own tick and against the ticks before it.
//
// ONE TICK AT A TIME IS THE WHOLE POINT. The runtime announces a play
// synchronously, inside the call, but it stamps the play with its own audio clock
// rather than with a tick, so nothing in a batched advance says WHEN inside it a
// cue sounded. A check that read only "the cue happened somewhere in this window"
// would pass a build that plays it every tick as readily as one that plays it on
// the bite. Bracketing each single frame is what turns the announcement into a
// tick.
//
// WHAT THE ENGINE GIVES THAT AN ENGINELESS BUILD CANNOT. The NAME. The game asks
// the runtime's cue bus for a cue by name and the bus announces the play, so
// these checks assert the exact name `specs/progression.md` fixes and assert that
// it sounded exactly ONCE on its tick. A play is announced whether or not the
// audio is unlocked and whether or not the game is muted, so nothing here has to
// arm anything.

import { Harness } from "../harness";
import { FathomSnapshot } from "../surface";

/** What one driven frame played. */
export interface TickCues {
  /** Which tick of this watch it was, from `1`. */
  step: number;
  /** The cues the build played on it, by name, in order. */
  played: string[];
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
 * Step one frame at a time until `event` holds, keeping what played on each tick.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each frame, so the tick a check
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
  const ticks: TickCues[] = [];
  let marked = -1;
  let armed = arm === undefined;

  for (let step = 1; step <= maxTicks; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
    }
    const read = h.cues.length;
    await h.advance(1);
    ticks.push({ step, played: h.cues.slice(read).map((one) => one.cue) });

    const snapshot = h.snapshot();
    if (marked < 0 && mark?.(snapshot) === true) marked = step;
    if (armed && event(snapshot)) {
      return { hit: true, at: step, marked, ticks, snapshot };
    }
  }
  return { hit: false, at: -1, marked, ticks, snapshot: h.snapshot() };
}

/** How many times `cue` played on the event's own tick. */
export function cuesOnEvent(watch: CueWatch, cue: string): number {
  const on = watch.ticks.find((one) => one.step === watch.at);
  return on === undefined ? 0 : on.played.filter((name) => name === cue).length;
}

/** How many times `cue` played on any tick before the event's. */
export function cuesBeforeEvent(watch: CueWatch, cue: string): number {
  return watch.ticks
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce(
      (total, one) => total + one.played.filter((name) => name === cue).length,
      0,
    );
}
