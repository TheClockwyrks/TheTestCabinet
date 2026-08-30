// Deepcore — cargo.credits-earned-accumulates. STUB: NOT YET AUTHORED.
//
// The expedition tracks the Credits it has earned
//
// creditsEarned is the running total earned this expedition and rises by each
// sale, so it exceeds the balance once anything has been spent and is what the
// summary reports.
//
// Automated validation: sell twice, spend some of the proceeds and hold
// creditsEarned against the two sales rather than the balance.
//
// `test-case.toml` declares this suite as `cargo/credits-earned-accumulates.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (earned (image)) around the drive.

import { test } from "vitest";

test("The expedition tracks the Credits it has earned", () => {
  throw new Error(
    "Deepcore validator `cargo/credits-earned-accumulates` is declared in test-case.toml but has not been authored yet.",
  );
});
