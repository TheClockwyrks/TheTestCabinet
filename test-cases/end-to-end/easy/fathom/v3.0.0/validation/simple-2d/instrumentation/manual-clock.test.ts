// instrumentation/manual-clock — the game holds still on the driver's clock.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The other half of the deterministic-core contract: with the simulation taken
// off the wall clock, nothing advances between steps — simTime does not move
// and no predator moves over a second of real time — while a step of n ticks
// advances simTime by exactly n * TICK_DT (1/120 s) within one tick, and
// covering one second of game time as one step and as sixty steps leaves
// simTime the same either way.

import { it } from "vitest";

it("The game holds still on the driver's clock", () => {
  throw new Error(
    "validation/simple-2d/instrumentation/manual-clock.test.ts: not implemented",
  );
});
