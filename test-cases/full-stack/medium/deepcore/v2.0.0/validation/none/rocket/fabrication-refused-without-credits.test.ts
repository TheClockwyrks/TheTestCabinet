// Deepcore — rocket.fabrication-refused-without-credits. STUB: NOT YET AUTHORED.
//
// Fabricating is refused without the Credits
//
// FABRICATE is refused while the balance is short of the component price:
// nothing is installed, no material is consumed and the balance is unchanged.
//
// Automated validation: pose a balance one Credit short with the material
// held, attempt the fabrication and read the installed list, the satchel and
// the balance unchanged.
//
// `test-case.toml` declares this suite as `rocket/fabrication-refused-without-credits.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (short (image)) around the drive.

import { test } from "vitest";

test("Fabricating is refused without the Credits", () => {
  throw new Error(
    "Deepcore validator `rocket/fabrication-refused-without-credits` is declared in test-case.toml but has not been authored yet.",
  );
});
