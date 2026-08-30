// Deepcore — materials.scanner-tier-1-shows-nothing. STUB: NOT YET AUTHORED.
//
// Without a scanner nothing is locked
//
// At scanner tier 1 the miner has no scanner: nothing locks on however close a
// needed node is, the lock reads false, the direction is zero and the distance
// is null.
//
// Automated validation: pose a node one cell from the miner at tier 1 and read
// the scanner block at its resting values.
//
// `test-case.toml` declares this suite as `materials/scanner-tier-1-shows-nothing.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (none (image)) around the drive.

import { test } from "vitest";

test("Without a scanner nothing is locked", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-tier-1-shows-nothing` is declared in test-case.toml but has not been authored yet.",
  );
});
