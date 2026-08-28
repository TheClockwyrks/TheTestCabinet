// instrumentation/surface-present — the debug and automation surface is present.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Every operation specs/instrumentation.md names is present as a function on
// the surface — reached on the page as window.__fathom in an engineless build
// and off engine.debug in an engine build — version reports
// FATHOM_DEBUG_VERSION (1), and the surface is live: setMaze poses a board,
// setForagerTile moves the forager onto it, and both the snapshot and the
// rendered canvas change.

import { it } from "vitest";

it("The debug and automation surface is present", () => {
  throw new Error(
    "validation/simple-2d/instrumentation/surface-present.test.ts: not implemented",
  );
});
