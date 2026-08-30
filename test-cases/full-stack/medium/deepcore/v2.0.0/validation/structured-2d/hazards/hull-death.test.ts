// Deepcore — hazards.hull-death. STUB: NOT YET AUTHORED.
//
// An empty hull destroys the miner
//
// Hull standing at 0 destroys the miner whatever emptied it, and it is checked
// continuously rather than only at the blow, so a hull driven to 0 by the lava
// drain ends the expedition on the next update with the cause hull-destroyed.
//
// Automated validation: pose a thin hull against a lava contact, let the drain
// take it to 0 and read the screen and the summary death cause.
//
// `test-case.toml` declares this suite as `hazards/hull-death.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (death (replay)) around the drive.

import { test } from "vitest";

test("An empty hull destroys the miner", () => {
  throw new Error(
    "Deepcore validator `hazards/hull-death` is declared in test-case.toml but has not been authored yet.",
  );
});
