// Deepcore — world.core-chamber. STUB: NOT YET AUTHORED.
//
// The Core chamber is bedrock apart from the Core
//
// Row coreRow is bedrock in every column except CORE_COL (16), which holds the
// core tile.
//
// Automated validation: read tileAt across the whole of row coreRow and hold
// every cell against bedrock apart from CORE_COL, which must read core.
//
// `test-case.toml` declares this suite as `world/core-chamber.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (chamber (image)) around the drive.

import { test } from "vitest";

test("The Core chamber is bedrock apart from the Core", () => {
  throw new Error(
    "Deepcore validator `world/core-chamber` is declared in test-case.toml but has not been authored yet.",
  );
});
