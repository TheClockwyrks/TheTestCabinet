// check/issue-no-ring-suppresses-rail-rules — with no ring the track rules go
// unchecked.
//
// specs/structure.md § The trolley and the rail: "The last two rules speak of
// the arm and the slew axis, and a crane without a ring has neither, so the
// track is judged only on a crane that has one: with no ring the track rules go
// unchecked and `invalid-rail` is not raised." § Readiness says the same from
// the row: "`invalid-rail` — The crane HAS A RING and rail members, and they
// break one of the track rules above."
//
// The scenario makes the suppression bite by laying rails that would break the
// rules loudly if they were judged: two rails that are neither collinear nor
// connected to one another, one along `y = 2, z = 0` and one along `y = 4,
// z = 2`. Each is stood on a pair of the site's ground anchors so nothing is
// disconnected and the only readiness row the crane earns is the missing ring.
// A build that judged the track without a ring would raise `invalid-rail` here
// on the collinearity rule alone.
//
// No ring is placed, so `poseCrane` places none: the crane reaches the check
// having never had one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** Two rails on two lines, each stood on the site's anchors, and no ring at all. */
const RINGLESS_RAILS: CraneDesign = {
  site: 0,
  name: "Ringless rails",
  ring: null,
  counterweights: [],
  members: [
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 2, 0], [2, 2, 0], "rail"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 2], [2, 4, 2], "rail"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no-ring and not invalid-rail however the rails lie", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RINGLESS_RAILS);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture(
    "state",
    "two rails on two lines, on a crane that carries no slew ring",
  );

  assertContains(
    issues,
    "no-ring",
    "the issue a crane with no slew ring raises (specs/structure.md " +
      "§ Readiness)",
  );
  assertTrue(
    !issues.includes("invalid-rail"),
    "invalid-rail absent, the track being judged only on a crane that has a " +
      "ring (specs/structure.md § The trolley and the rail)",
  );
});
