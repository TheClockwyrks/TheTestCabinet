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
// raise the issue. The first reading is `MINIMAL_CRANE`, whose single rail runs
// from the top-flange node `(0, 4, 0)` out to `(4, 4, 0)`: horizontal, in the
// arm, one unbroken stretch, and with its ends at `sqrt(2)` and `sqrt(10)` from
// the slew axis through `(1, ·, 1)`. That reading must carry no `invalid-rail`.
// One rail is then placed between two lattice nodes high in the far corner of
// site 1's envelope, touching no anchor, no flange node and no member of the
// crane, and the second reading must carry it.
//
// The stray rail is a legal placement: specs/structure.md § The editor's rules
// refuses a rail for its envelope, its length, a duplicate, an obstacle, being
// out of horizontal, the ring rule or the budget, and never for standing alone.
// It is laid horizontal at `y = 8` so the one rule the editor DOES enforce on
// placement is satisfied and the reading is about the readiness rule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

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
  await clearAll(h);
  await standMinimalCrane(h);

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
