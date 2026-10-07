// Wick — how a timer counts (specs/world.md "Timers").
//
// Every timer is in seconds. On a tick it counts down by `TICK_DT` and is held
// at `0`: a count-down that would leave it below `TICK_DT / 2` leaves it at
// exactly `0`. A timer is due on every tick on which it is `0` after its
// count-down, so a timer set to `s` is due `round(s × TICK_HZ)` ticks after the
// tick it was set on, and a timer at `0` stays due until it is set again.

import { TICK_DT, TICK_HZ } from "../constants";

/** One tick of a timer's count-down. */
export function countDown(seconds: number): number {
  const next = seconds - TICK_DT;
  return next < TICK_DT / 2 ? 0 : next;
}

/** Whether a timer that has counted down this tick is due. */
export function isDue(seconds: number): boolean {
  return seconds === 0;
}

/** The whole number of ticks an interval of `seconds` covers. */
export function intervalTicks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}
