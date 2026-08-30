// Deepcore — assets.ore-overlays. STUB: NOT YET AUTHORED.
//
// Every ore and gemstone has its own overlay
//
// One overlay exists at assets/ore/<name>.png for each of the ten ores and
// three gemstones, named in lower case, and no two of the thirteen are
// identical.
//
// Automated validation: read the thirteen overlay files by the names in
// specs/mining.md and hold each present and every pair different.
//
// `test-case.toml` declares this suite as `assets/ore-overlays.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (ores (image)) around the drive.

import { test } from "vitest";

test("Every ore and gemstone has its own overlay", () => {
  throw new Error(
    "Deepcore validator `assets/ore-overlays` is declared in test-case.toml but has not been authored yet.",
  );
});
