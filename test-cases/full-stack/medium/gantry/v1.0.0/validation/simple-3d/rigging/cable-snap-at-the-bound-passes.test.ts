// rigging/cable-snap-at-the-bound-passes — a tension of exactly the cap does not
// snap the cable.
//
// specs/rigging.md § Cable tension and snapping fixes the comparison as a strict
// one: "A tick on which `|T|` exceeds `HOIST_CABLE_CAP` (`3000`) snaps the cable".
// Exceeds, not reaches — so a cable carrying exactly `3000` holds, and a build
// that wrote `>=` fails here while passing every other reading of the section.
//
// THE BOUND IS REACHED EXACTLY, WHICH IS THE ONLY WAY THIS POINT CAN BE DECIDED.
// `T = m * (a - g)`, so a bob hanging at rest below a still pivot carries
// `m * GRAVITY` and nothing else: a bob of `HOIST_CABLE_CAP / GRAVITY` (`300`) is
// a tension of exactly `HOIST_CABLE_CAP`. The hook is `HOOK_MASS` (`5`) of it, so
// the load hung on it is `295`. Nothing in the arithmetic is inexact — the
// pendulum's constraint leaves a bob hanging straight below a still pivot with a
// velocity of exactly zero, so `a` is exactly zero and `m * GRAVITY` is exactly
// `3000`.
//
// THE CRANE UNDER IT HAS TO CARRY THE `3000`, because this point is decided by the
// run CARRYING ON, which it cannot do if a later stage of the same tick ends it.
// The bracing below is the harness's minimal crane with every anchor tied to every
// bottom-flange node: the cable force lands wholly on the track origin `(0, 4, 0)`,
// a top-flange node, and crosses the ring to `(0, 2, 0)`, where the minimal
// crane's single vertical leg would have to carry the whole of it and would break.
// Twelve ties instead of four spread it across the tower, and the eight added
// struts cost `252` on top of the minimal crane's `981`, well inside site 1's
// budget of `3000` (specs/structure.md § Cost and the budget).
//
// The tape is one long `grip` move, the only axis whose motion moves neither the
// pivot nor the cable ("Turning the grip applies no force to anything"), so the
// bob stays at rest for every tick of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
} from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bob hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK_AT = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** The bob whose weight is exactly the cap. */
const BOB_MASS = HOIST_CABLE_CAP / GRAVITY;

/** What is hung on the hook to make the bob weigh that much. */
const LOAD_MASS = BOB_MASS - HOOK_MASS;

/** The eight ties the minimal crane's tower does not already carry. */
const EXTRA_TIES: readonly DesignMember[] = [
  [[2, 0, 0], [0, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 0], "strut"],
  [[2, 0, 2], [2, 2, 0], "strut"],
  [[2, 0, 2], [0, 2, 2], "strut"],
  [[0, 0, 0], [2, 2, 2], "strut"],
  [[2, 0, 0], [0, 2, 2], "strut"],
  [[0, 0, 2], [2, 2, 0], "strut"],
  [[2, 0, 2], [0, 2, 0], "strut"],
];

/** The minimal crane with every anchor tied to every bottom-flange node. */
const BRACED: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with the tower fully cross-tied",
  members: [...MINIMAL_CRANE.members, ...EXTRA_TIES],
};

/** A move that keeps the run running and moves neither pivot nor cable. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Ticks the run is watched for after the bob reaches the bound. */
const WATCHED = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on with a bob hanging at exactly HOIST_CABLE_CAP", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, BRACED);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK_AT, HOOK_AT);
  await poseTape(h, [HOLD]);

  await startRun(h);
  // Two ticks of the bare hook first, so the tick the load arrives on is neither
  // the run's first — "On a run's first tick the acceleration is zero" — nor the
  // one the bob is still settling on.
  await runTicks(h, 2);
  await h.debug.setLoadPhase(0, "attached");

  const hanging = await runTicks(h, WATCHED);
  await h.capture(
    "state",
    `a bob of ${BOB_MASS} hanging at rest, exactly ${HOIST_CABLE_CAP} of tension`,
  );

  assertEqual(
    hanging.run.phase,
    "running",
    `the run after ${WATCHED} ticks with a bob of ${BOB_MASS} hanging at ` +
      `rest, whose tension is exactly HOIST_CABLE_CAP (${HOIST_CABLE_CAP}); ` +
      "only a tension that EXCEEDS the cap snaps the cable " +
      "(specs/rigging.md § Cable tension and snapping)",
  );
  assertNull(
    hanging.run.cause,
    "the cause a run that has not failed carries (specs/state.md)",
  );
});
