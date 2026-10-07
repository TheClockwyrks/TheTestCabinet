// press/cancel-is-free — putting a held rock away spends no stamp.
//
// The roll happens only on a successful drop (`specs/scrap-press.md`), so there
// is nothing to pay for until the rock lands: a player who pulls the press, looks
// at the yard and changes their mind has spent nothing. A build that charges on
// the pull turns a look at the board into a cost, and the five-per-level
// allowance into something the player has to ration by not thinking.
//
// The rock is put away the way a player puts it away, with the `back` action at
// the engine's own input surface, because the surface carries no key operation
// under this engine.
//
// The reading is the state after the cancel: the hand empty, the allowance whole,
// and nothing on the yard.

import { afterEach, beforeEach, it } from "vitest";
import { STAMPS_PER_LEVEL } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cancelHeldWithBack,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a held rock away with the allowance whole and the yard empty", async () => {
  openYard(h);

  await pressAction(h, "stamp");
  const armed = h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    "the rock the press armed on the cursor",
  );

  await cancelHeldWithBack(h);
  const cancelled = h.snapshot();
  captureStill(h, "cancel");

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
