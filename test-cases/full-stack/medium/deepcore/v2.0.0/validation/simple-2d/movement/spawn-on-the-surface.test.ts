// Deepcore — movement.spawn-on-the-surface. STUB: NOT YET AUTHORED.
//
// A new expedition starts on the camp ground
//
// Starting an expedition puts the miner standing on the camp ground at
// SPAWN_COL (4) at depth 0, never already inside a shaft or cavern below the
// surface, and it does not sink the moment play begins.
//
// Automated validation: start an expedition, read the miner column, depth and
// grounded flag at once and again after a short advance with nothing held.
//
// `test-case.toml` declares this suite as `movement/spawn-on-the-surface.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (start (image)) around the drive.

import { test } from "vitest";

test("A new expedition starts on the camp ground", () => {
  throw new Error(
    "Deepcore validator `movement/spawn-on-the-surface` is declared in test-case.toml but has not been authored yet.",
  );
});
