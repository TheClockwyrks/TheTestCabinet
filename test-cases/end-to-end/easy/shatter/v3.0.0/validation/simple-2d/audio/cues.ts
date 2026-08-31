// Shatter — watching the engine's cue bus tick by tick, for the `audio/*` points.
//
// `specs/audio.md` fixes six cues, one per event, and one sentence governs all of
// them: "Each is played on the tick its event happens and at most once on that
// tick; a tick that raises more than one of them plays each of those once." So
// every cue check in this directory is the same measurement in a different
// scenario — pose the event, step ONE TICK AT A TIME so a cue can be attributed to
// the tick that produced it, and read the cue against the event's own tick and
// against the ticks before it.
//
// ONE TICK AT A TIME IS THE WHOLE POINT. The bus announces a play synchronously,
// inside the call, but it stamps the play with the frame loop's own clock rather
// than with a tick index, and a batched `advance(n)` says nothing about WHEN
// inside it a cue sounded. A check that read only "the cue happened somewhere in
// this window" would pass a build that plays it on every tick as readily as one
// that plays it on the event. Bracketing each single frame is what turns an
// announcement into a tick, and `advance(1)` under the harness's
// `ConstantClock(TICK_MS)` is exactly one simulation tick.
//
// THE CUE IS READ BY NAME, AND SO IS ITS GAIN. Under this engine the bus belongs
// to the runtime: the game asks for a cue BY NAME and the bus announces the play,
// so these checks assert the exact name `src/constants.ts`'s `CUES` fixes and
// assert that it sounded exactly ONCE on its tick — which is the "at most once on
// that tick" half of the requirement, and a half an engineless build's checks
// cannot reach at all. A play is announced whether or not the bus has been
// unlocked and whether or not it is muted, so nothing here has to arm audio; the
// announcement carries `gain`, which is `0` exactly when the bus is muted, and
// that is how `audio/mute-silences` reads a silenced cue.
//
// THE HELD CUE IS ANNOUNCED THROUGH THE OTHER TWO DOORS. `specs/audio.md` makes
// `thrust` a HELD sound rather than a struck one, and the bus expresses a held cue
// as `cue:looped` when it starts and `cue:stopped` when it ends. A build is
// entitled to hold the sound either way the bus allows — one loop across the burn,
// or the cue re-played while the burn lasts — so the two thrust points read
// {@link TickCues.looped} and {@link TickCues.played} together and never demand
// one convention. See {@link startsOf} and {@link Mark}.

import type { Harness, LoopedCue, PlayedCue } from "../harness";
import type { ShatterSnapshot } from "../surface";

/** What one driven tick announced on the cue bus. */
export interface TickCues {
  /** Which tick of this watch it was, from `1`. */
  step: number;
  /** Every cue played on it, in order, each with the gain it played at. */
  played: PlayedCue[];
  /** Every looping cue started on it, in order. */
  looped: LoopedCue[];
  /** Every looping cue stopped on it, in order. */
  stopped: LoopedCue[];
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
  ticks: TickCues[];
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
 * Step one tick at a time until `event` holds, keeping what each tick announced.
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
  const ticks: TickCues[] = [];
  let armed = arm === undefined;
  let armedAt = 0;

  for (let step = 1; step <= maxTicks; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
      armedAt = step - 1;
    }
    const mark = markOf(h);
    await h.advance(1);
    ticks.push({ step, ...sinceMark(h, mark) });

    const snapshot = h.snapshot();
    if (armed && event(snapshot)) {
      return { hit: true, at: step, armedAt, ticks, snapshot };
    }
  }
  return { hit: false, at: -1, armedAt, ticks, snapshot: h.snapshot() };
}

/* -------------------------------------------------------------------------- */
/* Reading a watch                                                            */
/* -------------------------------------------------------------------------- */

/** The ticks of `watch` that fall strictly before its event's own tick. */
function before(watch: CueWatch): TickCues[] {
  return watch.ticks.filter((one) => watch.at < 0 || one.step < watch.at);
}

/** The one tick the event landed on, or nothing where it never did. */
function on(watch: CueWatch): TickCues | undefined {
  return watch.ticks.find((one) => one.step === watch.at);
}

/** How many times `cue` was played on the event's own tick. */
export function playedOnEvent(watch: CueWatch, cue: string): number {
  return on(watch)?.played.filter((one) => one.cue === cue).length ?? 0;
}

/**
 * How many times `cue` was played on the ticks before the event's.
 *
 * A watch that never reached its event reports every tick it drove, so a build
 * that sounded when nothing happened is still named by the check that read it.
 */
export function playedBeforeEvent(watch: CueWatch, cue: string): number {
  return before(watch).reduce(
    (total, one) => total + one.played.filter((two) => two.cue === cue).length,
    0,
  );
}

/**
 * How many times `cue` STARTED SOUNDING on one tick: played, or started looping.
 *
 * The reading the two thrust points take, because `specs/audio.md` fixes the
 * thrust cue as held without fixing which of the bus's two doors holds it. A build
 * that loops it once across the burn and one that re-plays it while the burn lasts
 * both start the sound on the burn's first tick, and both are read here.
 */
export function startsOnEvent(watch: CueWatch, cue: string): number {
  const tick = on(watch);
  if (tick === undefined) return 0;
  return (
    tick.played.filter((one) => one.cue === cue).length +
    tick.looped.filter((one) => one.cue === cue).length
  );
}

/** How many times `cue` started sounding on the ticks before the event's. */
export function startsBeforeEvent(watch: CueWatch, cue: string): number {
  return before(watch).reduce(
    (total, one) =>
      total +
      one.played.filter((two) => two.cue === cue).length +
      one.looped.filter((two) => two.cue === cue).length,
    0,
  );
}

/** How many times `cue` was stopped on the event's tick or any tick after it. */
export function stopsFromEvent(watch: CueWatch, cue: string): number {
  return watch.ticks
    .filter((one) => watch.at >= 0 && one.step >= watch.at)
    .reduce(
      (total, one) =>
        total + one.stopped.filter((two) => two.cue === cue).length,
      0,
    );
}

/* -------------------------------------------------------------------------- */
/* Reading a stretch of ticks that is not a watch                             */
/* -------------------------------------------------------------------------- */
//
// The harness's `cues`, `loops` and `stops` are cumulative logs of the whole run.
// A check that drives a stretch WITHOUT needing it attributed tick by tick — a
// march through sixteen seconds of game time, a tail held after a release, the
// three events of a muted run — takes a mark before the stretch and reads what
// arrived after it.

/** Where the harness's three cue logs stood at one moment. */
export interface Mark {
  played: number;
  looped: number;
  stopped: number;
}

/** What arrived on the bus across one stretch of ticks. */
export interface Stretch {
  played: PlayedCue[];
  looped: LoopedCue[];
  stopped: LoopedCue[];
}

/** Where the harness's cue logs stand right now. */
export function markOf(h: Harness): Mark {
  return {
    played: h.cues.length,
    looped: h.loops.length,
    stopped: h.stops.length,
  };
}

/** Everything the bus announced since `mark`. */
export function sinceMark(h: Harness, mark: Mark): Stretch {
  return {
    played: h.cues.slice(mark.played),
    looped: h.loops.slice(mark.looped),
    stopped: h.stops.slice(mark.stopped),
  };
}

/** How many entries of `entries` name `cue`. */
export function countOf(
  entries: readonly { cue: string }[],
  cue: string,
): number {
  return entries.filter((one) => one.cue === cue).length;
}

/**
 * How many loops of `cue` are RUNNING: started and not since stopped.
 *
 * Read off the harness's whole-run logs rather than off a watch, because a loop
 * opened before a stretch began is still open inside it. The bus starts a loop at
 * most once — "a cue is either looping or not, so `loop` on a cue that is already
 * looping does nothing" — so the difference is `0` or `1` on any conforming
 * runtime, and a negative can never arise.
 */
export function loopsOpen(h: Harness, cue: string): number {
  return countOf(h.loops, cue) - countOf(h.stops, cue);
}
