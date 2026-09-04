// instrumentation/surface-operations-present — every operation the specification
// names is there, as a function.
//
// specs/instrumentation.md § The operations: "You implement it. Every operation
// this file specifies is a deliverable, and the build installs the finished
// surface on `window.__gantry` as soon as the game has initialized... it is
// present and exactly as specified here."
//
// The list is the whole of what that file names FOR THIS BUILD, in the order it
// introduces them: the clock, the readings, the projection, the run and screen
// poses, the structure poses, the tape poses, the site poses, the run-in-progress
// poses, and the input operations. The last three families of that list — the
// clock, `project`, and the five input operations — belong to this engine alone:
// "The keyboard, the pointer, the clock, and the overlay all belong to the
// runtime layer beneath the game, and nothing outside this build owns any of
// them", so on an engine build the engine carries them and the surface is not
// asked for them. Here nothing else can, so they are on the list.
//
// The reading is a reflection over the object itself rather than a call of each
// operation: what this point decides is that the surface CARRIES them, and an
// operation that is present and wrong is what every other validator in this suite
// is for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HANDLE, REQUIRED_OPS, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every operation specs/instrumentation.md names, each a function", async () => {
  await h.debug.openSite(0);

  const found = await h.page.evaluate(
    ([handle, wanted]) => {
      const surface = (window as unknown as Record<string, unknown>)[handle] as
        | Record<string, unknown>
        | undefined;
      const kinds: Record<string, string> = {};
      for (const name of wanted) {
        kinds[name] = surface === undefined ? "no surface" : typeof surface[name];
      }
      return kinds;
    },
    [HANDLE, [...REQUIRED_OPS]] as const,
  );

  const missing = REQUIRED_OPS.filter((name) => found[name] !== "function");
  if (missing.length > 0) {
    fail(
      `every one of the ${REQUIRED_OPS.length} operations ` +
        "specs/instrumentation.md names for this build to be present on " +
        `window.${HANDLE} as a function`,
      missing
        .map((name) => `${name} is ${found[name] ?? "absent"}`)
        .join(", "),
    );
  }

  // Named one by one as well, so a grade reads as a list rather than as one
  // sentence about a list.
  for (const name of REQUIRED_OPS) {
    assertEqual(found[name], "function", `window.${HANDLE}.${name}`);
  }

  await h.advance(1);
  await h.capture(
    "surface-operations",
    "The build carrying the whole documented surface",
  );
});
