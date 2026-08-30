// Deepcore — movement.gravity. STUB: NOT YET AUTHORED.
//
// An unsupported miner accelerates downward at the stated rate
//
// With open space below and no thrust held, the miner accelerates downward at
// GRAVITY (1500) units per second squared, so half a second of fall from rest
// reaches 750 units per second.
//
// Automated validation: clear a deep shaft, pose the miner at rest in it and
// advance a fixed span with nothing held, holding the downward velocity
// against GRAVITY times the span.
//
// `test-case.toml` declares this suite as `movement/gravity.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (fall (replay)) around the drive.

import { test } from "vitest";

test("An unsupported miner accelerates downward at the stated rate", () => {
  throw new Error(
    "Deepcore validator `movement/gravity` is declared in test-case.toml but has not been authored yet.",
  );
});
