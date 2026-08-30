// Deepcore — world.deepest-depth-holds. STUB: NOT YET AUTHORED.
//
// The deepest depth reached does not fall back
//
// deepestDepthMeters keeps the greatest depth this expedition has reached and
// holds it while the miner climbs back toward the surface, so the summary
// reports how deep the expedition went rather than where it ended.
//
// Automated validation: drive the miner down, read deepestDepthMeters, fly
// back up and read it again.
//
// `test-case.toml` declares this suite as `world/deepest-depth-holds.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (climb (replay)) around the drive.

import { test } from "vitest";

test("The deepest depth reached does not fall back", () => {
  throw new Error(
    "Deepcore validator `world/deepest-depth-holds` is declared in test-case.toml but has not been authored yet.",
  );
});
