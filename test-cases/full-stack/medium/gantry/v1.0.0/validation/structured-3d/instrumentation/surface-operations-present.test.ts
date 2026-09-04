// instrumentation/surface-operations-present — every operation the specification
// names is there, as a function.
//
// specs/instrumentation.md § The operations: "You implement it. Every operation
// this file specifies is a deliverable" — and on an engine build the finished
// surface is the value the game instance's `initialize` returns, which "the
// engine holds ... and returns ... from `engine.debug`".
//
// THE LIST IS WHAT THAT FILE NAMES FOR THIS BUILD. Under an engine the clock, the
// keyboard, the pointer, the camera's projection and the overlay "belong to the
// {engine} engine ... and the surface carries no operation for any of them", so
// `setAutoStep`, `advance`, `project` and the five input operations are NOT on
// this list — the engine carries them and a check reaches them through the
// harness. What remains is the readings, the run and screen poses, the structure
// poses, the tape poses, the site poses and the run-in-progress poses, which is
// what `REQUIRED_OPS` enumerates.
//
// The reading is a reflection over the object itself rather than a call of each
// operation: what this point decides is that the surface CARRIES them, and an
// operation that is present and wrong is what every other validator in this suite
// is for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  REQUIRED_OPS,
  createHarness,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every operation specs/instrumentation.md names, each a function", async () => {
  await openSite(h, 0);

  const { ops } = h.probe(REQUIRED_OPS);

  const missing = REQUIRED_OPS.filter((name) => ops[name] !== "function");
  await h.advance(1);
  await h.capture(
    "surface-operations",
    "The build carrying the whole documented surface",
  );

  if (missing.length > 0) {
    fail(
      `every one of the ${REQUIRED_OPS.length} operations ` +
        "specs/instrumentation.md names for this build to be present on " +
        "engine.debug as a function",
      missing.map((name) => `${name} is ${ops[name] ?? "absent"}`).join(", "),
    );
  }

  // Named one by one as well, so a grade reads as a list rather than as one
  // sentence about a list.
  for (const name of REQUIRED_OPS) {
    assertEqual(ops[name], "function", `engine.debug.${name}`);
  }
});
