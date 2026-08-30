// Deepcore — instrumentation.seeded-mine-reproducible. STUB: NOT YET AUTHORED.
//
// The same seed reproduces the same mine
//
// Two expeditions reset to the same seed and started at the same world size
// generate identical mines cell for cell, including the ore scatter, the
// hazard and boulder placement and both material node cells; two different
// seeds do not.
//
// Automated validation: reset to one seed, generate, sample a fixed set of
// cells across all four bands, repeat with the same seed and then with
// another, and compare the three samples.
//
// `test-case.toml` declares this suite as `instrumentation/seeded-mine-reproducible.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (mine (image)) around the drive.

import { test } from "vitest";

test("The same seed reproduces the same mine", () => {
  throw new Error(
    "Deepcore validator `instrumentation/seeded-mine-reproducible` is declared in test-case.toml but has not been authored yet.",
  );
});
