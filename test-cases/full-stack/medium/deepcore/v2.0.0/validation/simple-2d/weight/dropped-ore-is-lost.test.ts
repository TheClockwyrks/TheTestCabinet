// Deepcore — weight.dropped-ore-is-lost. STUB: NOT YET AUTHORED.
//
// A dropped unit is lost
//
// Discarding a unit removes it from the bay without banking Credits, without
// leaving a ground item and without returning it to the mine.
//
// Automated validation: pose a known bay and Credits, drop one unit and read
// the bay, the Credits and the miner cell back.
//
// `test-case.toml` declares this suite as `weight/dropped-ore-is-lost.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drop (image)) around the drive.

import { test } from "vitest";

test("A dropped unit is lost", () => {
  throw new Error(
    "Deepcore validator `weight/dropped-ore-is-lost` is declared in test-case.toml but has not been authored yet.",
  );
});
