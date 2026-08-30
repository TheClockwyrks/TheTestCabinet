// Deepcore — economy.credits-survive-death. STUB: NOT YET AUTHORED.
//
// Banked Credits survive a death
//
// Credits already earned survive a death in either mode, so a run is never set
// back to 0 Credits by dying.
//
// Automated validation: pose a balance, drive a death in each mode and read
// the balance carried into the game-over state.
//
// `test-case.toml` declares this suite as `economy/credits-survive-death.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (banked (image)) around the drive.

import { test } from "vitest";

test("Banked Credits survive a death", () => {
  throw new Error(
    "Deepcore validator `economy/credits-survive-death` is declared in test-case.toml but has not been authored yet.",
  );
});
