// instrumentation/clear-held — `clearHeld` empties the cursor and changes nothing
// else.
//
// `specs/instrumentation.md`: "`clearHeld` empties the cursor, so `held` reads
// `{ active: false, col: 0, row: 0, legal: false }` and the build panel shows the
// inspector again. It spends no stamp, refunds none, changes no other state, and
// does nothing when nothing is held."
//
// WHY IT IS A POINT OF ITS OWN. `specs/scrap-press.md` makes placement continuous —
// "a drop does not clear the hand: while stamps remain, the press arms another rock
// on the cursor immediately" — so almost every scenario in this project that stands
// a candidate up has a rock on the cursor it never asked for, and puts it away with
// this operation. A build whose `clearHeld` refunds the stamp, or clears the
// selection with it, moves a figure under every one of those checks.
//
// WHAT IS DECIDED. That a held rock is put away, that the allowance is exactly
// where the drop left it, that the selection and the arming are untouched, and that
// an empty hand is left empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** The resting record `held` reports when no rock is on the cursor. */
const HELD_AT_REST = { active: false, col: 0, row: 0, legal: false };

/** Where the rock is dropped, and where the selected component stands. */
const ROCK = { col: 20, row: 20 };
const SELECTED = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts a held rock away, spending no stamp and touching nothing else", async () => {
  openYard(h);
  const component = standComponent(
    h,
    "capacitor",
    2,
    SELECTED.col,
    SELECTED.row,
  );
  h.debug.select(component);
  h.debug.setNextRoll("coil", 3);

  const before = h.snapshot();

  // A drop arms the next rock on the cursor, because placement is continuous.
  h.debug.placeRock(ROCK.col, ROCK.row);
  const dropped = h.snapshot();
  assertEqual(
    dropped.held.active,
    true,
    "a rock on the cursor after a drop that left stamps in the allowance " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    dropped.stampsLeft,
    before.stampsLeft - 1,
    "the allowance after one drop (specs/scrap-press.md)",
  );

  h.debug.clearHeld();
  const cleared = h.snapshot();
  captureStill(h, "cleared");

  assertDeepEqual(
    cleared.held,
    HELD_AT_REST,
    "snapshot().held after clearHeld (specs/instrumentation.md)",
  );
  assertEqual(
    cleared.stampsLeft,
    dropped.stampsLeft,
    "the allowance after clearHeld, which spends no stamp and refunds none " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    cleared.selected,
    dropped.selected,
    "the selection after clearHeld, which changes no other state",
  );
  assertDeepEqual(
    cleared.nextRoll,
    dropped.nextRoll,
    "the press's arming after clearHeld",
  );
  assertEqual(
    cleared.structures.length,
    dropped.structures.length,
    "the structures on the yard after clearHeld",
  );

  // And an empty hand is left empty.
  h.debug.clearHeld();
  const again = h.snapshot();
  assertDeepEqual(
    again.held,
    HELD_AT_REST,
    "snapshot().held after clearHeld with nothing held",
  );
  assertEqual(
    again.stampsLeft,
    cleared.stampsLeft,
    "the allowance after clearHeld with nothing held, which does nothing " +
      "(specs/instrumentation.md)",
  );
});
