// instrumentation/set-screen-unknown-name — setScreen refuses a name that is
// no Screen, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument."
// `setScreen(name)`: "Sets `screen` to `name`, one of the `Screen`
// values", so a name that is no `Screen` is outside the domain.
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
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses setScreen('nowhere') and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(() => debug.setScreen("nowhere"), "setScreen('nowhere')");
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setScreen('nowhere') was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
