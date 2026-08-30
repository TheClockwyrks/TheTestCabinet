// Deepcore — generation.gemstone-band-confinement. STUB: NOT YET AUTHORED.
//
// Each gemstone is confined to its own band
//
// Verdite appears only in the rockbed, Roselite only in the deepstone and
// Aurite only in the coreshell, which is what their narrow curves in
// specs/mining.md fix, so no gemstone is found outside its band.
//
// Automated validation: generate mines at several seeds and hold the band of
// every gemstone cell against the band that gemstone belongs to.
//
// `test-case.toml` declares this suite as `generation/gemstone-band-confinement.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (gem (image)) around the drive.

import { test } from "vitest";

test("Each gemstone is confined to its own band", () => {
  throw new Error(
    "Deepcore validator `generation/gemstone-band-confinement` is declared in test-case.toml but has not been authored yet.",
  );
});
