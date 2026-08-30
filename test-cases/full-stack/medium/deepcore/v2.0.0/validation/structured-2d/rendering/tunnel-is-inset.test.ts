// Deepcore — rendering.tunnel-is-inset. STUB: NOT YET AUTHORED.
//
// A carved tunnel is drawn narrower than its cell
//
// A carved cell is drawn inset with a lip of the band dirt around it, so the
// open passage is narrower than the full cell and the cell border pixels are
// not the tunnel fill.
//
// Automated validation: clear one cell surrounded by rock and sample the drawn
// cell at its border and at its center, holding the border unlike the center
// fill.
//
// `test-case.toml` declares this suite as `rendering/tunnel-is-inset.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (inset (image)) around the drive.

import { test } from "vitest";

test("A carved tunnel is drawn narrower than its cell", () => {
  throw new Error(
    "Deepcore validator `rendering/tunnel-is-inset` is declared in test-case.toml but has not been authored yet.",
  );
});
