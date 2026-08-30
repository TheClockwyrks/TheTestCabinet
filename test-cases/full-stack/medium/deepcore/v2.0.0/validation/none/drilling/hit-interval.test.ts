// Deepcore — drilling.hit-interval. STUB: NOT YET AUTHORED.
//
// The drill lands hits at the stated interval
//
// The drill lands a hit every DRILL_HIT_INTERVAL (0.125) seconds while a cut
// is held, so a cut of known length removes the expected number of hits worth
// of health.
//
// Automated validation: hold a cut on a posed cell for a fixed span with a
// known drill tier and hold the health removed against the hits that span
// allows.
//
// `test-case.toml` declares this suite as `drilling/hit-interval.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (hits (replay)) around the drive.

import { test } from "vitest";

test("The drill lands hits at the stated interval", () => {
  throw new Error(
    "Deepcore validator `drilling/hit-interval` is declared in test-case.toml but has not been authored yet.",
  );
});
