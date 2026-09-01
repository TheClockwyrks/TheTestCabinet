// Wick — instrumentation/reset-restores-switches: with all seven driver
// switches posed off, `reset()` leaves every one of them `true`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "each is restored to on by `reset`"; and `reset(options)`:
// "Restores every declared field ... and every driver switch on". The seven
// names are the table's, "reported by the snapshot under the same name".
//
// WHY THE WORLD IS POSED AS IT IS. Every switch is first turned off, and the
// snapshot confirms it, so the read after the reset is of the reset's own work
// and not of switches that were never off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SWITCH_NAMES } from "../constants";
import {
  captureStill,
  createHarness,
  holdAll,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns every driver switch back on", async () => {
  await startRun(h);
  await holdAll(h);
  const held = await h.snapshot();
  for (const name of SWITCH_NAMES) {
    assertEqual(held[name], false, `the ${name} switch posed off`);
  }

  await h.debug.reset();
  const restored = await h.snapshot();
  await captureStill(h, "switches");
  for (const name of SWITCH_NAMES) {
    assertEqual(restored[name], true, `the ${name} switch after reset`);
  }
});
