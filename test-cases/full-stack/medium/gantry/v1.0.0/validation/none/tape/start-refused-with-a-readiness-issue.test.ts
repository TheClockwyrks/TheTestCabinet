// tape/start-refused-with-a-readiness-issue — a run does not begin on a structure
// that is not ready.
//
// `specs/program.md` § Starting and ending a run: "Starting is refused, with the
// issues listed and no run begun, when the structure has a readiness issue
// (`specs/structure.md`) or the tape is empty (`empty-program`)." The refusal
// leaves the run exactly as it stood: the idle placeholder `specs/state.md`
// fixes, phase `idle` at tick `0`.
//
// THE STRUCTURE IS REFUSED FOR ONE REASON AND THE TAPE IS NOT THE REASON. The
// crane is a leg from an anchor and a rail off the top of it, and it carries no
// slew ring, which `specs/structure.md` raises as `no-ring`. Its rails go
// unjudged — "the track is judged only on a crane that has one: with no ring the
// track rules go unchecked and `invalid-rail` is not raised" — and both members
// reach an anchor, so `disconnected-members` is not raised either. The tape
// carries a step, so `empty-program` is not among the issues and the refusal
// under test is the readiness one.
//
// THE START IS POSED RATHER THAN PRESSED. `startRun` "poses the `run` action: the
// same refusals" (`specs/instrumentation.md`), so a build whose `run` binding is
// broken fails the item that decides the binding rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * A crane with rails and no ring: `no-ring` and nothing else.
 *
 * A four-unit leg from the anchor at `(0, 0, 0)` and a horizontal four-unit rail
 * off the top of it. Both are inside site 1's envelope, both are within their
 * material's maximum length, and the pair costs `112` against a budget of `3000`.
 */
const NO_RING_CRANE: CraneDesign = {
  site: 0,
  name: "Ringless",
  ring: null,
  counterweights: [],
  members: [
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[0, 4, 0], [4, 4, 0], "rail"],
  ],
  tape: [],
};

/** A tape with something on it, so an empty one is not what refuses the start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins no run on a structure carrying a readiness issue", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, NO_RING_CRANE);
  await poseTape(h, TAPE);

  const issues = (await h.check()).issues;
  await h.debug.startRun();
  const after = await h.snapshot();

  await h.capture(
    "state",
    "The refused start on a structure that is not ready",
  );

  assertContains(
    issues,
    "no-ring",
    "the readiness issue this crane carries (specs/structure.md)",
  );
  assertEqual(
    after.run.phase,
    "idle",
    "run.phase after a start on a structure with a readiness issue: the start " +
      "is refused with no run begun (specs/program.md)",
  );
  assertEqual(
    after.run.tick,
    0,
    "run.tick after the refused start: nothing about the run changed " +
      "(specs/state.md)",
  );
});
