// instrumentation/surface-complete — the build returned the whole debug and
// automation surface `specs/instrumentation.md` requires.
//
// EVERY PART OF THIS IS THE BUILD'S. The engine holds no surface of its own: the
// build's game instance's `initialize` returns it, the engine keeps that same
// object, and `engine.debug` is the only way one reaches a check
// (specs/instrumentation.md). Every other automated point in this project poses
// its scenario through it, so a build that returned nothing there leaves nothing
// to drive; the harness stands a failing proxy in its place so the fault lands
// HERE, by name, rather than inside some other check's setup.
//
// WHAT THIS ONE DECIDES. That the operations are THERE — reflected without being
// invoked, so a missing operation is named rather than throwing a `TypeError`
// inside whichever check reached for it first. That the surface is WIRED to the
// running game is a separate requirement, decided by
// `instrumentation/surface-takes-effect`: a surface whose operations are all
// present and whose `snapshot` reports a plausible object unconnected to the game
// is present and useless, and a build that missed one of the two has missed one
// requirement rather than both.
//
// THE CLOCK AND THE INPUT ARE NOT ON THE SURFACE. Under this engine both belong to
// the runtime, and `specs/instrumentation.md` strikes them from the operation
// list, so demanding them here would fail a perfectly conformant build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  REQUIRED_OPS,
} from "../harness";
import { FOUNDRY_DEBUG_VERSION } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a whole surface from its instance's initialize", async () => {
  // `engine.debug` is whatever the build's game instance returned from
  // `initialize`, so reading it is the check: there is no page property to look
  // for and nothing the harness could have supplied in the build's place.
  assertNotNull(h.engine.debug, "engine.debug");
  assertEqual(typeof h.engine.debug, "object", "typeof engine.debug");

  const probed = h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    FOUNDRY_DEBUG_VERSION,
    "the version the surface reports (specs/instrumentation.md)",
  );
  for (const operation of REQUIRED_OPS) {
    assertEqual(probed.ops[operation], "function", `engine.debug.${operation}`);
  }

  openYard(h);
  await h.advance(1);
  captureStill(h, "surface");
});
