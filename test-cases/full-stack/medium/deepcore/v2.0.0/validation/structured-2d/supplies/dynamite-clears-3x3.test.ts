// Deepcore — supplies.dynamite-clears-3x3. STUB: NOT YET AUTHORED.
//
// Dynamite clears the block around the miner
//
// Using Dynamite clears the 3 by 3 block of cells centred on the miner cell, a
// radius of 1, and consumes one Dynamite.
//
// Automated validation: pose solid rock around the miner, use Dynamite and
// read every cell of the block as tunnel with the ring beyond it untouched.
//
// `test-case.toml` declares this suite as `supplies/dynamite-clears-3x3.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (blast (replay)) around the drive.

import { test } from "vitest";

test("Dynamite clears the block around the miner", () => {
  throw new Error(
    "Deepcore validator `supplies/dynamite-clears-3x3` is declared in test-case.toml but has not been authored yet.",
  );
});
