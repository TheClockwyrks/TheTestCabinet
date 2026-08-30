// Deepcore — materials.scanner-drops-a-held-material. STUB: NOT YET AUTHORED.
//
// The scanner stops targeting a material once it is held
//
// Once a material is in the satchel the scanner no longer targets its node, so
// a held Resonite leaves the scanner pointing at Cryenite or at nothing.
//
// Automated validation: pose both nodes in range, bank the resonite and read
// the target moving off it.
//
// `test-case.toml` declares this suite as `materials/scanner-drops-a-held-material.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (switch (replay)) around the drive.

import { test } from "vitest";

test("The scanner stops targeting a material once it is held", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-drops-a-held-material` is declared in test-case.toml but has not been authored yet.",
  );
});
