// Refract — cascade/cascade-back-to-title: back abandons the board and returns
// to the title.
//
// specs/modes/cascade.md "The sequence": `back` during `playing` abandons the
// board and returns to `title` with `CASCADE` highlighted (`menuIndex = 1`).
// That the sequence is really ENDED by it — a fresh one starting from tier 1
// afterwards — is cascade/cascade-restarts-fresh's point.
//
// One board is really solved first, so the run being abandoned holds progress
// a fresh one cannot. Every step is the player's own: the solve is the
// spec-derived solver's beams drawn through `trace`, NEXT BOARD goes through
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

it("returns to title with CASCADE highlighted", async () => {
  await resetTo(h, 1);
  await startCascade(h);

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
  captureStill(h, "abandoned");
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
});
