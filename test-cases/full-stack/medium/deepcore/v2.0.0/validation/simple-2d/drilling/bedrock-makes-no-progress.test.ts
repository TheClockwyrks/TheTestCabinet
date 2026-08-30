// Deepcore — drilling.bedrock-makes-no-progress. STUB: NOT YET AUTHORED.
//
// The bedrock border cannot be drilled
//
// A drill aimed into the bedrock border starts no cut and makes no progress,
// so the playable field cannot be dug out of sideways.
//
// Automated validation: stand the miner flush against the border column, hold
// the drill toward it and read the border cell unchanged.
//
// `test-case.toml` declares this suite as `drilling/bedrock-makes-no-progress.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (border (replay)) around the drive.

import { test } from "vitest";

test("The bedrock border cannot be drilled", () => {
  throw new Error(
    "Deepcore validator `drilling/bedrock-makes-no-progress` is declared in test-case.toml but has not been authored yet.",
  );
});
