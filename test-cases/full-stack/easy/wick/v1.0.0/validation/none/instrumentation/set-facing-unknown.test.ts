// Wick — instrumentation/set-facing-unknown: setFacing refuses a facing that
// is neither left nor right, throws, and leaves the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant; no
// operation rounds, clamps, or otherwise normalizes an argument."
// `setFacing(facing)`: the domain is "`\"left\"` or `\"right\"`", so
// `"up"` is outside it.
//
// The comparison across the refused call is exact equality of the state a pose
// governs. Every other refusal the specification states is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is kept as the one
// held weapon, so slot 3 is empty and slot 0 is held, and no passive is held;
// the argument is the nearest figure outside its domain, so a build that clamps
// lands on a valid value and changes the state, which is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  posedState,
  type Harness,
} from "../harness";

/** The surface with its argument types loosened, for a call outside the domain. */
type LooseSurface = Record<string, (...args: unknown[]) => Promise<unknown>>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses setFacing('up') and changes nothing", async () => {
  const before = await isolate(h, { taper: true });
  const api = h.debug as unknown as LooseSurface;

  await assertRejects(() => api.setFacing("up"), "setFacing('up')");
  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    "the state across the refused setFacing('up')",
  );

  await captureStill(h, "refused");
});
