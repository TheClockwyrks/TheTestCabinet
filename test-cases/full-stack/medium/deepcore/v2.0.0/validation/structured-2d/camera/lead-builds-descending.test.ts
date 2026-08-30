// Deepcore — camera.lead-builds-descending. STUB: NOT YET AUTHORED.
//
// A sustained descent rides the miner up the view
//
// A sustained descent drives the lead toward CAM_LEAD_MAX (212) at
// CAM_LEAD_MAX / CAM_LEAD_RAMP units per second, reaching full lead after
// CAM_LEAD_RAMP (2) seconds, so the floor of a shaft comes into view early.
//
// Automated validation: drop the miner down a long cleared shaft and sample
// the lead each half second against the ramp, holding it at CAM_LEAD_MAX after
// two seconds.
//
// `test-case.toml` declares this suite as `camera/lead-builds-descending.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (descend (replay)) around the drive.

import { test } from "vitest";

test("A sustained descent rides the miner up the view", () => {
  throw new Error(
    "Deepcore validator `camera/lead-builds-descending` is declared in test-case.toml but has not been authored yet.",
  );
});
