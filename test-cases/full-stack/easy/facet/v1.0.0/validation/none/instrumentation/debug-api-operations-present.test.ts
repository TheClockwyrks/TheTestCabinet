// Facet — instrumentation/debug-api-operations-present: the build installed a
// debug and automation surface that is WHOLE.
//
// specs/instrumentation.md enumerates the surface operation by operation, and
// every one of them is a deliverable: "Every operation this file specifies is a
// deliverable, and the build installs the finished surface on `window.__facet`
// as soon as the game has initialized."
//
// REFLECTED RATHER THAN CALLED, so a build is held to HAVING the operation
// rather than to what one call of it happened to do. `probe` answers a `typeof`
// and nothing more.
//
// THREE POINTS, NOT ONE. Whether the operations are there, whether the version
// is right, and whether the snapshot carries the documented shape are three
// separate failures with three separate remedies, and a build can hold any one
// of them without the others.
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
import { HANDLE } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "../surface";

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

afterEach(async () => {
  await h.dispose();
});

it(`carries every operation on window.${HANDLE}, as functions`, async () => {
  // The whole operation list of specs/instrumentation.md, including the two the
  // engineless flavor adds because nothing outside this build owns its loop:
  // `setAutoStep` and `advance`. Reflected rather than called, so a build is
  // held to having the operation rather than to what one call of it happened to
  // do.
  requireSurface();

  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed[op], "function", `typeof window.${HANDLE}.${op}`);
  }

  // The screen the surface was reflected on. Nothing was called, so the picture
  // is of the build as it stood itself up.
  await h.advance(1);
  await captureStill(h, "surface");
});
