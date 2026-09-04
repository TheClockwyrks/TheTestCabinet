// press/cancel-is-free — putting a held rock away spends no stamp.
//
// The roll happens only on a successful drop (`specs/scrap-press.md`), so there
// is nothing to pay for until the rock lands: a player who pulls the press, looks
// at the yard and changes their mind has spent nothing. A build that charges on
// the pull turns a look at the board into a cost, and the five-per-level
// allowance into something the player has to ration by not thinking.
//
// The reading is the state after the cancel: the hand empty, the allowance whole,
// and nothing on the yard.
//
// THE CANCEL IS THE PLAYER'S ACT, so it is made through the player's control:
// `back` "puts a held rock away" (`specs/controls.md`) and is the only way a
// player has of doing it. The surface's own `clearHeld` empties the cursor too,
// but a check that used it would be reading what the debug pose costs rather than
// what the cancel costs, which is what `specs/scrap-press.md` fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { STAMPS_PER_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a held rock away with the allowance whole and the yard empty", async () => {
  await openYard(h);

  await pressAction(h, "stamp");
  const armed = await h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    "the rock the press armed on the cursor",
  );

  await pressAction(h, "back");
  const cancelled = await h.snapshot();
  await captureStill(h, "cancel");

  assertEqual(
    cancelled.held.active,
    false,
    "the held rock after it was put away",
  );
  assertEqual(
    cancelled.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamps left after a cancelled rock, which spends none",
  );
  assertLength(
    cancelled.structures,
    0,
    "the structures on the yard after a cancelled rock",
  );
});
