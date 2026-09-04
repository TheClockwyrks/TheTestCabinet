// instrumentation/surface-operations-present — every operation the specification
// names is there, as a function.
//
// specs/instrumentation.md § The operations: "You implement it. Every operation
// this file specifies is a deliverable, and the build's `initialize` returns the
// finished surface beside the state it built, as the pair `[state, debug]`... it
// is present and exactly as specified here."
//
// The list is the whole of what that file names FOR THIS BUILD, in the order it
// introduces them: the readings, the run and screen poses, the structure poses,
// the tape poses, the site poses, and the run-in-progress poses. It is SHORTER
// than an engineless build's by eight, and the eight are the ones that file puts
// on the surface for `none` alone: "The clock, the keyboard, the pointer, the
// camera's projection, and the overlay belong to the Simple 3D engine... and the
// surface carries no operation for any of them." A build that installed them
// anyway is not failed for it — this point is about what the specification names
// as owed, and nothing here looks for anything else.
//
// THIS ENGINE'S VERSION OF THE POINT, and only in where the surface is found and
// what the list holds. `engine.debug` is the whole of the contract here —
// "nothing is installed on the page" — so the reflection is over the object the
// engine handed back.
//
// The reading is a reflection over the object itself rather than a call of each
// operation: what this point decides is that the surface CARRIES them, and an
// operation that is present and wrong is what every other validator in this suite
// is for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { REQUIRED_OPS, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every operation specs/instrumentation.md names, each a function", async () => {
  await openSite(h, 0);

  const { ops: found } = h.probe(REQUIRED_OPS);

  const missing = REQUIRED_OPS.filter((name) => found[name] !== "function");
  if (missing.length > 0) {
    fail(
      `every one of the ${REQUIRED_OPS.length} operations ` +
        "specs/instrumentation.md names for this build to be present on " +
        "engine.debug as a function",
      missing
        .map((name) => `${name} is ${found[name] ?? "absent"}`)
        .join(", "),
    );
  }

  // Named one by one as well, so a grade reads as a list rather than as one
  // sentence about a list.
  for (const name of REQUIRED_OPS) {
    assertEqual(found[name], "function", `engine.debug.${name}`);
  }

  await h.advance(1);
  await h.capture(
    "surface-operations",
    "The build carrying the whole documented surface",
  );
});
