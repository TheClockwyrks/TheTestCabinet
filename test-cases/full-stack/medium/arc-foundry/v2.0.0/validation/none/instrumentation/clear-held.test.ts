// instrumentation/clear-held — putting the cursor's rock away costs nothing and
// touches nothing else.
//
// THE REQUIREMENT. `specs/instrumentation.md`: "`clearHeld` empties the cursor,
// so `held` reads `{ active: false, col: 0, row: 0, legal: false }` and the build
// panel shows the inspector again. ... It spends no stamp, refunds none, changes
// no other state, and does nothing when nothing is held."
//
// WHY IT IS ITS OWN POINT, AND NOT THE `back` KEY'S. `specs/scrap-press.md` makes
// placement continuous — "a drop does not clear the hand: while stamps remain,
// the press arms another rock on the cursor immediately" — so every scenario that
// places a rock and is about anything else has a rock on the cursor it never
// asked for, and this is the operation that puts it away. `input/back-held-rock`
// decides the player's control that does the same thing; a build can get either
// one right on its own.
//
// HOW IT IS DECIDED. A rock is armed through the press, put away, and four things
// are read: the cursor is at its resting record, the stamp allowance is untouched
// either way, the selection is where it was, and the yard stands what it stood.
// Then it is called again with nothing held, which must do nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { STAMPS_PER_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  standComponent,
  type Harness,
} from "../harness";

/** The resting record `held` reports when no rock is on the cursor. */
const AT_REST = { active: false, col: 0, row: 0, legal: false };

/** An anchor clear of the Substation's chain, its entry and its collector. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the cursor, spending no stamp and moving nothing else", async () => {
  await openYard(h);
  const standing = await standComponent(
    h,
    "capacitor",
    2,
    ANCHOR.col,
    ANCHOR.row,
  );
  await h.debug.select(standing);

  await pressAction(h, "stamp");
  const armed = await h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    "a rock on the cursor before it is put away (specs/scrap-press.md)",
  );

  await h.debug.clearHeld();
  await captureStill(h, "cleared");
  const cleared = await h.snapshot();

  assertDeepEqual(
    cleared.held,
    AT_REST,
    "snapshot().held after clearHeld, which empties the cursor " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    cleared.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamp allowance after clearHeld, which spends none and refunds none " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    cleared.selected,
    standing,
    "the selection after clearHeld, which changes no other state " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    cleared.structures,
    1,
    "the structures on the yard after clearHeld, which stands none up and " +
      "removes none (specs/instrumentation.md)",
  );

  // And again with nothing held, which "does nothing when nothing is held".
  await h.debug.clearHeld();
  const again = await h.snapshot();
  assertDeepEqual(
    again.held,
    AT_REST,
    "snapshot().held after a second clearHeld with nothing on the cursor",
  );
  assertEqual(
    again.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamp allowance after a clearHeld with nothing held, which does " +
      "nothing (specs/instrumentation.md)",
  );
});
