// Deepcore — instrumentation.snapshot-resting-values. STUB: NOT YET AUTHORED.
//
// Fields the current state does not use report their resting values
//
// The shape is fixed whatever the screen: summary is null until the expedition
// ends, coreTimer and coreGround are null while no Sample is live, panel is
// null while no panel is open, notice is null while no card is armed, and
// menuIndex rests at 0 on in-mine. No field goes missing.
//
// Automated validation: read the snapshot on a fresh in-mine expedition and on
// the title screen and hold each unused field against the resting-values list
// in specs/instrumentation.md.
//
// `test-case.toml` declares this suite as `instrumentation/snapshot-resting-values.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (resting (image)) around the drive.

import { test } from "vitest";

test("Fields the current state does not use report their resting values", () => {
  throw new Error(
    "Deepcore validator `instrumentation/snapshot-resting-values` is declared in test-case.toml but has not been authored yet.",
  );
});
