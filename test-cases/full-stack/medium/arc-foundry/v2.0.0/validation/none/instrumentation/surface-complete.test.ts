// instrumentation/surface-complete — the build installed the whole debug and
// automation surface `specs/instrumentation.md` requires.
//
// EVERY PART OF THIS IS THE BUILD'S. An engineless run seeds no `src/` at all, so
// the surface itself — the global it is installed on, every operation, the
// version — is a deliverable of this point, and every other automated point in
// this project reaches the game through it. A build that never installed it
// leaves nothing to drive; the harness reports that as `surfaceFault` rather than
// by throwing, so the fault lands here rather than inside some other check's
// setup.
//
// WHAT IS DECIDED HERE. That the operations are THERE, reflected without being
// invoked, and that the surface reports the version the specification fixes.
// Whether the surface is actually WIRED to the running game is a second
// requirement — a surface whose operations are all present and whose `snapshot`
// reports a plausible object unconnected to the game is present and useless — and
// `instrumentation/surface-takes-effect` decides that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  FOUNDRY_DEBUG_VERSION,
  HANDLE,
  REQUIRED_OPS,
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`installs a whole surface on window.${HANDLE}`, async () => {
  // Fail with the harness's own account of what is missing, paired with what the
  // specification requires, rather than with a comparison's rendering of it: this
  // is the point whose whole job is to name that plainly.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  await captureStill(h, "surface");

  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    FOUNDRY_DEBUG_VERSION,
    `window.${HANDLE}.version (specs/instrumentation.md)`,
  );
  for (const operation of REQUIRED_OPS) {
    assertEqual(
      probed.ops[operation],
      "function",
      `window.${HANDLE}.${operation}`,
    );
  }
});
