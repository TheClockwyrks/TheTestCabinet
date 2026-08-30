// Deepcore — economy.upgrade-applies-at-once. STUB: NOT YET AUTHORED.
//
// A purchased tier applies immediately
//
// A purchase deducts its price and takes effect at once: a stronger drill cuts
// with its new damage on the very next cut rather than on the next expedition.
//
// Automated validation: cut a posed cell at tier 1, buy the drill tier, cut an
// identical posed cell and hold the hits taken against the new tier.
//
// `test-case.toml` declares this suite as `economy/upgrade-applies-at-once.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drill (replay)) around the drive.

import { test } from "vitest";

test("A purchased tier applies immediately", () => {
  throw new Error(
    "Deepcore validator `economy/upgrade-applies-at-once` is declared in test-case.toml but has not been authored yet.",
  );
});
