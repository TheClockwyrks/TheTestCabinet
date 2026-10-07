// instrumentation/set-record — `setRecord` sets one metric of one challenge.
//
// THE RULE. "`setRecord(mode, index, metric, value)` — Sets one record of one
// challenge. `metric` is `"cost"`, `"cycles"`, or `"area"`, and `value` is a
// whole number of at least `0`" (`specs/instrumentation.md`, Navigation and
// progress). ONE record of ONE challenge: "Each pose sets one thing and leaves
// the rest of the game as it stands, so a caller that wants several things
// arranged makes several calls." The snapshot carries them as `<mode>.records`,
// "one entry per challenge", each `{ cost, cycles, area } | null`.
//
// The three metrics are the ones `specs/modes/campaign.md` keeps per challenge —
// "the lowest `cost`, the lowest `cycles`, and the lowest `area` ... each metric
// independently" — and a solved row is where they are read: "A solved row also
// shows its three records, `cost`, `cycles`, and `area`, each figure drawn beside
// a label naming its metric." That
// drawing is this item's EVIDENCE; the verdict is the records the snapshot
// reports, which is what the row is drawn from. How a build labels and formats a
// figure is the build's, and no sentence of `specs/` fixes it.
//
// THE CONFIGURATION. A reset session, in which two Extras challenges are given a
// full set of three records apiece, with six distinct figures so no two can be
// confused, and both are marked solved so the rows show them. One metric of the
// first is then set again. Nothing else is posed: no challenge open, no machine,
// no run.
//
// THE VERDICT. The metric named carries the figure posed last; the other two
// metrics of that challenge, every metric of the neighbouring challenge, and the
// untouched challenges' `null` entries all stand as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the named metric alone and leaves every other record standing", async () => {
  await openTitle(h);
  await h.debug.setRecord("extras", 0, "cost", 120);
  await h.debug.setRecord("extras", 0, "cycles", 34);
  await h.debug.setRecord("extras", 0, "area", 9);
  await h.debug.setRecord("extras", 1, "cost", 7);
  await h.debug.setRecord("extras", 1, "cycles", 88);
  await h.debug.setRecord("extras", 1, "area", 51);
  await h.debug.setSolved("extras", 0, true);
  await h.debug.setSolved("extras", 1, true);

  await h.debug.setRecord("extras", 0, "cycles", 21);

  await openSelect(h, "extras");
  await captureStill(h, "record");

  const posed = await h.snapshot();
  const first = posed.extras.records[0] ?? null;
  const second = posed.extras.records[1] ?? null;
  assertNotNull(first, "the challenge that was given records reports an entry");
  assertNotNull(
    second,
    "the neighbouring challenge that was given records reports an entry",
  );
  assertEqual(
    first?.cycles,
    21,
    "setRecord(extras, 0, cycles, 21) sets that challenge's cycles record",
  );
  assertEqual(
    first?.cost,
    120,
    "the cost record of the same challenge stands as it was",
  );
  assertEqual(
    first?.area,
    9,
    "the area record of the same challenge stands as it was",
  );
  assertEqual(second?.cost, 7, "the next challenge's cost record stands");
  assertEqual(second?.cycles, 88, "the next challenge's cycles record stands");
  assertEqual(second?.area, 51, "the next challenge's area record stands");
  assertNull(
    posed.extras.records[2] ?? null,
    "a challenge no setRecord named still reports no record at all",
  );
  assertNull(
    posed.campaign.records[0] ?? null,
    "and the other mode's records are untouched by an Extras record",
  );
});
