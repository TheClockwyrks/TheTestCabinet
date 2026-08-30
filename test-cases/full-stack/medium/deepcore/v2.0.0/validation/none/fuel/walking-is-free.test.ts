// Deepcore — fuel.walking-is-free. STUB: NOT YET AUTHORED.
//
// Walking and standing cost no fuel
//
// Walking along the ground and standing still cost no fuel beyond the
// underground life-support trickle, so lateral travel through carved tunnel is
// cheap.
//
// Automated validation: walk the miner along a cleared corridor below the
// surface for a fixed span and hold the fuel spent against the life-support
// drain alone.
//
// `test-case.toml` declares this suite as `fuel/walking-is-free.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (walk (replay)) around the drive.

import { test } from "vitest";

test("Walking and standing cost no fuel", () => {
  throw new Error(
    "Deepcore validator `fuel/walking-is-free` is declared in test-case.toml but has not been authored yet.",
  );
});
