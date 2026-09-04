// instrumentation/surface-version-field — the surface says which contract it
// implements.
//
// specs/instrumentation.md § The operations, first sentence: "The surface carries
// `version` (`GANTRY_DEBUG_VERSION`, `1`), a plain number, and the operations
// below."
//
// It is read off the SURFACE rather than off the snapshot. The snapshot carries a
// `version` of its own and the Snapshot shape block fixes it too, but the sentence
// above is about the object the operations hang on, which is the thing a caller
// meets first and the thing that says what the rest of the object is.
//
// THIS ENGINE'S VERSION OF THE POINT, and only in where that object is found.
// specs/instrumentation.md: "the build's `initialize` returns the finished
// surface beside the state it built, as the pair `[state, debug]`. The engine
// returns that same value from `engine.debug`, and it is reached that way alone:
// nothing is installed on the page." So the field is read off `engine.debug`,
// where an engineless build's is read off `window.__gantry`. `h.probe` reflects
// the raw surface without invoking it, which is what this point asks for: the
// field is a value the object carries, not an operation to call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GANTRY_DEBUG_VERSION } from "../constants";
import { createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries version as the plain number GANTRY_DEBUG_VERSION", async () => {
  const { version } = h.probe([]);

  await h.advance(1);
  await h.capture("surface-version", "The build the surface version was read from");

  assertEqual(typeof version, "number", "the type of engine.debug.version");
  assertEqual(
    version,
    GANTRY_DEBUG_VERSION,
    "engine.debug.version (specs/instrumentation.md)",
  );
});
