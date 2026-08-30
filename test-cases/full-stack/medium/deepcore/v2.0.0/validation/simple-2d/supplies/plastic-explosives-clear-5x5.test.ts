// Deepcore — supplies.plastic-explosives-clear-5x5. STUB: NOT YET AUTHORED.
//
// Plastic Explosives clear a wider block
//
// Using Plastic Explosives clears the 5 by 5 block of cells centered on the
// miner cell, a radius of 2, and consumes one.
//
// Automated validation: pose solid rock around the miner, use Plastic
// Explosives and read every cell of the block as tunnel with the ring beyond
// it untouched.
//
// `test-case.toml` declares this suite as `supplies/plastic-explosives-clear-5x5.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (blast (replay)) around the drive.

import { test } from "vitest";

test("Plastic Explosives clear a wider block", () => {
  throw new Error(
    "Deepcore validator `supplies/plastic-explosives-clear-5x5` is declared in test-case.toml but has not been authored yet.",
  );
});
