// audio/event-sweep — drive a posed scene tick by tick until its one event
// shows in the snapshot, tallying one cue's plays on the way.
// CASE-PROVIDED.
//
// An "on the tick, and on no tick before it" item needs two tallies: how many
// times the cue had played over the quiet approach, and how many by the end of
// the tick the event resolved on. The sweep advances one tick per sample so
// the event tick is pinned by the snapshot change that defines the event — a
// screen entered, a life spent — rather than by re-deriving another category's
// contact arithmetic here.

import { cuesNamed, type Harness, type TimedCue } from "../harness";
import type { KesslerSnapshot } from "../surface";

/** One swept drive up to and through a single event tick. */
export interface EventSweep {
  /** Whether the event showed within the budget. */
  hit: boolean;
  /** The cue's plays over every tick before the event tick. */
  playsBeforeEventTick: number;
  /** The cue's plays through the end of the event tick itself. */
  playsThroughEventTick: number;
  /** The snapshot after the tick that hit, or after the last budgeted tick. */
  snapshot: KesslerSnapshot;
}

/**
 * Run whole ticks until `arrived` reads true off the snapshot, at most
 * `maxTicks` of them, reading `cue`'s tally from `cues` just before and just
 * after the tick that hit. `cues` is the live sink an `onCue` opened before
 * the drive.
 */
export async function sweepToEvent(
  h: Harness,
  cues: readonly TimedCue[],
  cue: string,
  arrived: (s: KesslerSnapshot) => boolean,
  maxTicks: number,
): Promise<EventSweep> {
  let before = 0;
  let snapshot = await h.tick(1);
  for (let tick = 1; ; tick += 1) {
    if (arrived(snapshot)) {
      return {
        hit: true,
        playsBeforeEventTick: before,
        playsThroughEventTick: cuesNamed(cues, cue).length,
        snapshot,
      };
    }
    if (tick >= maxTicks) break;
    before = cuesNamed(cues, cue).length;
    snapshot = await h.tick(1);
  }
  const tally = cuesNamed(cues, cue).length;
  return {
    hit: false,
    playsBeforeEventTick: tally,
    playsThroughEventTick: tally,
    snapshot,
  };
}
