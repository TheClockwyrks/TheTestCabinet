// tape/refused-start-leaves-the-player — a refused start leaves the player where
// they were.
//
// `specs/program.md` § Starting and ending a run: "Starting is refused, with the
// issues listed and no run begun, when the structure has a readiness issue …
// A refused start leaves the player where they were." The `run` action reaches
// the run from the build screen and from the program screen alike, so a refusal
// taken on the program screen leaves the program screen showing.
//
// THE START IS REFUSED FOR A READINESS ISSUE AND NOT FOR THE TAPE. The crane is a
// leg from an anchor and a rail off the top of it, carrying no slew ring, which
// `specs/structure.md` raises as `no-ring`; its rails go unjudged without a ring
// and both members reach an anchor, so that is the only issue it carries. The
// tape carries a step, so the run has something to run and the refusal is the
// structure's.
//
// THE SCREEN IS TAKEN TO `program` THROUGH THE SURFACE rather than by pressing
// the screen-switch binding: `setScreen` "shows the screen and sets nothing else"
// (`specs/instrumentation.md`), so a build whose `program` binding is broken
// fails the item that decides the binding rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

/** A crane with rails and no ring: `no-ring`, and no other issue. */
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

it("stays on the program screen when the start it takes is refused", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, NO_RING_CRANE);
  await poseTape(h, TAPE);

  await h.debug.setScreen("program");
  assertEqual(
    (await h.snapshot()).screen,
    "program",
    "the screen the player is standing on when they take the start",
  );

  await h.debug.startRun();
  const after = await h.snapshot();

  await h.capture("state", "The screen a refused start left the player on");

  assertEqual(
    after.run.phase,
    "idle",
    "run.phase after the start: this structure has a readiness issue, so the " +
      "start is refused and no run begins (specs/program.md)",
  );
  assertEqual(
    after.screen,
    "program",
    "the screen after the refused start: a refused start leaves the player " +
      "where they were (specs/program.md)",
  );
});
