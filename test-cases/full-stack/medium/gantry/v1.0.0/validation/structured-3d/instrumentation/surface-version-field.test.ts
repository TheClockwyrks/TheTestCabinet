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
// WHERE THAT OBJECT IS, ON THIS BUILD. specs/instrumentation.md puts it on the
// value the game instance's `initialize` returns: "The engine holds it and
// returns it from `engine.debug`, and it is reached that way alone: nothing is
// installed on the page." So the field is read off the object the engine handed
// back, by reflection rather than by a call — `h.probe` reports the `version` the
// surface carries without invoking anything on it.

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
  await h.capture(
    "surface-version",
    "The build the surface version was read from",
  );

  assertEqual(typeof version, "number", "the type of engine.debug.version");
  assertEqual(
    version,
    GANTRY_DEBUG_VERSION,
    "engine.debug.version (specs/instrumentation.md)",
  );
});
