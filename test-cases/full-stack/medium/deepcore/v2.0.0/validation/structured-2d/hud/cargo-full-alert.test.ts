// Deepcore — hud.cargo-full-alert. STUB: NOT YET AUTHORED.
//
// The cargo reading takes its alert treatment when full
//
// The cargo reading takes its alert treatment while the bay is full by slots,
// drawn differently from a part-full bay.
//
// Automated validation: read the drawn cargo reading at a part-full and a full
// bay and hold the two frames different.
//
// `test-case.toml` declares this suite as `hud/cargo-full-alert.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (full (image)) around the drive.

import { test } from "vitest";

test("The cargo reading takes its alert treatment when full", () => {
  throw new Error(
    "Deepcore validator `hud/cargo-full-alert` is declared in test-case.toml but has not been authored yet.",
  );
});
