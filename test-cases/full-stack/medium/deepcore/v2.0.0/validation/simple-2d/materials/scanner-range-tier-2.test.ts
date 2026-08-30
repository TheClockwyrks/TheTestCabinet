// Deepcore — materials.scanner-range-tier-2. STUB: NOT YET AUTHORED.
//
// Tier 2 locks within ten tiles
//
// At scanner tier 2 a needed node locks on while the straight-line distance
// between the miner cell and the node cell is within 10 tiles, and does not
// lock beyond it.
//
// Automated validation: pose a needed node at just inside and just outside 10
// tiles from the miner at tier 2 and read the lock at each.
//
// `test-case.toml` declares this suite as `materials/scanner-range-tier-2.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (range (image)) around the drive.

import { test } from "vitest";

test("Tier 2 locks within ten tiles", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-range-tier-2` is declared in test-case.toml but has not been authored yet.",
  );
});
