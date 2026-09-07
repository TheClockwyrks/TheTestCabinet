// instrumentation/roll-press-changes-nothing — `rollPress` is a reading, and
// the game stands exactly as it stood after any number of calls.
//
// `specs/instrumentation.md`: "It lands no rock, spends no stamp, and leaves an
// arming `setNextRoll` made standing, so what `snapshot` reports is the same
// before and after a call." The run is posed with the three things a careless
// implementation would touch — a rock held on the cursor, a partly spent
// allowance, and an armed roll — and the whole snapshot is held across a run of
// calls.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { REFINEMENT_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** How many rolls are drawn. */
const ROLLS = 100;

/** A type and a tier to arm, so the arming is something a roll could clobber. */
const ARMED = { type: "discharge", quality: 4 } as const;

/** An anchor clear of the Substation's chain, its entry and its collector. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the snapshot as it was, held rock and arming included", async () => {
  await openYard(h, { refinement: REFINEMENT_MAX });
  // A drop leaves the next rock on the cursor, as `specs/scrap-press.md` makes
  // placement continuous, and spends one stamp of the allowance.
  await h.debug.placeRock(ANCHOR.col, ANCHOR.row);
  await h.debug.setNextRoll(ARMED.type, ARMED.quality);
  await h.advance(1);
  await captureStill(h, "unchanged");

  const before = await h.snapshot();
  assertEqual(before.held.active, true, "a rock held on the cursor to pose");
  assertDeepEqual(before.nextRoll, ARMED, "the arming to pose");

  for (let roll = 0; roll < ROLLS; roll += 1) await h.debug.rollPress();

  assertDeepEqual(
    await h.snapshot(),
    before,
    `the snapshot after ${ROLLS} calls of rollPress, against the one before ` +
      "(specs/instrumentation.md)",
  );
});
