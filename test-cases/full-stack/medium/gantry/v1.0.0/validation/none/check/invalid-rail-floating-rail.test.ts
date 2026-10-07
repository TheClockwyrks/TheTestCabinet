// check/invalid-rail-floating-rail — a rail joined to nothing raises
// `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the third track rule: "Every
// rail member is in the arm", and § The slew ring fixes what the arm is:
// "Everything connected through intact members to the top flange". A rail that
// touches nothing is connected to no flange node, so it is not in the arm and
// the track rules are broken.
//
// The scenario reads the check TWICE over the same crane, because that is what
// separates the rail this point is about from every other reason a crane could
// raise the issue. The first reading is a ring and one rail, running from the
// top-flange node `(0, 4, 0)` out to `(4, 4, 0)`: horizontal, in the arm, one
// unbroken stretch, and with its ends at `sqrt(2)` and `sqrt(10)` from the slew
// axis through `(1, ·, 1)`. That reading must carry no `invalid-rail`. One rail
// is then placed between two lattice nodes high in the far corner of site 1's
// envelope, touching no anchor, no flange node and no member of the crane, and
// the second reading must carry it. Nothing else is built: the readiness rule
// this decides speaks of the rails and the ring alone, so a whole crane would
// only add editor refusals belonging to other validators.
//
// The stray rail is a legal placement: specs/structure.md § The editor's rules
// refuses a rail for its envelope, its length, a duplicate, an obstacle, being
// out of horizontal, the ring rule or the budget, and never for standing alone.
// It is laid horizontal at `y = 8` so the one rule the editor DOES enforce on
// placement is satisfied and the reading is about the readiness rule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

/**
 * The sound track the stray rail is set beside: a slew ring and the one rail
 * that hangs off its top flange.
 *
 * EVERY TRACK RULE, AND NOTHING ELSE. The rail is horizontal, it is the whole
 * track so it is trivially collinear and unbroken, it hangs from a top-flange
 * node so it is in the arm, and its two ends stand at distinct horizontal
 * distances from the slew axis (`specs/structure.md` § The trolley and the
 * rail). So `invalid-rail` is absent before the stray rail and raised after it,
 * which is the whole of what this decides — the tower, the mast and the bracing
 * a whole crane carries take no part in the rule and only add editor refusals
 * that belong to other validators.
 */
const RING = { x: 0, y: 2, z: 0 };
const RAIL_A = { x: 0, y: 4, z: 0 };
const RAIL_B = { x: 4, y: 4, z: 0 };

/** The stray rail: horizontal, at `y = 8`, in the far `-x, -z` corner of site 1. */
const STRAY_A = { x: -6, y: 8, z: -6 } as const;
const STRAY_B = { x: -6, y: 8, z: -4 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises invalid-rail once a rail joined to nothing stands beside a sound track", async () => {
  await openSite(h, 0);
  // Nothing is cleared: a site opened after a reset has nothing built, and a
  // readiness reading is taken off the structure and the site alone
  // (specs/structure.md), so the yard and the tape are not this requirement's.
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addMember(
    RAIL_A.x,
    RAIL_A.y,
    RAIL_A.z,
    RAIL_B.x,
    RAIL_B.y,
    RAIL_B.z,
    "rail",
  );

  const before = (await h.check()).issues;

  await h.debug.addMember(
    STRAY_A.x,
    STRAY_A.y,
    STRAY_A.z,
    STRAY_B.x,
    STRAY_B.y,
    STRAY_B.z,
    "rail",
  );
  const after = (await h.check()).issues;

  await h.advance(1);
  await h.capture(
    "issues-from-both-readings",
    "the sound track, and the same crane carrying a rail joined to nothing",
  );

  assertTrue(
    !before.includes("invalid-rail"),
    "invalid-rail absent while the crane's only rail forms a sound track " +
      "(specs/structure.md § The trolley and the rail)",
  );
  assertContains(
    after,
    "invalid-rail",
    "the issue a rail joined to nothing raises, no flange node reaching it so " +
      "it is not in the arm (specs/structure.md § The trolley and the rail)",
  );
});
