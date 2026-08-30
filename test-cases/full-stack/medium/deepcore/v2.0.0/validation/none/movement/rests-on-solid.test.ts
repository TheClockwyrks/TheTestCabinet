// Deepcore — movement.rests-on-solid. STUB: NOT YET AUTHORED.
//
// The miner box never overlaps a solid cell
//
// The miner box never overlaps a cell that is not a tunnel: it comes to rest
// on top of solid cells rather than sinking into or through them, however fast
// it arrives.
//
// Automated validation: drop the miner onto a posed floor from a height that
// reaches terminal speed and hold the resting box clear of every solid cell it
// passed.
//
// `test-case.toml` declares this suite as `movement/rests-on-solid.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (landing (replay)) around the drive.

import { test } from "vitest";

test("The miner box never overlaps a solid cell", () => {
  throw new Error(
    "Deepcore validator `movement/rests-on-solid` is declared in test-case.toml but has not been authored yet.",
  );
});
