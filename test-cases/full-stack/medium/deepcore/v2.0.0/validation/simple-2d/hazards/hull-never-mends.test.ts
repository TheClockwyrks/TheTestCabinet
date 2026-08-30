// Deepcore — hazards.hull-never-mends. STUB: NOT YET AUTHORED.
//
// Hull never mends on its own
//
// Hull is repaired only by paying for it at the Fuel Depot or by using
// Regenerative Nanobots, so a damaged miner standing anywhere for any length
// of time stays damaged.
//
// Automated validation: pose a damaged hull, stand the miner idle in the camp
// and underground in turn for a long span and read the hull unchanged.
//
// `test-case.toml` declares this suite as `hazards/hull-never-mends.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (scar (replay)) around the drive.

import { test } from "vitest";

test("Hull never mends on its own", () => {
  throw new Error(
    "Deepcore validator `hazards/hull-never-mends` is declared in test-case.toml but has not been authored yet.",
  );
});
