// Deepcore — instrumentation.snapshot-derived. STUB: NOT YET AUTHORED.
//
// The derived snapshot figures follow their sources
//
// depthMeters follows the miner position, overloaded follows loadKg against
// liftLimitKg, and drilling.progress runs 0 to 1 as the target cell health
// drains, so each moves when its source moves rather than being stored
// independently.
//
// Automated validation: pose the miner, the cargo and a partly cut cell in
// turn and read each derived field back against the formula
// specs/instrumentation.md states for it.
//
// `test-case.toml` declares this suite as `instrumentation/snapshot-derived.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (derived (replay)) around the drive.

import { test } from "vitest";

test("The derived snapshot figures follow their sources", () => {
  throw new Error(
    "Deepcore validator `instrumentation/snapshot-derived` is declared in test-case.toml but has not been authored yet.",
  );
});
