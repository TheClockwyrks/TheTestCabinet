// Deepcore — economy.unaffordable-refused. STUB: NOT YET AUTHORED.
//
// A purchase beyond the Credits is refused
//
// An upgrade, a field supply, a fuel increment or a rocket component the
// balance cannot cover is refused outright: nothing is bought and the balance
// is unchanged, rather than a partial purchase or a negative balance.
//
// Automated validation: pose a balance one Credit short of an upgrade and of a
// supply in turn, attempt each and read the tier, the count and the balance
// unchanged.
//
// `test-case.toml` declares this suite as `economy/unaffordable-refused.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (refused (image)) around the drive.

import { test } from "vitest";

test("A purchase beyond the Credits is refused", () => {
  throw new Error(
    "Deepcore validator `economy/unaffordable-refused` is declared in test-case.toml but has not been authored yet.",
  );
});
