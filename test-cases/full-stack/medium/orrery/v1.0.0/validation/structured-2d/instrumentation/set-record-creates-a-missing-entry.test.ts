// instrumentation/set-record-creates-a-missing-entry — `setRecord` on a challenge
// with no record creates one.
//
// THE RULE. "`setRecord(mode, index, metric, value)` — Sets one record of one
// challenge ... A challenge with no record yet gains one whose other two metrics
// are `0`" (`specs/instrumentation.md`, Navigation and progress). The snapshot
// carries `<mode>.records` as "one entry per challenge", each
// `{ cost, cycles, area } | null`, and `reset` leaves every one of them empty:
// "all progress cleared, so nothing is solved, every record and stash is empty".
//
// THE CONFIGURATION. A reset session, so the challenge written to genuinely has
// no record: the check reads that its entry is `null` BEFORE writing, because an
// entry created from nothing and an entry that was already there are the same
// afterwards. One metric of one challenge is then set, and nothing else is posed:
// no challenge open, no machine, no run, and no other record anywhere.
//
// THE VERDICT. The entry is there, the metric named carries the posed figure, and
// the other two are `0` — not the figure, and not absent.

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

it("creates the entry with the posed metric and the other two at 0", async () => {
  await openTitle(h);
  assertNull(
    (await h.snapshot()).extras.records[2] ?? null,
    "a reset empties every record, so this challenge has none to update",
  );

  await h.debug.setRecord("extras", 2, "area", 12);
  await h.debug.setSolved("extras", 2, true);
  await openSelect(h, "extras");
  await captureStill(h, "created");

  const created = (await h.snapshot()).extras.records[2] ?? null;
  assertNotNull(
    created,
    "a challenge with no record gains one when a metric is set",
  );
  assertEqual(created?.area, 12, "the metric named carries the posed value");
  assertEqual(created?.cost, 0, "the other two metrics of a new entry are 0");
  assertEqual(created?.cycles, 0, "the other two metrics of a new entry are 0");
});
