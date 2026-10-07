// campaign/fresh-course-nothing-solved — a build that has just loaded has solved
// nothing and holds no record.
//
// THE RULE. Progress begins empty: "Completing a challenge again is a replay. Each
// challenge keeps its records: the lowest `cost`, the lowest `cycles`, and the
// lowest `area` over the session's completed runs of it"
// (`specs/modes/campaign.md`, Progression) — over the SESSION's completed runs, of
// which a freshly loaded build has none. `specs/instrumentation.md` writes the
// same state down twice: `reset` restores the game so that "nothing is solved,
// every record and stash is empty", and the snapshot shape declares
// `campaign.solved` as "ascending indices" and `campaign.records` as
// "`[{ cost, cycles, area } | null]`", "one entry per challenge".
//
// SO THE READING IS TWO THINGS. `campaign.solved` is empty, and `campaign.records`
// holds one entry per challenge with every one of them `null`. The length is read
// as well as the entries, because "every entry is null" is true of no entries at
// all: a build whose `records` is an empty list would otherwise pass a point about
// what it holds.
//
// THE WORLD IS THE ONE THE BUILD LOADED WITH, for the reason
// `fresh-course-opens-one-unlocked` gives: nothing is posed before the reading, so
// what is read is the session a player is handed rather than the session `reset`
// rebuilt.
//
// THE VERDICT. `campaign.solved` is `[]`, `campaign.records` holds
// `campaign.count` entries, and every one of them is `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a freshly loaded course with nothing solved and no records", async () => {
  const fresh = await h.snapshot();

  await openSelect(h, "campaign");
  await captureStill(h, "fresh");

  assertDeepEqual(
    fresh.campaign.solved,
    [],
    "a freshly loaded build has completed no run, so nothing is solved",
  );
  assertLength(
    fresh.campaign.records,
    fresh.campaign.count,
    "campaign.records holds one entry per challenge of the course",
  );
  assertDeepEqual(
    fresh.campaign.records,
    fresh.campaign.records.map(() => null),
    "every record of a freshly loaded course is null, because no run of any " +
      "challenge has been completed this session",
  );
});
