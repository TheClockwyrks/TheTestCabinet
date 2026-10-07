// instrumentation/waste-visible-count-follows-newest — `wasteVisibleCount` is the
// newest set's count, and `0` when the memory is empty.
//
// THE RULE. `specs/instrumentation.md`, The waste's sets: "`wasteVisibleCount` is
// the newest set's count, and `0` when the memory is empty." The snapshot shape
// lists it among the five entries "built at the call rather than read off a field
// of their own", from "The newest entry of `wasteSets`, and `0` when `wasteSets`
// is empty".
//
// WHY IT IS ITS OWN POINT. It is a DERIVED reading rather than either of the two
// operations on the memory, so a build can append correctly
// (`instrumentation/waste-set-appends`), empty correctly
// (`instrumentation/waste-sets-clear`) and still derive the shown count wrongly —
// and what the count decides is which cards the waste shows a player
// (`specs/stock.md`), which is the whole of Draw Three's fan.
//
// THE FIGURES ARE CHOSEN SO EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. Six
// cards on the waste, then a set of two and a set of three. `3` is the rule; `2`
// is a build reporting the OLDEST set; `5` is a build summing the memory; `6` is
// a build reporting the whole pile; and `0` is a build that reads no memory at
// all. The cards the sets do not reach are the buried remainder, which is a state
// `specs/stock.md` defines rather than an accident.
//
// BOTH ENDS OF THE RULE ARE READ: the empty memory before any set is appended,
// and the emptied memory after the sets are cleared, so a build that reports the
// pile's length whenever the memory is empty is caught at both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The cards laid on the waste, bottom card first. Six, so no wrong model reads 6. */
const WASTE = ["2C", "3D", "4S", "5H", "6D", "7C"] as const;

/** The two sets appended, oldest first. */
const OLDEST_SET = 2;
const NEWEST_SET = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the newest set's count, and 0 on an empty memory", async () => {
  await openTable(h);
  // Laid with no sets: a waste whose memory is empty is a state
  // `specs/stock.md` defines, and it is what the first reading below is of.
  await poseWaste(h, cards(...WASTE), []);

  // Each reading is taken with no frame between it and the pose before it.
  const bare = await h.snapshot();
  await h.debug.addWasteSet(OLDEST_SET);
  const one = await h.snapshot();
  await h.debug.addWasteSet(NEWEST_SET);
  const two = await h.snapshot();
  await h.debug.clearWasteSets();
  const cleared = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing derivation still leaves the picture of
  // the waste it was read off.
  await captureStill(h, "waste");

  assertEqual(
    bare.wasteVisibleCount,
    0,
    `snapshot().wasteVisibleCount on a waste of ${WASTE.length} cards whose ` +
      `set memory is empty, which the specification fixes at 0`,
  );
  assertEqual(
    one.wasteVisibleCount,
    OLDEST_SET,
    `snapshot().wasteVisibleCount with one set of ${OLDEST_SET} in the memory`,
  );
  assertEqual(
    two.wasteVisibleCount,
    NEWEST_SET,
    `snapshot().wasteVisibleCount with sets [${OLDEST_SET}, ${NEWEST_SET}] on ` +
      `a waste of ${WASTE.length} cards — it is the NEWEST set's count, so ` +
      `${OLDEST_SET} is the oldest, ${OLDEST_SET + NEWEST_SET} is the memory ` +
      `summed and ${WASTE.length} is the whole pile`,
  );
  assertEqual(
    cleared.wasteVisibleCount,
    0,
    "snapshot().wasteVisibleCount once the memory has been emptied",
  );
});
