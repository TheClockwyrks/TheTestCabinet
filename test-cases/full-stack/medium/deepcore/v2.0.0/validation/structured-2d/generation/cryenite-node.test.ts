// Deepcore — generation.cryenite-node. STUB: NOT YET AUTHORED.
//
// Exactly one Cryenite node exists, in the deepstone
//
// Every generated mine holds exactly one material node holding cryenite, and
// it sits at a minable cell of the deepstone band, at every seed and every
// world size.
//
// Automated validation: generate mines at several seeds and sizes and count
// material cells holding cryenite, holding the count at one and its band at
// deepstone.
//
// `test-case.toml` declares this suite as `generation/cryenite-node.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (node (image)) around the drive.

import { test } from "vitest";

test("Exactly one Cryenite node exists, in the deepstone", () => {
  throw new Error(
    "Deepcore validator `generation/cryenite-node` is declared in test-case.toml but has not been authored yet.",
  );
});
