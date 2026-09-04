// Refract — cascade/cascade-restarts-fresh: starting Cascade again begins a
// fresh sequence.
//
// specs/modes/cascade.md "The sequence": backing out of `playing` ends the
// sequence, and starting Cascade again begins a fresh one from tier 1 — entry
// itself sets `solvedCount` to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// To make the freshness observable, one board is really solved first, so the
// count being abandoned is 1 rather than the 0 a fresh sequence would show
// anyway. Every step is the player's own: the solve is the spec-derived
// solver's beams drawn through `trace`, NEXT BOARD and the re-entry go through
// the registered actions, and `back` is the real Escape edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  solveGenerated,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-entering after a back starts from solvedCount 0 and tier 1", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  // One real solve, then NEXT BOARD, so the sequence being abandoned holds
  // progress a fresh one cannot.
  await solveGenerated(h, 1);
  await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
  assertEqual(
    h.snapshot().solvedCount,
    1,
    "one board is recorded solved before backing out (precondition)",
  );

  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Starting Cascade again begins a fresh sequence. The return already
  // highlights CASCADE, so a plain `confirm` takes it.
  await tapAction(h, "confirm");
  const fresh = h.snapshot();
  captureStill(h, "fresh");
  assertEqual(
    fresh.screen,
    "playing",
    "choosing CASCADE again puts a board in play (specs/modes/cascade.md)",
  );
  assertEqual(
    fresh.solvedCount,
    0,
    "the new sequence starts from solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the new sequence starts from tier 1");
});
