// effects/catch-starts-timer-at-duration — a catch starts the caught kind's
// timer at exactly the duration its row states.
//
// specs/pods.md: each timed effect "runs a whole-tick timer that starts at its
// duration", and the durations are the table's — `600` ticks for `widen`, `600`
// for `narrow`, `360` for `pierce`.
//
// THE CATCH TICK'S OWN COUNT IS EXACT, not approximate: specs/field.md's tick
// order falls the timers at step 3 and resolves the catch at step 4, so the tick
// the catch lands on ends at the kind's FULL duration, and a duration one tick
// short reads one short here. The three kinds share this validator because each
// exercises the same requirement the same way, off the same catch.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR, so the catch is the only event of the
// tick. That the timer then FALLS one per tick is each kind's own countdown
// point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  NARROW_DURATION,
  open,
  PIERCE_DURATION,
  record,
  world,
  WIDEN_DURATION,
  type Harness,
  type KesslerSnapshot,
  type TimedKind,
} from "./pose";

/** Each timed kind's duration (specs/pods.md), and where its timer is read. */
const TIMED: readonly {
  kind: TimedKind;
  duration: number;
  read: (effects: KesslerSnapshot["effects"]) => number;
}[] = [
  { kind: "widen", duration: WIDEN_DURATION, read: (e) => e.widenTicks },
  { kind: "narrow", duration: NARROW_DURATION, read: (e) => e.narrowTicks },
  { kind: "pierce", duration: PIERCE_DURATION, read: (e) => e.pierceTicks },
];

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("arms each kind's timer at its full duration on the catch tick", async () => {
  for (const [i, { kind, duration, read }] of TIMED.entries()) {
    await world(h);
    const after =
      i === 0
        ? await record(h, "armed", () => dropPod(h, kind))
        : await dropPod(h, kind);
    assertLength(after.pods, 0, `the ${kind} pod after the catch tick`);
    assertEqual(
      read(after.effects),
      duration,
      `the ${kind} timer on the catch tick: the full ${duration} ` +
        `(timers fall at step 3, the catch applies at step 4)`,
    );
  }
});
