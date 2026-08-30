// Deepcore — camera.lead-builds-climbing. STUB: NOT YET AUTHORED.
//
// A sustained climb rides the miner down the view symmetrically
//
// A sustained climb drives the lead toward negative CAM_LEAD_MAX at the same
// rate, so the ceiling comes into view early on the way up.
//
// Automated validation: thrust the miner up a long cleared shaft and sample
// the lead against the ramp, holding it at negative CAM_LEAD_MAX after two
// seconds.
//
// `test-case.toml` declares this suite as `camera/lead-builds-climbing.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (ascend (replay)) around the drive.

import { test } from "vitest";

test("A sustained climb rides the miner down the view symmetrically", () => {
  throw new Error(
    "Deepcore validator `camera/lead-builds-climbing` is declared in test-case.toml but has not been authored yet.",
  );
});
