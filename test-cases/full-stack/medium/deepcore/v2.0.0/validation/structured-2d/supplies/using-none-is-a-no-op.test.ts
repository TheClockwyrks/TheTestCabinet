// Deepcore — supplies.using-none-is-a-no-op. STUB: NOT YET AUTHORED.
//
// Using a supply held none of does nothing
//
// Using a field supply the miner holds none of is a no-op: nothing is
// consumed, no effect fires and the count stays at 0.
//
// Automated validation: pose a count of 0, use that supply and read the world,
// the hull, the fuel and the count all unchanged.
//
// `test-case.toml` declares this suite as `supplies/using-none-is-a-no-op.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (noop (replay)) around the drive.

import { test } from "vitest";

test("Using a supply held none of does nothing", () => {
  throw new Error(
    "Deepcore validator `supplies/using-none-is-a-no-op` is declared in test-case.toml but has not been authored yet.",
  );
});
