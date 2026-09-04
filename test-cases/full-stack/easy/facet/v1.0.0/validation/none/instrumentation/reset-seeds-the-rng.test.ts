// Facet — instrumentation/reset-seeds-the-rng: `options.seed` is what seeds
// `rngState`.
//
// specs/instrumentation.md, of `reset`: "`options.seed` seeds `rngState`,
// defaulting to `DEFAULT_SEED` (`1`)."
//
// TWO HALVES, AND THE SECOND IS WHAT MAKES THE FIRST MEAN ANYTHING. A bare
// `reset` and a `reset` carrying the default are the same reset, so the two
// reach the same generator state; and another seed reaches another state, which
// a build that accepted the option and threw it away would fail. Without the
// second half a build that hard-coded one generator state would answer the first
// perfectly.
//
// WHAT IT DOES NOT DECIDE. That the seed goes on to deal a reproducible board is
// `instrumentation/seeded-determinism-same-seed` and
// `instrumentation/seeded-determinism-different-seed`; what `reset` puts back is
// `instrumentation/reset-restores-every-field`. This point reads one field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";

let h: Harness;

/** A seed other than the default, for reading what `options.seed` does. */
const OTHER_SEED = DEFAULT_SEED + 1;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seeds rngState from options.seed, defaulting to DEFAULT_SEED", async () => {
  requireSurface();

  // "`options.seed` seeds `rngState`, defaulting to `DEFAULT_SEED` (`1`)": a
  // bare reset and a reset carrying the default are the same reset, so the two
  // reach the same generator state.
  await h.debug.reset({ seed: DEFAULT_SEED });
  const named = (await h.snapshot()).rngState;
  await h.debug.reset();
  const bare = (await h.snapshot()).rngState;
  assertEqual(bare, named, "the rngState a bare reset reaches");

  // And the seed is really what set it: another seed reaches another state. A
  // build whose `reset` ignored the option would answer the same number here.
  await h.debug.reset({ seed: OTHER_SEED });
  const other = (await h.snapshot()).rngState;
  assertNotEqual(
    other,
    named,
    `the rngState reset({ seed: ${OTHER_SEED} }) reaches`,
  );

  // The screen the three resets were read on.
  await h.advance(1);
  await captureStill(h, "seeded");
});
