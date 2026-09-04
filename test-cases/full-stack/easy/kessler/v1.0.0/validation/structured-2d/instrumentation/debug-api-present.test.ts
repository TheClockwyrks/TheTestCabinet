// instrumentation/debug-api-present — the surface is installed, whole.
//
// specs/instrumentation.md: the build's `initialize` returns the finished
// surface beside the state it built, the engine hands it back from
// `engine.debug`, and "it is reached that way alone ... Every scenario driven
// from code reaches the game through it, so it is present and exactly as
// specified here." The operations it must carry are the ones the same file
// enumerates under "The operations".
//
// PRESENCE ALONE. That each operation then does what its own section states is
// the business of the per-operation points beside this one, and that the
// surface is LIVE rather than hollow belongs to `debug-api-live`. What fails
// here, by name, is a build that installed nothing or left an operation out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { rawSurface, REQUIRED_OPS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries every operation its mode names, as functions", () => {
  const raw = rawSurface(h);
  captureStill(h, "surface");
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof raw[op], "function", `the surface's ${op}`);
  }
});
