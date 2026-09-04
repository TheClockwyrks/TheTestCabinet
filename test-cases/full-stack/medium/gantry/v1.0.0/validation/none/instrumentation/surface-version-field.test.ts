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
// meets first and the thing that says what the rest of the object is. On this
// build that object is `window.__gantry`, so the reading crosses into the page and
// reads the field there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GANTRY_DEBUG_VERSION, HANDLE, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries version as the plain number GANTRY_DEBUG_VERSION", async () => {
  const version = await h.page.evaluate((handle) => {
    const surface = (window as unknown as Record<string, unknown>)[handle] as
      | Record<string, unknown>
      | undefined;
    const held = surface?.version;
    return { kind: typeof held, value: held };
  }, HANDLE);

  assertEqual(version.kind, "number", `the type of window.${HANDLE}.version`);
  assertEqual(
    version.value,
    GANTRY_DEBUG_VERSION,
    `window.${HANDLE}.version (specs/instrumentation.md)`,
  );

  await h.advance(1);
  await h.capture("surface-version", "The build the surface version was read from");
});
