// Deepcore — cargo.refuel-does-not-empty-the-bay. STUB: NOT YET AUTHORED.
//
// Refuelling and repairing leave the cargo alone
//
// Buying fuel or hull repair at the Fuel Depot leaves the cargo bay exactly as
// it was, so a haul survives a refuelling stop and is still there to sell.
//
// Automated validation: pose a bay and Credits, buy fuel and repair, then read
// the bay unchanged.
//
// `test-case.toml` declares this suite as `cargo/refuel-does-not-empty-the-bay.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bay (image)) around the drive.

import { test } from "vitest";

test("Refuelling and repairing leave the cargo alone", () => {
  throw new Error(
    "Deepcore validator `cargo/refuel-does-not-empty-the-bay` is declared in test-case.toml but has not been authored yet.",
  );
});
