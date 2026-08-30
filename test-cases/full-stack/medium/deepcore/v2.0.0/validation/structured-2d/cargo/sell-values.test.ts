// Deepcore — cargo.sell-values. STUB: NOT YET AUTHORED.
//
// A sale pays each unit its stated value
//
// The Credits a sale pays are the sum of the held units at the values in
// specs/mining.md, so a bay of three Ferron and one Aurite pays 28 times 3
// plus 2460.
//
// Automated validation: pose a known mixed bay, sell and hold the Credits
// gained against the sum of the stated values.
//
// `test-case.toml` declares this suite as `cargo/sell-values.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (credits (image)) around the drive.

import { test } from "vitest";

test("A sale pays each unit its stated value", () => {
  throw new Error(
    "Deepcore validator `cargo/sell-values` is declared in test-case.toml but has not been authored yet.",
  );
});
