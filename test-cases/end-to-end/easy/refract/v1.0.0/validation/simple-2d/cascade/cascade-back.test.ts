// Refract — cascade/cascade-back: back abandons the board and ends the
// sequence.
//
// specs/modes/cascade.md "The sequence": `back` during `playing` abandons the
// board and returns to `title` with `CASCADE` highlighted (`menuIndex = 1`),
// ending the sequence — starting Cascade again
// begins a fresh one from tier 1. To make the freshness observable, one board
// is really solved first, so the count being abandoned is 1 rather than the 0
// a fresh sequence would show anyway. Every step is the player's own: the
// solve is the spec-derived solver's beams drawn through `trace`, NEXT BOARD
// and the re-entry go through the registered actions, and `back` is the real
// Escape edge.

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

it("returns to title on back, and re-entry begins a fresh sequence", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  // One real solve, then NEXT BOARD, so the sequence being abandoned holds
  // progress a fresh one cannot.
  await solveGenerated(h, 1);
  await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
  assertEqual(
    h.snapshot().screen,
    "playing",
    "NEXT BOARD returns to playing (precondition for the back edge)",
  );
  assertEqual(
    h.snapshot().solvedCount,
    1,
    "one board is recorded solved before backing out (precondition)",
  );

  // back during playing abandons the board and returns to title.
  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "title",
    "back during playing returns to title (specs/modes/cascade.md)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "with CASCADE, the entry that led away, highlighted",
  );

  // Starting Cascade again begins a fresh sequence. The return already
  // highlights CASCADE, so a plain `confirm` takes it.
  await tapAction(h, "confirm");
  const fresh = h.snapshot();
  assertEqual(
    fresh.screen,
    "playing",
    "choosing CASCADE again puts a board in play (specs/modes/cascade.md)",
  );
  captureStill(h, "fresh");
  assertEqual(
    fresh.solvedCount,
    0,
    "the new sequence starts from solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the new sequence starts from tier 1");
});
