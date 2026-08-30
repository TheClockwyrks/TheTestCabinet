// Deepcore — drilling.stone-makes-no-progress. STUB: NOT YET AUTHORED.
//
// Unbreakable stone cannot be drilled
//
// A drill aimed into an unbreakable-stone cell starts no cut and makes no
// progress: the cell never breaks however long the direction is held, so the
// miner has to route around it.
//
// Automated validation: pose a stone cell under a grounded miner, hold down
// for far longer than any band takes to break, and read the cell unchanged.
//
// `test-case.toml` declares this suite as `drilling/stone-makes-no-progress.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (boulder (replay)) around the drive.

import { test } from "vitest";

test("Unbreakable stone cannot be drilled", () => {
  throw new Error(
    "Deepcore validator `drilling/stone-makes-no-progress` is declared in test-case.toml but has not been authored yet.",
  );
});
