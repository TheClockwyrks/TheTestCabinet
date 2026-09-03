// check/check-readiness-issue-does-not-stand — a crane with a readiness issue
// does not stand.
//
// specs/structure.md § The static check: "With any readiness issue the structure
// is not solved" and "A structure that is not solved does not stand, whether a
// readiness issue refused the solve or a solve went singular". So the verdict is
// `false` for a readiness issue alone, however sound the rest of the crane is.
//
// THE TWO READINGS ARE THE POINT. The same crane is read twice: once as the
// harness's fully braced minimal crane, which stands, and once with a single
// extra strut hung between two lattice nodes nothing else reaches. That strut is
// a legal placement — it is inside the envelope, two units long, joins no
// existing pair, reaches no obstacle, joins the arm to nothing, and costs `20`
// against a `3000` budget (specs/structure.md § The editor's rules) — and it
// raises `disconnected-members`, "Some member belongs to neither the tower nor
// the arm: it has no member path to an anchor or to a flange node."
//
// Nothing about what holds the crane up changed between the two readings, so the
// verdict flipping is the readiness issue's doing and nothing else's.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

/** Two lattice nodes inside site 1's envelope that nothing else reaches. */
const LOOSE_A = { x: -4, y: 2, z: -4 } as const;
const LOOSE_B = { x: -4, y: 4, z: -4 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports stable false once one member belongs to neither tower nor arm", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);

  const sound = await h.check();
  assertTrue(
    sound.stable,
    "the crane this point disconnects a member from stands to begin with, so " +
      "the second reading is the readiness issue's doing (specs/structure.md)",
  );

  await h.debug.addMember(
    LOOSE_A.x,
    LOOSE_A.y,
    LOOSE_A.z,
    LOOSE_B.x,
    LOOSE_B.y,
    LOOSE_B.z,
    "strut",
  );
  const disconnected = await h.check();
  await h.advance(1);
  await h.capture(
    "issues-and-stable-from-both-readings",
    "issues and stable from both readings.",
  );

  assertContains(
    disconnected.issues,
    "disconnected-members",
    "the readiness issue a member joined to neither the tower nor the arm " +
      "raises (specs/structure.md § Readiness)",
  );
  assertTrue(
    !disconnected.stable,
    "the verdict on a structure a readiness issue left unsolved " +
      "(specs/structure.md § The static check)",
  );
});
