// Deepcore — hazards.radiator-cuts-the-contact-drain. STUB: NOT YET AUTHORED.
//
// The radiator reduces the lava contact drain
//
// The radiator tier effectiveness reduces the contact drain by that fraction,
// so tier 3 at 0.45 drains 17.6 hull per second and tier 5 at 0.8 drains 6.4.
//
// Automated validation: repeat one posed contact span at several radiator
// tiers and hold each hull loss against LAVA_CONTACT_DPS times one minus the
// effectiveness.
//
// `test-case.toml` declares this suite as `hazards/radiator-cuts-the-contact-drain.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shielded (replay)) around the drive.

import { test } from "vitest";

test("The radiator reduces the lava contact drain", () => {
  throw new Error(
    "Deepcore validator `hazards/radiator-cuts-the-contact-drain` is declared in test-case.toml but has not been authored yet.",
  );
});
