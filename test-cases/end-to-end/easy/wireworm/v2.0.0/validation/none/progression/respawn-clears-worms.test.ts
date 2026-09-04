// progression/respawn-clears-worms — a lost life takes every worm off the board.
//
// `specs/progression.md`, Losing a life, step 2: "Every worm, every foe, and
// every bolt in flight is removed from the board." Not the worm that reached the
// cursor — every worm.
//
// So the board carries TWO worms: the segment standing in the cursor's box,
// which is what costs the life, and one standing well clear of it, which is what
// the rule is read on. Both are single segments with their step faculty off, so
// neither can wander into or out of the scenario, and the second one is on the
// board because the requirement is about it — a build that removes only the worm
// it collided with leaves one behind and answers `1`, a build that removes
// nothing answers `2`, and a correct build answers `0`.
//
// The roster is read during the `respawn` phase, which is where
// `specs/progression.md` puts the board this rule describes; that the phase is
// `respawn` at all is asserted first, as the precondition it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/**
 * The tile the bystander worm stands on: mid-board, clear of the entry row, of
 * the player band, and of the column the contact happens in.
 */
const BYSTANDER = { c: 5, r: 5 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties the worm roster on the lost life", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: BYSTANDER.c,
    r: BYSTANDER.r,
    length: 1,
    stepping: false,
  });

  await contactCursor(h);

  await captureStill(h, "respawn");
  const after = await h.snapshot();
  assertEqual(
    after.phase,
    "respawn",
    "precondition: the contact opened the respawn (specs/progression.md)",
  );
  assertLength(after.worms, 0, "the worms left on the board");
});
