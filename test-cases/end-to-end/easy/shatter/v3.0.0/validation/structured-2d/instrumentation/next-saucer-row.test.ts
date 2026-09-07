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
// luck. The arrival is brought on with a posed due, and `specs/saucer.md` has a
// saucer enter "with no vertical component" and reroll its weave only "one full
// interval after it enters", so the row it is read on — up to one marched frame
// after the arrival, a fifteenth of a second — IS the row it entered on, to the
// precision of a number read off the state.

import { afterEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  closeUpArrival,
  createMarchHarness,
  openQuietGame,
} from "../saucer/visits";

/** The two rows posed, each on a fresh game. */
const ROWS = [123, 597] as const;

/** The decimal places the row is read back to: exactly. */
const READ_BACK_DIGITS = 6;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("brings the next arrival in on the posed row and consumes the pose", async () => {
  for (const [index, row] of ROWS.entries()) {
    const h = await createMarchHarness();
    harnesses.push(h);
    await openQuietGame(h);
    h.debug.setNextSaucerRow(row);
    assertCloseTo(
      h.snapshot().nextSaucerRow ?? Number.NaN,
      row,
      READ_BACK_DIGITS,
      `setNextSaucerRow(${row}) read back before the arrival ` +
        "(specs/instrumentation.md)",
    );

    const arrival = await closeUpArrival(h);
    const consumed = h.snapshot().nextSaucerRow;
    if (index === 0) {
      await h.paint();
      captureStill(h, "posed");
    }

    assertCloseTo(
      arrival.y,
      row,
      READ_BACK_DIGITS,
      `the row the saucer posed onto row ${row} first stood on ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      consumed,
      null,
      `nextSaucerRow once the arrival posed onto row ${row} has consumed it ` +
        "(specs/instrumentation.md)",
    );
  }
});
