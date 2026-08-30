// Deepcore — world-size.core-row-per-size. STUB: NOT YET AUTHORED.
//
// The Core sits at the depth the size fixes
//
// coreRow is round(STANDARD_ROWS * WORLD_SIZE_SCALE): 250 in a Quick mine, 500
// in a Standard one and 1000 in a Marathon one, so the Core depth reads 1250,
// 2500 and 5000 meters.
//
// Automated validation: start an expedition at each size and hold coreRow and
// the depth of the Core chamber against the table in specs/world.md.
//
// `test-case.toml` declares this suite as `world-size/core-row-per-size.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (depth (image)) around the drive.

import { test } from "vitest";

test("The Core sits at the depth the size fixes", () => {
  throw new Error(
    "Deepcore validator `world-size/core-row-per-size` is declared in test-case.toml but has not been authored yet.",
  );
});
