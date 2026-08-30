// Deepcore — materials.scanner-direction-is-a-unit-vector. STUB: NOT YET AUTHORED.
//
// The reported direction points at the node
//
// dirX and dirY form a unit direction from the miner to the target node, so
// their length is 1 and their signs follow which way the node lies.
//
// Automated validation: pose a node in each of four directions from the miner
// and hold the reported direction length and signs at each.
//
// `test-case.toml` declares this suite as `materials/scanner-direction-is-a-unit-vector.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bearing (image)) around the drive.

import { test } from "vitest";

test("The reported direction points at the node", () => {
  throw new Error(
    "Deepcore validator `materials/scanner-direction-is-a-unit-vector` is declared in test-case.toml but has not been authored yet.",
  );
});
