// Deepcore — weight.overload-flag. STUB: NOT YET AUTHORED.
//
// The overload flag follows the load fraction
//
// The snapshot overloaded flag is true exactly while the load fraction is 1 or
// more and false below it, so it flips on the unit that crosses the limit.
//
// Automated validation: pose the cargo just under and just over the lift limit
// and read the flag at each.
//
// `test-case.toml` declares this suite as `weight/overload-flag.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (flag (image)) around the drive.

import { test } from "vitest";

test("The overload flag follows the load fraction", () => {
  throw new Error(
    "Deepcore validator `weight/overload-flag` is declared in test-case.toml but has not been authored yet.",
  );
});
