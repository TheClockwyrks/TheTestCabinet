// Deepcore — drilling.drill-down-over-open-space. STUB: NOT YET AUTHORED.
//
// A cut over open space does not sink the miner
//
// With open space or lava below the cell being cut, the miner does not sink as
// the cut runs, and it falls into the opening once that cell breaks.
//
// Automated validation: pose a rock cell over a cleared cell, hold down,
// sample the miner position through the cut, then confirm it falls when the
// cell breaks.
//
// `test-case.toml` declares this suite as `drilling/drill-down-over-open-space.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (hollow (replay)) around the drive.

import { test } from "vitest";

test("A cut over open space does not sink the miner", () => {
  throw new Error(
    "Deepcore validator `drilling/drill-down-over-open-space` is declared in test-case.toml but has not been authored yet.",
  );
});
