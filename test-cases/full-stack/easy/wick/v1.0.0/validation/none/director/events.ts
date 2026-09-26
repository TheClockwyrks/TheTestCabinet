// director/events — carrying an isolated night across a scripted event's tick.
//
// WHERE THE DRIVE COMES FROM. specs/enemies.md ("Scripted events"): "`EVENTS`
// lists the night's scripted spawns in time order. Each fires once per run, on
// exactly the tick the run clock equals its time (`tick == time * TICK_HZ`,
// read after the tick's clock has risen), and only while `events` is on".
// "Exactly the tick" is two readings rather than one, so every crossing below
// runs the tick BEFORE the event as well: the clock is posed two ticks short,
// one tick carries the run onto the tick before the event, and the next carries
// it onto the event's own tick. A build that fires a tick early, or on every
// tick past the time, fails on the first of the two.
//
// WHY THE CLOCK IS POSED RATHER THAN RUN UP TO. `setTick(tick)` "Sets `tick` to
// `tick` ... Nothing else changes ... A scripted event fires only on its exact
// tick, so a clock posed past an event never fires it" (specs/instrumentation.md),
// so posing two ticks short of an event leaves every earlier event unfired and
// `firedEvents` empty. That is what makes the list this file reads a reading of
// the one event, and it is why a check here never marches the night.
//
// WHAT IS HELD. `events` alone, which every check in this family isolates on:
// the window timer's spawns would arrive on the same ticks and be
// indistinguishable from the event's, nothing may move before it is read, and
// nothing may be removed by distance.

import { assertEqual } from "../assert";
import { MAX_POSED_TICK } from "../constants";
import {
  isolate,
  newEnemies,
  type EnemyView,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** What one crossing of an event's tick saw. */
export interface Crossing {
  /** The state on the tick before the event's. */
  edge: WickSnapshot;
  /** The state on the event's own tick. */
  fired: WickSnapshot;
  /** The enemies the tick before the event spawned. */
  early: EnemyView[];
  /** The enemies the event's own tick spawned, in id order. */
  arrivals: EnemyView[];
}

/**
 * Pose the clock two ticks short of `tick` and step onto it, reading what each
 * of the two ticks spawned.
 *
 * The night is isolated with `events` alone, and the caller may pose the field
 * between {@link isolateForEvents} and this call.
 */
export async function carryAcross(h: Harness, tick: number): Promise<Crossing> {
  const from = tick - 2;
  assertEqual(
    from >= 0 && from <= MAX_POSED_TICK,
    true,
    `a clock two ticks short of ${tick} inside setTick's domain`,
  );
  await h.debug.setTick(from);
  const before = await h.snapshot();
  const edge = await h.step(1);
  const fired = await h.step(1);
  return {
    edge,
    fired,
    early: newEnemies(before, edge),
    arrivals: newEnemies(edge, fired),
  };
}

/** An isolated night with `events` alone, which every check in this family poses. */
export function isolateForEvents(h: Harness): Promise<WickSnapshot> {
  return isolate(h, { on: ["events"] });
}
