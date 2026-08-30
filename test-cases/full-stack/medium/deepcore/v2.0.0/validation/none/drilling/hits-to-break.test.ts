// Deepcore — drilling.hits-to-break. STUB: NOT YET AUTHORED.
//
// The hits to break a cell follow the band and the drill tier
//
// The hits to break a cell are ceil(BAND_HEALTH / damagePerHit) at the drill
// tier, so a tier-1 drill takes 4 hits in the topsoil and 16 in the coreshell
// while a tier-5 drill takes 1 and 4.
//
// Automated validation: pose a cell in each band, set the drill tier in turn
// and count the hits a held cut takes to break it against the table in
// specs/upgrades.md.
//
// `test-case.toml` declares this suite as `drilling/hits-to-break.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (break (replay)) around the drive.

import { test } from "vitest";

test("The hits to break a cell follow the band and the drill tier", () => {
  throw new Error(
    "Deepcore validator `drilling/hits-to-break` is declared in test-case.toml but has not been authored yet.",
  );
});
