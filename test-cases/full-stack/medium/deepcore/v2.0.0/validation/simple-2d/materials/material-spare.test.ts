// Deepcore — materials.material-spare. STUB: NOT YET AUTHORED.
//
// Collecting a material already held banks a spare
//
// Banking a second unit of a material already held raises its satchel count
// rather than being discarded, so a spare is kept.
//
// Automated validation: pose one resonite held, cut a second posed resonite
// node and read the satchel count at two.
//
// `test-case.toml` declares this suite as `materials/material-spare.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (spare (replay)) around the drive.

import { test } from "vitest";

test("Collecting a material already held banks a spare", () => {
  throw new Error(
    "Deepcore validator `materials/material-spare` is declared in test-case.toml but has not been authored yet.",
  );
});
