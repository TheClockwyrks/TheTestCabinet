// Deepcore — hazards.gas-ignores-the-radiator. STUB: NOT YET AUTHORED.
//
// The radiator does not reduce gas damage
//
// Nothing reduces gas damage: the same posed detonation costs the same hull at
// radiator tier 1 and at tier 5, so hull is the only counter to gas.
//
// Automated validation: detonate the same posed pocket at radiator tier 1 and
// tier 5 and hold the two hull losses equal.
//
// `test-case.toml` declares this suite as `hazards/gas-ignores-the-radiator.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (unshielded (replay)) around the drive.

import { test } from "vitest";

test("The radiator does not reduce gas damage", () => {
  throw new Error(
    "Deepcore validator `hazards/gas-ignores-the-radiator` is declared in test-case.toml but has not been authored yet.",
  );
});
