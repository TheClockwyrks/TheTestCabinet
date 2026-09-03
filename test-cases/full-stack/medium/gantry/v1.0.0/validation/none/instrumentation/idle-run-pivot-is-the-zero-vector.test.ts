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
// So the scenario stands a crane whose trolley point is nowhere near the origin
// and never starts a run. The minimal crane's track runs from `(0, 4, 0)` outward,
// so the trolley begins over `(0, 4, 0)` and a pivot derived from the geometry
// would read four units up. The placeholder's reads zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a zero pivot on an idle run under a standing crane", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

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
