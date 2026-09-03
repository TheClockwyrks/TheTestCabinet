// check/valid-track-raises-no-rail-issue — a track of several rails that keeps
// every track rule raises neither rail issue.
//
// specs/structure.md § The trolley and the rail lists the four rules a track
// keeps: every rail horizontal, "All rail members ... collinear, along one line,
// and cover one unbroken stretch of it exactly once ... a track of `n` rails
// runs over `n + 1` nodes", "Every rail member is in the arm", and "The track's
// two end nodes lie at distinct horizontal distances from the slew axis."
// § Readiness gives the two rows a track can earn: `no-rail` for a crane with no
// rail members and `invalid-rail` for one whose rails break a rule above. A
// track that keeps all four earns neither.
//
// The scenario is deliberately a MULTI-rail track, because the rule about
// meeting end to end over `n + 1` nodes has nothing to say about a single rail:
// three rails run along `y = 4, z = 0` from the top-flange node `(2, 4, 0)` out
// to `(8, 4, 0)`, sharing `(4, 4, 0)` and `(6, 4, 0)` between them, over four
// nodes. Every rail is horizontal; all three lie on one line and cover the
// stretch from `x = 2` to `x = 8` exactly once; every one of them is in the arm,
// the near end being a top-flange node of the ring at `(0, 2, 0)` and the rest
// reached through the rails themselves; and the two ends stand at `sqrt(2)` and
// `sqrt(50)` from the slew axis through `(1, ·, 1)`.
//
// The tower under the ring is the minimal crane's, which reaches only the bottom
// flange, so no member joins the arm to the tower outside the ring and nothing
// is disconnected.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
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

/** The minimal crane's braced tower: every member of it ends at or below `y = 2`. */
const TOWER: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] <= 2 && b[1] <= 2,
);

/** A ring at `(0, 2, 0)` carrying a three-rail track over four nodes. */
const SOUND_TRACK: CraneDesign = {
  site: 0,
  name: "Three-rail track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    ...TOWER,
    [[2, 4, 0], [4, 4, 0], "rail"],
    [[4, 4, 0], [6, 4, 0], "rail"],
    [[6, 4, 0], [8, 4, 0], "rail"],
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

it("raises neither no-rail nor invalid-rail for three rails laid end to end", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, SOUND_TRACK);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture(
    "issues-the-four-track-node-positions-the-rail",
    "a three-rail track laid end to end over four nodes",
  );

  assertTrue(
    !issues.includes("no-rail") && !issues.includes("invalid-rail"),
    "neither rail issue, the three rails forming one straight track that keeps " +
      "every rule (specs/structure.md § The trolley and the rail): the issues " +
      `read [${issues.join(", ")}]`,
  );
});
