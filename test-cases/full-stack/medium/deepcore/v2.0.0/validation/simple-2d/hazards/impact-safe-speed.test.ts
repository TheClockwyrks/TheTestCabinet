// Deepcore — hazards.impact-safe-speed. STUB: NOT YET AUTHORED.
//
// A landing at or under the safe speed is harmless
//
// A landing at a downward speed at or below IMPACT_SAFE_SPEED (700) costs no
// hull at all, and a free fall of two tiles stays inside that, so stepping off
// a ledge is always harmless.
//
// Automated validation: drop the miner two tiles onto a posed floor and read
// the hull unchanged, then repeat from a posed velocity just under the safe
// speed.
//
// `test-case.toml` declares this suite as `hazards/impact-safe-speed.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (hop (replay)) around the drive.

import { test } from "vitest";

test("A landing at or under the safe speed is harmless", () => {
  throw new Error(
    "Deepcore validator `hazards/impact-safe-speed` is declared in test-case.toml but has not been authored yet.",
  );
});
