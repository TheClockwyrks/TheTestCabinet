// The test driving `ball/constant-speed-after-pocket-rim.ts` against a known implementation, which is what
// proves the validator decides `ball-physics/constant-speed` rather than something else.
//
// It runs in the document `vitest.config.ts` loads the served build into:
// the build the runner names in the environment, or a build served locally
// when it names none — so this one file drives a reference implementation
// while the validator is authored and the produced build during a run.

import { expect, inject, test } from "vitest";

import type { CaromDebugApi } from "../debug-api";
import constantSpeedAfterPocketRim from "./constant-speed-after-pocket-rim";

// The debug API root the served build set on this document's `globalThis`,
// under the handle `vitest.config.ts` provides from the suite's own
// `debug-api.toml`.
const debug = (globalThis as Record<string, unknown>)[
  inject("debugApiHandle")
] as CaromDebugApi;

for (const assertion of constantSpeedAfterPocketRim(debug)) {
  test(assertion.name, () => {
    expect(assertion.passed, assertion.detail).toBe(true);
  });
}
