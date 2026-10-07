// instrumentation/next-saucer-row — `setNextSaucerRow` decides the row the next
// arrival enters at, and the arrival consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextSaucerRow(y)`
// "poses the row, in logical units, the next saucer the game's own cadence
// brings in enters at", reported as `nextSaucerRow`, and the arrival consumes
// it.
//
// TWO ROWS, neither the field's middle nor an end of the range `specs/saucer.md`
// draws from, so a build that ignores the pose and draws cannot land on both by
// luck. The arrival is caught on the tick it is first reported, and
// `specs/saucer.md` has a saucer enter "with no vertical component" and reroll
// its weave only "one full interval after it enters", so the row it is read on
// IS the row it entered on, to the precision of a number read off the state.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { closeUpArrival, openSaucerGame } from "../saucer/cadence";

/** The two rows posed, each on a fresh game. */
const ROWS = [123, 597] as const;

/** The decimal places the row is read back to: exactly. */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings the next arrival in on the posed row and consumes the pose", async () => {
  for (const [index, row] of ROWS.entries()) {
    openSaucerGame(h);
    h.debug.setNextSaucerRow(row);
    assertCloseTo(
      h.snapshot().nextSaucerRow ?? Number.NaN,
      row,
      READ_BACK_DIGITS,
      `setNextSaucerRow(${row}) read back before the arrival ` +
        "(specs/instrumentation.md)",
    );

    const arrival = await closeUpArrival(h, null);
    if (index === 0) captureStill(h, "posed");

    assertCloseTo(
      arrival.saucer.y,
      row,
      READ_BACK_DIGITS,
      `the row the saucer posed onto row ${row} first stood on ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      arrival.snapshot.nextSaucerRow,
      null,
      `nextSaucerRow once the arrival posed onto row ${row} has consumed it ` +
        "(specs/instrumentation.md)",
    );
  }
});
