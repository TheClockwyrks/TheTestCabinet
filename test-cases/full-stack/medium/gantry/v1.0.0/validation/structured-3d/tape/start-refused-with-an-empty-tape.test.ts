// tape/start-refused-with-an-empty-tape — an empty tape refuses the start, as
// `empty-program`.
//
// `specs/program.md` § Starting and ending a run: "Starting is refused, with the
// issues listed and no run begun, when the structure has a readiness issue
// (`specs/structure.md`) or the tape is empty (`empty-program`)." A crane with
// nothing to run does not run.
//
// THE STRUCTURE IS READY, so the empty tape is the only thing that can refuse the
// start. The minimal crane stands ready on every site — a ring on a braced tower,
// one rail forming a valid track, every member connected — so `check()` reports
// `empty-program` and nothing else, which is what makes this reading about the
// tape rather than about the crane.
//
// THE START IS POSED RATHER THAN PRESSED. `startRun` "poses the `run` action: the
// same refusals" (`specs/instrumentation.md`), so a broken `run` binding fails
// the item that decides the binding rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins no run when the tape carries no step", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  const before = await h.snapshot();
  assertLength(before.program, 0, "the tape this run would have to run");

  const issues = (await h.check()).issues;
  await h.debug.startRun();
  const after = await h.snapshot();

  await h.capture("state", "The refused start on an empty tape");

  assertContains(
    issues,
    "empty-program",
    "the issue an empty tape raises against a start (specs/program.md)",
  );
  assertEqual(
    after.run.phase,
    "idle",
    "run.phase after a start on an empty tape: the start is refused with no " +
      "run begun (specs/program.md)",
  );
  assertEqual(
    after.run.tick,
    0,
    "run.tick after the refused start: nothing about the run changed " +
      "(specs/state.md)",
  );
});
