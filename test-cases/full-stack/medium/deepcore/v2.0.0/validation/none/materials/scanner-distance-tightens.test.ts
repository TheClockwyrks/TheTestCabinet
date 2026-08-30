// Deepcore — materials.scanner-distance-tightens. STUB: NOT YET AUTHORED.
//
// The reported distance tightens as the miner closes in
//
// The reported distance is the straight-line distance in tiles between the
// miner cell and the node cell, so it falls as the miner approaches and rises
// as it moves away.
//
// Automated validation: pose a node in range and read the distance at several
// miner cells, holding each against the cell separation.
//
// `test-case.toml` declares this suite as `materials/scanner-distance-tightens.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (closing (replay)) around the drive.

import { test } from "vitest";

test("The reported distance tightens as the miner closes in", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-distance-tightens` is declared in test-case.toml but has not been authored yet.",
  );
});
