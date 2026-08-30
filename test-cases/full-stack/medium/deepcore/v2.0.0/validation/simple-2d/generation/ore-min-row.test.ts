// Deepcore — generation.ore-min-row. STUB: NOT YET AUTHORED.
//
// No ore appears in the first three rows of ground
//
// No ore cell exists above ORE_MIN_ROW (4), so rows 1 to 3 are plain rock and
// the first digs out of the camp yield nothing.
//
// Automated validation: generate mines at several seeds and read every cell of
// rows 1 to 3 across the playable columns, holding each kind against ore.
//
// `test-case.toml` declares this suite as `generation/ore-min-row.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shallow (image)) around the drive.

import { test } from "vitest";

test("No ore appears in the first three rows of ground", () => {
  throw new Error(
    "Deepcore validator `generation/ore-min-row` is declared in test-case.toml but has not been authored yet.",
  );
});
