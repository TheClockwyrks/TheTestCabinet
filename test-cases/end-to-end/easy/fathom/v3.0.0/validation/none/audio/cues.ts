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
  const sink = watchCues(h);
  const ticks: TickCues[] = [];
  let read = 0;
  let marked = -1;
  let armed = arm === undefined;

  for (let step = 1; step <= maxTicks; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
    }
    await h.advance(1);
    const tick = h.tick();
    const sounds = sink.slice(read).filter((cue) => cue.tick === tick).length;
    read = sink.length;
    ticks.push({ step, sounds });

    const snapshot = await h.snapshot();
    if (marked < 0 && mark?.(snapshot) === true) marked = step;
    if (armed && event(snapshot)) {
      return { hit: true, at: step, marked, ticks, snapshot };
    }
  }
  return { hit: false, at: -1, marked, ticks, snapshot: await h.snapshot() };
}

/**
 * The roster index of the first predator of `kind`, or a stood-down check.
 *
 * `specs/predators.md` puts one of each kind in the den at depth `1` and
 * `specs/state.md` lists the roster in release order, so a roster missing a kind
 * is `scoring/depth-scaling`'s verdict rather than any cue point's.
 */
export function requireKind(
  h: Harness,
  snapshot: FathomSnapshot,
  kind: string,
): number {
  const index = snapshot.predators.findIndex((one) => one.kind === kind);
  if (index >= 0) return index;
  h.unmet(
    `the roster holds no ${kind}, so the scenario this cue needs could not be ` +
      "staged — the roster at each depth is scoring/depth-scaling's verdict, " +
      "not this one's",
  );
}

/** How many sounds the build emitted on the event's own tick. */
export function soundsOnEvent(watch: CueWatch): number {
  return watch.ticks.find((one) => one.step === watch.at)?.sounds ?? 0;
}

/** How many sounds it emitted on any tick before the event's. */
export function soundsBeforeEvent(watch: CueWatch): number {
  return watch.ticks
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce((total, one) => total + one.sounds, 0);
}
