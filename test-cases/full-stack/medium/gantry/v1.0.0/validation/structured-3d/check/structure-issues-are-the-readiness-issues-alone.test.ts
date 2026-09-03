// check/structure-issues-are-the-readiness-issues-alone — `structure.issues`
// carries the readiness issues alone and never `empty-program`.
//
// specs/instrumentation.md § Snapshot shape: "`structure.cost` and
// `structure.issues` are derived from the rules in `specs/structure.md`, so
// `issues` is empty exactly when the structure is READY", and "`structure.issues`
// and `checkResult.issues` are in the order `check` reports them".
// specs/structure.md § Readiness gives readiness as a property of the structure
// and the site alone, while `empty-program` is the tape's — the check reports
// both, "The issues that would refuse a run: the readiness issues above, and
// `empty-program` for an empty tape".
//
// TWO READINGS, ONE WITH NOTHING TO SAY AND ONE WITH SOMETHING. First a ready
// crane with an empty tape: `structure.issues` is empty while the check's reads
// `empty-program`, which is exactly the difference between the two fields.
// Then the ring is taken off — a removal the editor always allows — and the crane
// has readiness issues to report: `structure.issues` reads what the check reads
// with `empty-program` taken out, in the same order.
//
// Neither reading runs the `check` ACTION. `structure.issues` is derived state
// the snapshot always reports, and the `check` reading "is pure ... it displays
// nothing", so nothing here needs the build screen to have been asked anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  standMinimalCrane,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the readiness issues alone, with empty-program only in the check", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  const ready = await h.snapshot();
  assertLength(
    ready.structure.issues,
    0,
    "structure.issues of a ready crane: empty exactly when the structure is " +
      "ready, whatever the tape holds (specs/instrumentation.md)",
  );
  assertDeepEqual(
    (await h.check()).issues,
    ["empty-program"],
    "the check's issues for that same crane with an empty tape: the tape's " +
      "issue, which is not the structure's (specs/structure.md)",
  );

  await h.debug.clearRing();

  const ringless = await h.snapshot();
  const checked = (await h.check()).issues;
  assertGreaterThan(
    checked.filter((issue) => issue !== "empty-program").length,
    0,
    "the readiness issues of a crane whose ring has been taken off " +
      "(specs/structure.md)",
  );
  assertDeepEqual(
    ringless.structure.issues,
    checked.filter((issue) => issue !== "empty-program"),
    "structure.issues against the check's issues less `empty-program`: the " +
      "readiness issues the check reports, in the same order, with the " +
      "tape's issue absent (specs/instrumentation.md)",
  );

  await h.advance(1);
  await h.capture(
    "structure-issues",
    "the readiness issues the structure reports on its own",
  );
});
