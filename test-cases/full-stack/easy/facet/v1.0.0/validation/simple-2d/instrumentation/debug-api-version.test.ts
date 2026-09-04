// Facet — instrumentation/debug-api-version: the surface reports
// `FACET_DEBUG_VERSION` in both the places the specification puts it.
//
// specs/instrumentation.md fixes the version twice, independently: "The surface
// carries `version` (`FACET_DEBUG_VERSION`, `1`), a plain number", and the
// snapshot shape's own `version` field. Each is read by the reader that belongs
// to it — `debugVersion` reads the member off the surface itself, and the
// snapshot's is read through the operation — and both are held to the same plain
// number. A build that put the version in one place and not the other conforms
// in neither.
//
// WHY REFLECTION IS NOT ENOUGH FOR IT. `probe` answers a `typeof` and can say
// nothing at all about a VALUE, which is why this is its own reading rather than
// part of `instrumentation/debug-api-operations-present`.
//
// WHY THIS IS A POINT AT ALL. Under an engine the surface is handed back from
// `initialize` and the engine holds it. Nothing holds it here: an engineless
// build gets no runtime, so the global it is installed on, every operation on
// it, the version, and the snapshot shape are all deliverables of the build
// (specs/instrumentation.md). Every other automated point in this project
// reaches the game through it, so when the surface is missing or partial they
// all fail together; these three are the ones that name the fault plainly. The
// harness reports it as `surfaceFault` rather than by throwing so it lands here
// rather than in some unrelated check's setup.
//
// WHAT THE THREE DELIBERATELY DO NOT DECIDE. What each operation DOES:
// `loadBoard` writing the board it was given is `board/load-board-carries-the-
// tokens`, `requestSwap` going through R1-R3 is the `moves` points, and the
// derived fields of the snapshot — `levelTarget`, `multiplier`, `legalSwap` and
// a cell's center — each have a point of their own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FACET_DEBUG_VERSION } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * build owes.
 *
 * `assertNull(h.surfaceFault)` would render as "Expected: null" over the reason,
 * throwing away the half of the pair that says what the build owes. This is the
 * point whose whole job is to state that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports FACET_DEBUG_VERSION on the surface and in the snapshot", async () => {
  // Two readers, because the specification fixes two places. `debugVersion`
  // reads the member off the surface itself; the snapshot's `version` is read
  // through the operation. Both are the same plain number, `1`.
  requireSurface();

  assertEqual(
    await h.debugVersion(),
    FACET_DEBUG_VERSION,
    "engine.debug.version",
  );
  assertEqual(
    h.snapshot().version,
    FACET_DEBUG_VERSION,
    "the version the snapshot reports",
  );

  // The screen the two readings were taken on.
  await h.advance(1);
  captureStill(h, "version");
});
