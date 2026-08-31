// effects/timers-fall-one-per-tick — a timed effect's whole-tick timer starts
// at its duration and falls by one on every tick the simulation advances,
// read back in effects.widenTicks, narrowTicks, and pierceTicks.
//
// specs/pods.md: "each runs a whole-tick timer that starts at its duration
// and counts down by one on every tick the simulation advances". The posed
// countdowns are exact because specs/instrumentation.md fixes setEffectTicks
// as leaving "the timer at exactly `ticks`", and specs/field.md's tick order
// runs "every running effect timer falls by one tick" as step 3 of every
// tick. The catch-start reading is exact for the same reason: timers fall at
// step 3 and a catch applies its effect at step 4, so the catch tick ends at
// the kind's full duration — 600, 600, and 360 for widen, narrow, and pierce,
// so a duration one tick short reads one short on the catch tick.
//
// THE WORLD IS THE TIMER AND NOTHING ELSE. The field is emptied, so no
// contact can end an effect early, and only the posed kind's timer runs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  NARROW_DURATION,
  open,
  PIERCE_DURATION,
  record,
  setEffect,
  snap,
  ticks,
  world,
  type Harness,
  type KesslerSnapshot,
  type TimedKind,
  WIDEN_DURATION,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

/** Pose `kind` at 120 ticks and read the fall across one tick, then nine. */
async function countdown(
  kind: TimedKind,
  read: (effects: KesslerSnapshot["effects"]) => number,
  captured: boolean,
) {
  await world(h);
  await setEffect(h, kind, 120);
  assertEqual(read((await snap(h)).effects), 120, "the posed timer, exactly");

  const one = captured
    ? await record(h, "timer-countdown", () => ticks(h, 1))
    : await ticks(h, 1);
  assertEqual(read(one.effects), 119, "one tick, one fall");

  const ten = await ticks(h, 9);
  assertEqual(read(ten.effects), 110, "nine more ticks, nine more falls");
}

it("widenTicks falls by one on every tick", async () => {
  await countdown("widen", (e) => e.widenTicks, true);
});

it("narrowTicks falls by one on every tick", async () => {
  await countdown("narrow", (e) => e.narrowTicks, false);
});

it("pierceTicks falls by one on every tick", async () => {
  await countdown("pierce", (e) => e.pierceTicks, false);
});

/** Each timed kind's duration (specs/pods.md), and where the snapshot reads its timer. */
const TIMED: readonly {
  kind: TimedKind;
  duration: number;
  read: (effects: KesslerSnapshot["effects"]) => number;
}[] = [
  { kind: "widen", duration: WIDEN_DURATION, read: (e) => e.widenTicks },
  { kind: "narrow", duration: NARROW_DURATION, read: (e) => e.narrowTicks },
  { kind: "pierce", duration: PIERCE_DURATION, read: (e) => e.pierceTicks },
];

it("a catch starts the timer at the kind's duration", async () => {
  for (const { kind, duration, read } of TIMED) {
    await world(h);
    const after = await dropPod(h, kind);
    assertLength(after.pods, 0, `the ${kind} pod after the catch tick`);
    assertEqual(
      read(after.effects),
      duration,
      `the ${kind} timer on the catch tick: the full ${duration} (timers fall at step 3, the catch applies at step 4)`,
    );
  }
});
