// progression/respawn-clears-foes — a lost life takes every foe off the board.
//
// `specs/progression.md`, Losing a life, step 2: "Every worm, every foe, and
// every bolt in flight is removed from the board." This is the foe half of that
// clause; the worm half is `progression/respawn-clears-worms`.
//
// The life is lost to a worm segment rather than to the foe, deliberately. A foe
// that cost the life and then vanished would leave a build that removes only the
// thing it collided with indistinguishable from one that clears the roster, and
// the rule being read is the second. So the foe stands well clear of the cursor,
// and it stands with both of its faculties off: `setFoeMind(false)` so it does
// nothing to the field it is parked on and `setFoeTravel(false)` so it does not
// move — neither faculty is any part of this requirement, and a glitch left to
// itself darts and descends (`specs/foes.md`).
//
// A build that clears the roster answers `0`; one that removes only what it
// collided with, or nothing at all, answers `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** The tile the foe is parked on: mid-board, far from the cursor's band. */
const BYSTANDER = { c: 8, r: 6 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties the foe roster on the lost life", async () => {
  await startPlaying(h);
  await poseFoe(h, "glitch", BYSTANDER.c, BYSTANDER.r, {
    mind: false,
    travel: false,
  });

  await contactCursor(h);

  await captureStill(h, "respawn");
  const after = await h.snapshot();
  assertEqual(
    after.phase,
    "respawn",
    "precondition: the contact opened the respawn (specs/progression.md)",
  );
  assertLength(after.foes, 0, "the foes left on the board");
});
