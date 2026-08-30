// Deepcore — economy.credits-never-negative. STUB: NOT YET AUTHORED.
//
// Credits never go negative
//
// No sequence of purchases takes the balance below 0, so every sink refuses
// rather than borrowing.
//
// Automated validation: drive every sink in turn from a balance of 0 and from
// a balance just short of each price, and hold the balance at or above 0
// throughout.
//
// `test-case.toml` declares this suite as `economy/credits-never-negative.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (zero (image)) around the drive.

import { test } from "vitest";

test("Credits never go negative", () => {
  throw new Error(
    "Deepcore validator `economy/credits-never-negative` is declared in test-case.toml but has not been authored yet.",
  );
});
