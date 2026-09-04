// check/check-reads-every-member-after-a-run-broke-some — a check taken after a
// run that broke members solves over every member the crane holds.
//
// specs/state.md § The idle run and a finished one: a run that ends is left as it
// ended, "That broken list belongs to the run that broke them; the structure
// itself is untouched, so the build screen and its check read every member."
// specs/structure.md § The static check has the check "read the structure as it
// stands" and report "Each intact member's force and utilization", where intact
// is a fact about the structure rather than about the run just watched. So a
// check before a run and a check after one that broke members are the same
// reading of the same structure.
//
// THE BREAKAGE IS THE SPECIFICATION'S ARITHMETIC, not a nudge. The minimal crane
// lifts a crate of mass `275` off the ground at the hook: specs/rigging.md makes
// the cable tension `(HOOK_MASS + 275) * GRAVITY`, `2800`, on the run's first
// tick — under `HOIST_CABLE_CAP` (`3000`), so the cable holds — and that force is
// applied at the trolley point, which stands at the track origin `(0, 4, 0)`.
// The only member with a vertical component at the tower node under it,
// `(0, 2, 0)`, is the leg from the anchor below, so the leg carries the whole of
// it in compression, over `STRUT_CAP_COMPRESSION` (`2400`) at its length, and it
// breaks on that tick.
//
// The load sits at the hook rather than being flown to it, because this item is
// about what the check reads and not about a lift.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOIST_START, HOOK_MASS, HOIST_CABLE_CAP } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The minimal crane's track origin, where the trolley stands at `trolley` 0. */
const TROLLEY_POINT = { x: 0, y: 4, z: 0 } as const;

/** The bare hook at the run's start: the pivot, `HOIST_START` below. */
const HOOK_POINT = {
  x: TROLLEY_POINT.x,
  y: TROLLEY_POINT.y - HOIST_START,
  z: TROLLEY_POINT.z,
  yaw: 0,
} as const;

/**
 * Heavy enough for the leg under the trolley to break, light enough for the
 * cable to hold: `(HOOK_MASS + 275) * GRAVITY` is `2800`, under
 * `HOIST_CABLE_CAP` (`3000`).
 */
const LOAD_MASS = 275;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every member the crane holds after a run broke some of them", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [{ kind: "action", action: "attach" }]);
  // A crate standing on the ground with its lift point at the hook, so the
  // tape's one action takes it (specs/rigging.md § Attaching).
  await addOneLoad(h, "crate", LOAD_MASS, HOOK_POINT, HOOK_POINT);

  const before = await h.check();
  assertEqual(
    before.stable,
    true,
    "the minimal crane standing before the run, so the check reports its " +
      "member forces (specs/structure.md)",
  );
  const built = (await h.snapshot()).structure.members;

  await startRun(h);
  const broke = await runUntil(
    h,
    (s) => s.run.broken.length > 0,
    120,
    `a member to break under a cable tension of ` +
      `${(HOOK_MASS + LOAD_MASS) * 10}, under HOIST_CABLE_CAP ` +
      `(${HOIST_CABLE_CAP}) (specs/statics.md)`,
  );
  assertGreaterThan(
    broke.run.broken.length,
    0,
    "the members the run broke (specs/statics.md)",
  );

  await h.debug.setScreen("build");
  const after = await h.snapshot();
  assertDeepEqual(
    after.structure.members,
    built,
    "the structure's members after the run: the broken list belongs to the " +
      "run, and the structure itself is untouched (specs/state.md)",
  );

  const second = await h.check();
  await h.advance(1);
  await h.capture("every-member", "the check after a run that broke members");

  assertDeepEqual(
    second,
    before,
    "the check taken after the run: the same issues, cost, budget, verdict " +
      "and member list, solved over every member the crane holds, the ones " +
      "the run broke included (specs/structure.md)",
  );
});
