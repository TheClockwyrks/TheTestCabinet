// instrumentation/snapshot-shape — snapshot reports the full documented shape.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// In live play on a posed board carrying a drifter, a pulse in flight, an ink
// cloud, and one predator of each kind, the snapshot reports every field
// specs/state.md lists with its documented type — the screen, depth, score,
// lives, muted, creatureAI, planktonRemaining, brightness, visionRadius, the
// sonar and ink pairs, the grid block, tiles, visibility, the forager block,
// drifters, one predators entry per predator with every per-kind field present
// or null, pulses, inkClouds and simTime — with tiles and visibility both
// GRID_ROWS (18) strings of GRID_COLS (36) characters and every tile
// coordinate agreeing with the position it is derived from.

import { it } from "vitest";

it("Snapshot reports the full documented shape", () => {
  throw new Error(
    "validation/structured-2d/instrumentation/snapshot-shape.test.ts: not implemented",
  );
});
