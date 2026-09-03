// check/check-carries-the-bare-hook-alone — the site's waiting loads leave the
// check's forces untouched.
//
// specs/structure.md § The static check: the two solves run "with the bare hook
// hanging at rest and nothing moving". specs/statics.md § The load model says
// what that hook brings: "The hook and any attached load reach the structure only
// through the cable force", and nothing is attached at a check, so the whole of
// what the cable brings is the bare hook's weight, `HOOK_MASS` (`5`) times
// `GRAVITY`. A waiting load is not on the hook and is tested against nothing
// (specs/statics.md § Collisions), so it contributes neither mass nor force.
//
// THE LOAD IS PUT WHERE IT WOULD DO THE MOST DAMAGE IF IT COUNTED: a `container`
// of mass `5000` — a hundred times the hook's — standing on the ground directly
// under the trolley point the cable hangs from at `trolley` `0`. If a build let
// the yard reach the solve at all, every member force would move by orders of
// magnitude; if it did not, the two readings are the same computation twice.
//
// The trolley point is the minimal crane's track origin `(0, 4, 0)`: its rail
// runs from there out to `(4, 4, 0)`, and the origin is "the end nearer the slew
// axis", which stands at `(1, ., 1)` for a ring cornered at `(0, 2, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { HOOK_MASS } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The minimal crane's track origin: the point the cable hangs from. */
const TROLLEY_POINT = { x: 0, y: 4, z: 0 } as const;

/**
 * A load whose lift point is directly under the trolley point, resting on the
 * ground: a `container` is `2` high, so its lift point — "the center of its top
 * face" (specs/world.md) — stands at `y` `2`.
 */
const UNDER_THE_TROLLEY = {
  x: TROLLEY_POINT.x,
  y: 2,
  z: TROLLEY_POINT.z,
  yaw: 0,
} as const;

/** A thousand times the hook's mass, so counting it could not go unnoticed. */
const HEAVY = 5000;

/** Force units: the two readings are one computation over one structure. */
const FORCE_TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the same forces with a heavy load standing under the trolley", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  const bare = await h.check();
  assertEqual(
    bare.stable,
    true,
    "the minimal crane standing under the bare hook alone, so the check " +
      "reports a member list to compare (specs/structure.md)",
  );

  await addOneLoad(h, "container", HEAVY, UNDER_THE_TROLLEY, UNDER_THE_TROLLEY);
  assertLength(
    (await h.snapshot()).site.loads,
    1,
    "the load standing in the yard for the second reading",
  );

  const loaded = await h.check();

  assertLength(
    loaded.members,
    bare.members.length,
    "the members the check reports with the load standing",
  );
  for (const [index, member] of bare.members.entries()) {
    const withLoad = loaded.members[index];
    assertEqual(
      withLoad?.id,
      member.id,
      `the id at position ${index} of the loaded reading's members`,
    );
    assertNear(
      withLoad?.force ?? Number.NaN,
      member.force,
      FORCE_TOL,
      `member ${member.id}'s force with a mass of ${HEAVY} standing under ` +
        `the trolley: the cable brings HOOK_MASS (${HOOK_MASS}) alone ` +
        "(specs/structure.md, specs/statics.md)",
    );
    assertNear(
      withLoad?.utilization ?? Number.NaN,
      member.utilization,
      FORCE_TOL,
      `member ${member.id}'s utilization with the load standing`,
    );
  }

  await h.advance(1);
  await h.capture(
    "bare-hook",
    "the check taken with a heavy load standing under the trolley",
  );
});
