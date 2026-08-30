// Deepcore — materials.material-takes-no-slot. STUB: NOT YET AUTHORED.
//
// A material takes no cargo slot and no weight
//
// A banked exotic material rides in the satchel: it uses no cargo slot and
// adds nothing to loadKg, so carrying both materials never contributes to an
// overload.
//
// Automated validation: pose both materials into the satchel and read
// slotsUsed and loadKg unchanged from an empty bay.
//
// `test-case.toml` declares this suite as `materials/material-takes-no-slot.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (satchel (image)) around the drive.

import { test } from "vitest";

test("A material takes no cargo slot and no weight", () => {
  throw new Error(
    "Deepcore validator `materials/material-takes-no-slot` is declared in test-case.toml but has not been authored yet.",
  );
});
