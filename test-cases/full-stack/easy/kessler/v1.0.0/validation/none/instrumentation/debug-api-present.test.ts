// instrumentation/debug-api-present — the surface is installed, whole.
//
// specs/instrumentation.md: "the build installs the finished surface on
// `window.__kessler` as soon as the game has initialized. Every scenario driven
// from code reaches the game through it, so it is present and exactly as
// specified here." The operations it must carry are the ones the same file
// enumerates under "The operations" — under this engine the two clock
// operations included, because "nothing outside this build owns" the clock.
//
// PRESENCE ALONE. That each operation then does what its own section states is
// the business of the per-operation points beside this one, and that the
// surface is LIVE rather than hollow belongs to `debug-api-live`. What fails
// here, by name, is a build that installed nothing or left an operation out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  failSurface,
  HANDLE,
  openHarness,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it(`installs every operation its mode names on window.${HANDLE}, as functions`, async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  await captureStill(h, "surface");
  for (const op of REQUIRED_OPS) {
    assertEqual(probed[op], "function", `window.${HANDLE}.${op}`);
  }
});
