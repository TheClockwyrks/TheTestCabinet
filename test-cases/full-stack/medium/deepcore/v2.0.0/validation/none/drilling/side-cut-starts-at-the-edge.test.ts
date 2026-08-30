// Deepcore — drilling.side-cut-starts-at-the-edge. STUB: NOT YET AUTHORED.
//
// A side cut begins at the tile edge, not on the keypress
//
// Pressing left or right in mid-cell walks the miner across the cell it stands
// in first, and the cut into the neighboring cell begins only once the miner
// box is flush against it, so lateral movement inside a wider tunnel is
// possible before committing to a dig.
//
// Automated validation: stand the miner mid-cell beside a posed solid cell,
// hold right, and read the neighboring cell health unchanged until the miner
// box reaches the cell face.
//
// `test-case.toml` declares this suite as `drilling/side-cut-starts-at-the-edge.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (walk-then-cut (replay)) around the drive.

import { test } from "vitest";

test("A side cut begins at the tile edge, not on the keypress", () => {
  throw new Error(
    "Deepcore validator `drilling/side-cut-starts-at-the-edge` is declared in test-case.toml but has not been authored yet.",
  );
});
