// Deepcore — supplies.using-with-nothing-to-change-is-a-no-op. STUB: NOT YET AUTHORED.
//
// A supply that would change nothing is not consumed
//
// Using a supply that would change nothing, such as nanobots at full hull or
// emergency fuel at a full tank, is a no-op: a note is shown and nothing is
// consumed.
//
// Automated validation: pose a full hull and a full tank with both supplies
// held, use each and read the counts unchanged.
//
// `test-case.toml` declares this suite as `supplies/using-with-nothing-to-change-is-a-no-op.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (noop (image)) around the drive.

import { test } from "vitest";

test("A supply that would change nothing is not consumed", () => {
  throw new Error(
    "Deepcore validator `supplies/using-with-nothing-to-change-is-a-no-op` is declared in test-case.toml but has not been authored yet.",
  );
});
