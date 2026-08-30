// Deepcore — movement.fits-a-one-tile-shaft. STUB: NOT YET AUTHORED.
//
// The miner passes down a shaft one tile wide
//
// The miner box is MINER_W (56) by MINER_H (72) against a TILE of 80, so it
// falls cleanly down a shaft one cell wide without catching on either side.
//
// Automated validation: clear one column for several rows with solid rock
// either side, drop the miner down it and hold the fall unobstructed to the
// bottom.
//
// `test-case.toml` declares this suite as `movement/fits-a-one-tile-shaft.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shaft (replay)) around the drive.

import { test } from "vitest";

test("The miner passes down a shaft one tile wide", () => {
  throw new Error(
    "Deepcore validator `movement/fits-a-one-tile-shaft` is declared in test-case.toml but has not been authored yet.",
  );
});
