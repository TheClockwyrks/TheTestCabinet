// Wick — instrumentation/spawn-gem-unknown-tier: spawnGem refuses a tier that
// is no GemTier, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// operations": "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant; no
// operation rounds, clamps, or otherwise normalizes an argument."
// `spawnGem(tier, x, y)`: `tier` is "a `GemTier`", and `"huge"` is none of
// them.
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
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type WickDebugApi,
} from "../harness";

/** The surface with its argument types loosened, so the call can be spelled. */
type Loose = { [K in keyof WickDebugApi]: (...args: never[]) => unknown };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("refuses spawnGem('huge', 0, 0) and changes nothing", async () => {
  const before = isolate(h, { taper: true });
  const d = h.debug as unknown as Loose;

  assertThrows(
    () => d.spawnGem("huge" as never, 0 as never, 0 as never),
    "spawnGem('huge', 0, 0)",
  );

  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(after, before, "the snapshot after the refused call");
});
