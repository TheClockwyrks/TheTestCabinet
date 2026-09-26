// Wick — instrumentation/set-gem-attracted-unknown-id: setGemAttracted refuses
// an id that names no gem, throws, and leaves the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant; no
// operation rounds, clamps, or otherwise normalizes an argument."
// `setGemAttracted(id, attracted)`: "an `id` that names no gem is invalid",
// and the id read here is above every id the run has handed out.
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

it("refuses setGemAttracted on an id naming no gem and changes nothing", async () => {
  const before = await isolate(h, { taper: true });
  const api = h.debug as unknown as LooseSurface;

  await assertRejects(
    () => api.setGemAttracted(before.run.nextId + 1000, true),
    "setGemAttracted on an id naming no gem",
  );
  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    "the state across the refused setGemAttracted on an id naming no gem",
  );

  await captureStill(h, "refused");
});
