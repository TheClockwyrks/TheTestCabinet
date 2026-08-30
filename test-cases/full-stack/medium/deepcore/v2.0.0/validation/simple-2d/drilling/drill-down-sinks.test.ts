// Deepcore — drilling.drill-down-sinks. STUB: NOT YET AUTHORED.
//
// A down cut sinks the miner smoothly
//
// While down is held on a minable cell the miner feet travel from the top of
// that cell to its bottom in proportion to the cut progress, 1 - health /
// BAND_HEALTH, so the miner arrives flush on the next cell exactly as the cell
// breaks rather than snapping a whole tile at once.
//
// Automated validation: hold a down cut on a posed cell and sample the miner
// vertical position against the cell remaining health at several points
// through the cut.
//
// `test-case.toml` declares this suite as `drilling/drill-down-sinks.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sink (replay)) around the drive.

import { test } from "vitest";

test("A down cut sinks the miner smoothly", () => {
  throw new Error(
    "Deepcore validator `drilling/drill-down-sinks` is declared in test-case.toml but has not been authored yet.",
  );
});
