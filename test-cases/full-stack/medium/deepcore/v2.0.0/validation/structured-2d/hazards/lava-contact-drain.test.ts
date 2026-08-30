// Deepcore — hazards.lava-contact-drain. STUB: NOT YET AUTHORED.
//
// Touching lava drains hull continuously
//
// While the miner box overlaps a lava cell the hull drains at LAVA_CONTACT_DPS
// (32) per second at radiator tier 1, for as long as the overlap lasts.
//
// Automated validation: pose the miner overlapping a lava cell with travel
// off, advance a fixed span and hold the hull lost against LAVA_CONTACT_DPS
// times the span.
//
// `test-case.toml` declares this suite as `hazards/lava-contact-drain.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (contact (replay)) around the drive.

import { test } from "vitest";

test("Touching lava drains hull continuously", () => {
  throw new Error(
    "Deepcore validator `hazards/lava-contact-drain` is declared in test-case.toml but has not been authored yet.",
  );
});
