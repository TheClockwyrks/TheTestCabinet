// Deepcore — hazards.gas-knockback. STUB: NOT YET AUTHORED.
//
// A gas blast shoves the miner away
//
// The detonation shoves the miner directly away from the pocket at
// GAS_KNOCKBACK (700) units per second, so a blast throws the miner clear
// rather than leaving it standing.
//
// Automated validation: detonate a posed pocket beside a miner in cleared
// space and hold the velocity direction and magnitude immediately after
// against GAS_KNOCKBACK.
//
// `test-case.toml` declares this suite as `hazards/gas-knockback.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shove (replay)) around the drive.

import { test } from "vitest";

test("A gas blast shoves the miner away", () => {
  throw new Error(
    "Deepcore validator `hazards/gas-knockback` is declared in test-case.toml but has not been authored yet.",
  );
});
