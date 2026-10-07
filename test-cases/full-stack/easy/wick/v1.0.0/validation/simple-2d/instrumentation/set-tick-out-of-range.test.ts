// instrumentation/set-tick-out-of-range — setTick refuses a tick outside 0 to
// 35999, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument."
// `setTick(tick)`: the domain is "`0` to ... `35999`", so `DAWN_TICK`
// (`36000`) is one past the top and `-1` one below the bottom. The two share
// one point because they are the same bound met from either side.
//
// The comparison across the refused call is exact equality of the state a pose
// governs. Every other refusal the specification states is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is kept as the one
// held weapon, so slot 3 is empty and slot 0 is held, and no passive is held;
// the argument is the nearest figure outside its domain, so a build that clamps
// lands on a valid value and changes the state, which is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { DAWN_TICK } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses setTick(36000) and setTick(-1) and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(() => debug.setTick(DAWN_TICK), "setTick(36000)");
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setTick(36000) was refused",
  );
  assertThrows(() => debug.setTick(-1), "setTick(-1)");
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setTick(-1) was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
