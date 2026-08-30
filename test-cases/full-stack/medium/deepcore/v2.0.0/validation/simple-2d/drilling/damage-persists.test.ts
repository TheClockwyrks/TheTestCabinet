// Deepcore — drilling.damage-persists. STUB: NOT YET AUTHORED.
//
// A partly cut cell keeps its damage
//
// A cell drilled partway and then left keeps its remaining health when the
// miner moves away, and returning resumes from the reduced health rather than
// restarting from full.
//
// Automated validation: cut a posed cell partway, read its health, move the
// miner clear, return and hold the health it resumes from against the reading.
//
// `test-case.toml` declares this suite as `drilling/damage-persists.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (resume (replay)) around the drive.

import { test } from "vitest";

test("A partly cut cell keeps its damage", () => {
  throw new Error(
    "Deepcore validator `drilling/damage-persists` is declared in test-case.toml but has not been authored yet.",
  );
});
