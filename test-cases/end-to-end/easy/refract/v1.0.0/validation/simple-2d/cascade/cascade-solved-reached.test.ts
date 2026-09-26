// Refract — cascade/cascade-solved-reached: solving a cascade board goes to
// the solved screen.
//
// specs/modes/cascade.md "The solved screen": on solving, the game moves to
// `solved` with `menuIndex` 0, and the finished board is left exactly as the
// player drew it, every beam complete. What the screen DRAWS over that board is
// cascade/cascade-solved-copy's point.
//
// The scenario enters Cascade for real and poses its board through `loadBoard`
// — "a board posed this way is a board like any other"
// (specs/instrumentation.md) — so this point stops depending on the generator,
// which the cascade/generated-* and cascade/tier-* points decide on their own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  startCascade,
  traceRoute,
  type Harness,
} from "../harness";

/** The forced GEO_3X3 solve: T(0,0) — t(1,1) — T(2,2) (fixtures.ts). */
const GEO_3X3_ROUTE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solving moves to solved with the first choice highlighted", async () => {
  await resetTo(h);
  await startCascade(h);

  await loadBoard(h, GEO_3X3);
  traceRoute(h, GEO_3X3_ROUTE);
  await h.advance(1);
  captureStill(h, "solved");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "solved",
    "solving a board goes to solved (specs/modes/cascade.md)",
  );
  assertEqual(snapshot.menuIndex, 0, "menuIndex is 0 on arriving at solved");

  // The finished board behind it is left as it was drawn: every beam complete.
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    if (beam === undefined) continue;
    assertEqual(beam.complete, true, `the ${channel} beam behind the screen`);
  }
});
