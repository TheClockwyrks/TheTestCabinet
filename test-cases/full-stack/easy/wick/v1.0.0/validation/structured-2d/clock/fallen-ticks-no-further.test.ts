// Wick — clock/fallen-ticks-no-further: a run ended by falling ticks no further.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Fallen and dawn"): "A run ends at the end of a tick,
//     after every other phase of that tick has been applied ... A run that has
//     ended ticks no further."
//   - `specs/state.md` ("The idle run"): "The `fallen` and `dawn` screens
//     keep the run that just ended, since they report its time, level, and
//     kills."
//   - `specs/instrumentation.md` (`setHp`): "A value at or below `0` ends the
//     run fallen at the end of the next `playing` tick"; and (`setTick`): the
//     clock is posed to any tick up to `DAWN_TIME × TICK_HZ − 1`, so one tick
//     from the last one is the tick "the clock reaches `DAWN_TIME`" on
//     (`specs/overview.md`).
//
// THE DRIVE. Twice, from an isolated run, the live world of `live-world.ts`
// is posed with every switch on: a moth chasing, a bolt flying, a puddle and
// the bolt with `ttl` counting, a contact cooldown, Ember's cooldown, and the
// director's timer all counting. The first time `hp` is posed to `0` and the
// one tick that ends the run fallen runs; the second time the clock is posed
// to the last tick and the one tick that brings dawn runs. Sixty frames then
// run on each end screen, and the `run` after them must be the `run` the
// ending tick left, field for field: a build that keeps ticking after the end
// moves the moth, flies the bolt, counts a timer, or raises the clock, and
// any of those changes the run the end screen reports.
//
// TOLERANCE. None: "ticks no further" is a structural equality on the run,
// and sixty frames of the harness's clock is the span the review item names.
//
// The other ending is `clock/dawn-ticks-no-further`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  endFallen,
  isolate,
  type Harness,
} from "../harness";
import { poseLiveWorld } from "./live-world";

/** Frames run on the end screen: a second of the clock. */
const ENDED_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the ended run exactly where the ending tick left it on fallen", async () => {
  isolate(h);
  poseLiveWorld(h);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the ending tick left");
  const held = await advanceTicks(h, ENDED_FRAMES);
  captureStill(h, "ended");

  assertEqual(held.screen, "fallen", "the screen after sixty frames on fallen");
  assertDeepEqual(
    held.run,
    ended.run,
    "the run after sixty frames on fallen, against the run the ending tick left",
  );
});
