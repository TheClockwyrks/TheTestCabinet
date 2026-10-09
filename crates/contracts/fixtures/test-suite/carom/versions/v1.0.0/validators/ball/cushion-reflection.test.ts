// The test driving `ball/cushion-reflection.ts` against a known implementation, which is what
// proves the validator decides `ball-physics/cushion-reflection` rather than something else.
//
// It runs in the document `vitest.config.ts` loads the served build into:
// the build the runner names in the environment, or a build served locally
// when it names none — so this one file drives a reference implementation
// while the validator is authored and the produced build during a run.

import { expect, inject, test } from "vitest";

import type { CaromDebugApi } from "../debug-api";
import cushionReflection from "./cushion-reflection";

// The debug API root the served build set on this document's `globalThis`,
// under the handle `vitest.config.ts` provides from the suite's own
// `debug-api.toml`.
const debug = (globalThis as Record<string, unknown>)[
  inject("debugApiHandle")
] as CaromDebugApi;

for (const assertion of cushionReflection(debug)) {
  test(assertion.name, () => {
    expect(assertion.passed, assertion.detail).toBe(true);
  });
}
