// Deepcore — materials.scanner-targets-what-is-missing. STUB: NOT YET AUTHORED.
//
// The scanner targets the material the miner lacks
//
// While the miner lacks Resonite the scanner targets the Resonite node, and
// while it lacks Cryenite it targets the Cryenite node.
//
// Automated validation: pose both nodes in range with one material held, read
// the target, then swap which is held and read it again.
//
// `test-case.toml` declares this suite as `materials/scanner-targets-what-is-missing.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (target (image)) around the drive.

import { test } from "vitest";

test("The scanner targets the material the miner lacks", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-targets-what-is-missing` is declared in test-case.toml but has not been authored yet.",
  );
});
