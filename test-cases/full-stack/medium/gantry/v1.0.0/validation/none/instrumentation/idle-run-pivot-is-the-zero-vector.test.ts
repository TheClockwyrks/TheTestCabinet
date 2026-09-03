// instrumentation/idle-run-pivot-is-the-zero-vector — the idle placeholder's
// pivot is (0, 0, 0), whatever crane is standing.
//
// specs/instrumentation.md § Snapshot shape: "`run.pivot` is the point the cable
// hangs from at the most recent tick's geometry, which the pendulum reads on the
// tick after (`specs/rigging.md`); from a run's start until its first tick it is
// the run-start pivot `specs/state.md` gives, and the idle placeholder's is the
// zero vector that file states." specs/state.md fixes the placeholder itself: "a
// zero pivot, a bob at the origin with zero velocity".
//
// The pivot is therefore a thing the run REMEMBERS rather than a thing read off
// the structure — specs/state.md says as much, "it cannot be recomputed from the
// axes once a rail has broken, because the track it was taken along is gone" — and
// this is the reading that tells the two apart.
//
// SO THE CRANE IS THE PART OF A CRANE THE PIVOT WOULD BE DERIVED FROM, and no
// more of one. The trolley stands at the track origin, so a pivot read off the
// geometry is that node: a ring one pitch off the ground and one rail running out
// from its top flange put the track origin at `(0, 4, 0)`, four units up and
// nowhere near the origin. The placeholder's reads zero. No run is ever started
// here, so nothing asks this structure to stand — a braced tower under it would
// be surface this point does not decide, and every rule it could trip on belongs
// to another validator.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * A slew ring on its tower node and the single rail its trolley starts on.
 *
 * The ring's base corner is `(0, 2, 0)`, whose `y` is not `0` — "the ring sits on
 * a tower, not on the ground" — and the rail runs horizontally from the
 * top-flange node `(0, 4, 0)` out to `(4, 4, 0)`, joining no anchor or
 * bottom-flange node to a top-flange one. Both edits stand on site 1, inside its
 * envelope and far inside its budget at `72`.
 */
const RING_AND_TRACK: CraneDesign = {
  site: 0,
  name: "Ring and track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [[[0, 4, 0], [4, 4, 0], "rail"]],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a zero pivot on an idle run under a standing crane", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, RING_AND_TRACK);

  const s = await h.snapshot();
  assertEqual(
    s.run.phase,
    "idle",
    "the run of a site opened and never run (specs/state.md)",
  );
  // The crane really is standing somewhere the origin is not, so a zero pivot is
  // the placeholder's rather than the geometry's.
  assertGreaterThan(
    s.structure.members.length,
    0,
    "the members the crane the pivot is read under carries",
  );
  assertNotNull(s.structure.ring, "the ring the standing crane carries");
  assertGreaterThan(
    s.structure.ring?.corner.y ?? 0,
    0,
    "the height the crane's ring stands at, so its arm is clear of the origin",
  );

  assertEqual(s.run.pivot.x, 0, "the idle placeholder's pivot x");
  assertEqual(s.run.pivot.y, 0, "the idle placeholder's pivot y");
  assertEqual(s.run.pivot.z, 0, "the idle placeholder's pivot z");

  await h.advance(1);
  await h.capture(
    "idle-pivot",
    "The standing crane the idle pivot was read under",
  );
});
