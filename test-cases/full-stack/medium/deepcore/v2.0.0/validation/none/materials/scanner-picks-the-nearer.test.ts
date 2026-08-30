// Deepcore — materials.scanner-picks-the-nearer. STUB: NOT YET AUTHORED.
//
// With both missing the scanner targets the nearer node
//
// With neither material held and both nodes in range, the scanner targets
// whichever node is nearer the miner.
//
// Automated validation: pose both nodes in range at different distances with
// an empty satchel and read the target, then move the miner and read it again.
//
// `test-case.toml` declares this suite as `materials/scanner-picks-the-nearer.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (nearer (image)) around the drive.

import { test } from "vitest";

test("With both missing the scanner targets the nearer node", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-picks-the-nearer` is declared in test-case.toml but has not been authored yet.",
  );
});
