// Deepcore — drilling.climb-after-drill. STUB: NOT YET AUTHORED.
//
// A drilled shaft can be flown back up
//
// Drilling down really removes the rock, so the miner can jetpack straight
// back up the shaft it just cut and return to the row it set out from. A build
// whose drill animates without breaking the terrain, or that strands the miner
// at the bottom of its own hole, fails here.
//
// Automated validation: cut a shaft several cells deep, then hold thrust with
// a full tank and hold the row reached against the row the cut began at.
//
// `test-case.toml` declares this suite as `drilling/climb-after-drill.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (round-trip (replay)) around the drive.

import { test } from "vitest";

test("A drilled shaft can be flown back up", () => {
  throw new Error(
    "Deepcore validator `drilling/climb-after-drill` is declared in test-case.toml but has not been authored yet.",
  );
});
