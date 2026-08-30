// Deepcore — materials.scanner-never-targets-the-core. STUB: NOT YET AUTHORED.
//
// The scanner never targets the Core
//
// The scanner locates the two material nodes and nothing else: with both
// materials held and the Core well within range, nothing locks on.
//
// Automated validation: pose both materials held with the miner beside the
// Core at tier 3 and read the lock false and the target null.
//
// `test-case.toml` declares this suite as `materials/scanner-never-targets-the-core.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (core (image)) around the drive.

import { test } from "vitest";

test("The scanner never targets the Core", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-never-targets-the-core` is declared in test-case.toml but has not been authored yet.",
  );
});
