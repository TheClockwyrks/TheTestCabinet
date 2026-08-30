// Deepcore — camera.lead-unwinds-faster. STUB: NOT YET AUTHORED.
//
// The lead unwinds faster than it builds
//
// A move that takes the lead toward 0 runs at CAM_UNWIND_MULT (4) times the
// build rate, so reversing direction recenters the miner quickly rather than
// dragging the old lead along.
//
// Automated validation: build the lead to full on a descent, then stop, and
// sample the lead unwinding against four times the build rate.
//
// `test-case.toml` declares this suite as `camera/lead-unwinds-faster.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (unwind (replay)) around the drive.

import { test } from "vitest";

test("The lead unwinds faster than it builds", () => {
  throw new Error(
    "Deepcore validator `camera/lead-unwinds-faster` is declared in test-case.toml but has not been authored yet.",
  );
});
