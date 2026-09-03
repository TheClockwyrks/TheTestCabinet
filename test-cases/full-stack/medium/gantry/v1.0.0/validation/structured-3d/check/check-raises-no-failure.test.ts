// check/check-raises-no-failure — nothing fails during a check.
//
// specs/structure.md § The static check closes with it: "Nothing breaks and
// nothing fails during a check: a utilization above `1` is reported and no
// more." The action itself "reads the structure as it stands, WITHOUT STARTING A
// RUN". Failure is a run's: specs/statics.md § The failure causes says "Every
// FAILED RUN carries exactly one cause", and specs/state.md holds `run.phase`
// `"idle"` with `cause` `null` while there is no run to report.
//
// The scenario reads the check on the two structures that would end a run if one
// were running, and reads the run back after each.
//
//   - A mechanism. specs/statics.md § Singularity: "A singular solve, in either
//     the arm or the tower ... ends the run as `collapse`." The crane here is
//     the minimal crane with the four diagonals that brace its tower's sides
//     taken away: nine members holding four free nodes, twelve unknowns against
//     nine member stiffnesses, so the tower solve cannot be regular.
//   - A crane carrying a utilization above `1`. specs/statics.md § Utilization
//     and breakage: "every member whose utilization exceeds `1` breaks". The
//     crane here hangs a `COUNTERWEIGHT_MASS` block on the far end of a
//     six-unit rail held up by a shallow cable to a short mast, which drives
//     that rail's compression past what `BUCKLE_REF` leaves a member of that
//     length: `RAIL_CAP_COMPRESSION` times `(BUCKLE_REF / 6)^2`.
//
// Both are read on a freshly opened site, whose run `specs/state.md` says is the
// idle placeholder, so what the readings are measured against is a run that
// never began — and the screen is read with them, because starting a run would
// move it to `run` (specs/program.md § Starting and ending a run).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull, assertTrue } from "../assert";
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

/** The same tower with none of the four diagonals that brace its sides. */
const FLAT_TOWER: readonly DesignMember[] = [
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 0], "strut"],
  [[0, 2, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [0, 2, 2], "strut"],
  [[2, 2, 0], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 2], "strut"],
];

/** The minimal crane's arm: every member of it stands at or above `y = 4`. */
const ARM: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] >= 4 && b[1] >= 4,
);

/** Ready, and a mechanism below the ring: a solve that goes singular. */
const MECHANISM: CraneDesign = {
  site: 0,
  name: "Unbraced tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: [...FLAT_TOWER, ...ARM],
  tape: [],
};

/**
 * Ready, standing, and worked past capacity: a counterweight on the far end of a
 * six-unit rail, held up by a cable that runs back to a mast only two units
 * above the track, so the cable's shallow angle drives the rail's compression
 * well past what a member of that length bears.
 */
const OVERLOADED: CraneDesign = {
  site: 0,
  name: "Overloaded rail",
  ring: [0, 2, 0],
  counterweights: [[6, 4, 0]],
  members: [
    ...TOWER,
    [[0, 4, 0], [0, 6, 0], "strut"],
    [[2, 4, 0], [0, 6, 0], "strut"],
    [[0, 4, 2], [0, 6, 0], "strut"],
    [[2, 4, 2], [0, 6, 0], "strut"],
    [[0, 4, 0], [6, 4, 0], "rail"],
    [[2, 4, 2], [6, 4, 0], "strut"],
    [[0, 6, 0], [6, 4, 0], "cable"],
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

it("leaves the run idle with no cause after checking a mechanism and an overworked crane", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await poseCrane(h, MECHANISM);
  const singular = await h.check();
  const afterSingular = await h.snapshot();

  await poseCrane(h, OVERLOADED);
  const worked = await h.check();
  const afterWorked = await h.snapshot();

  await h.advance(1);
  await h.capture(
    "run-phase-run-cause-screen-after-each-reading",
    "the run and the screen after checking a crane worked past capacity",
  );

  // The two scenarios are only worth reading if they are what they claim: a
  // solve that goes singular, and a member past its capacity.
  assertTrue(
    singular.stable === false,
    "the mechanism does not stand, so a build that failed on a check would " +
      "have collapsed here (specs/statics.md § Singularity)",
  );
  assertGreaterThan(
    Math.max(...worked.members.map((one) => one.utilization)),
    1,
    "the highest utilization the worked crane reports, so a build that broke " +
      "members on a check would have broken one here (specs/statics.md " +
      "§ Utilization and breakage)",
  );

  for (const [what, snapshot] of [
    ["after checking the mechanism", afterSingular],
    ["after checking the worked crane", afterWorked],
  ] as const) {
    assertEqual(
      snapshot.run.phase,
      "idle",
      `run.phase ${what}: no run begins during a check ` +
        "(specs/structure.md § The static check)",
    );
    assertNull(
      snapshot.run.cause,
      `run.cause ${what}: no verdict is reached during a check ` +
        "(specs/structure.md § The static check)",
    );
    assertEqual(
      snapshot.screen,
      "build",
      `the screen ${what}: the check reads the structure without starting a ` +
        "run (specs/structure.md § The static check)",
    );
  }
});
