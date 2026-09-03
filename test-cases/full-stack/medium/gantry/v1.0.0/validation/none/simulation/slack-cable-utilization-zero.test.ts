// simulation/slack-cable-utilization-zero — a cable that has gone slack reports
// utilization 0.
//
// specs/statics.md § Slack cables: "every cable whose force comes back negative
// goes slack, leaves the system entirely, and carries zero force", and
// § Utilization and breakage closes the readout with "a slack cable's
// utilization `0`". That last clause is the point: a cable has no compression
// capacity at all (specs/structure.md § Members: "`cable` ... none: a cable goes
// slack"), so a build that ran a slack cable through the compression branch of
// the utilization formula would be dividing by a capacity it does not have.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE WITH ONE MEMBER RE-MATERIALLED. Its
// mast at `(0, 8, 0)` is tied to all four top-flange nodes, and the tie from
// `(2, 4, 2)` stands in compression under the crane's own weight. Made a cable
// instead of a strut it is a cable the structure pushes on, so the first solve
// hands back a negative force and the iteration drops it. It is the only change:
// the mast keeps three ties spanning three directions, so the crane still stands
// and the check still reports every member — which is what lets this reading be
// about the slack cable rather than about a mechanism.
//
// The yard is emptied and no run is started: § Slack cables is a fact about a
// solve, and specs/structure.md § The static check runs the same two solves at
// the run-start posture with the bare hook at rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** The index in MINIMAL_CRANE of the mast tie from `(2, 4, 2)`. */
const TIE = 16;

/** The minimal crane with that one tie made a cable. */
const CABLE_TIE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with the mast tie from (2, 4, 2) made a cable",
  members: MINIMAL_CRANE.members.map(
    (member, index): DesignMember =>
      index === TIE ? [member[0], member[1], "cable"] : member,
  ),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports utilization 0 for a cable the solve sent slack", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CABLE_TIE);

  const result = await h.check();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertTrue(
    result.stable,
    "the crane to stand once the slack cable has left the system, so the " +
      "check reports every member (specs/structure.md § The static check)",
  );
  const reading = result.members.find((one) => one.id === TIE);
  assertDefined(
    reading,
    `the check to report member ${TIE}, the cable from (2, 4, 2) to (0, 8, 0)`,
  );
  assertEqual(
    reading?.utilization,
    0,
    "the utilization of a cable the solve sent slack, which carries zero " +
      "force and has no compression capacity to be measured against " +
      "(specs/statics.md § Utilization and breakage)",
  );
});
