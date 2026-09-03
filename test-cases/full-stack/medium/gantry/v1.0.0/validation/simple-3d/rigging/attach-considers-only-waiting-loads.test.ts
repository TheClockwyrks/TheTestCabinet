// rigging/attach-considers-only-waiting-loads — only a `waiting` load is a
// candidate.
//
// specs/rigging.md § Attaching names the phase in the rule itself: "The candidate
// is the `waiting` load whose lift point is nearest the hook point". A load in any
// other phase is no candidate, however near the hook it sits — which is what stops
// a tape from picking a load it has already set down, and what makes a second lift
// off the same pad impossible.
//
// THE ONLY LOAD AT THE HOOK IS A PLACED ONE, SITTING EXACTLY WHERE THE HOOK IS.
// Its distance to the hook point is zero, so it would win any candidate search
// that read distances and not phases. specs/instrumentation.md: `setLoadPhase` to
// `"placed"` "sets the load down exactly as a successful `release` leaves it: it
// sits at exactly its target pose", so its target pose is the hook point and that
// is where the pose puts it. The other load is `waiting` and stands `10` units
// away, so it is a candidate by phase and no candidate by distance: with the
// placed one properly excluded there is no candidate at all, and the run must end.
//
// THE HOOK POINT IS POSED where the run starts it — the pivot minus
// `(0, HOIST_START, 0)`, which the cable holds at its current length — so the
// placed load's zero distance is exact.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The placed load's pad: the hook point itself. */
const PAD = { x: HOOK.x, y: HOOK.y, z: HOOK.z, yaw: 0 };

/** Where the placed load starts, before the pose sets it down on its pad. */
const PLACED_FROM = { x: 6, y: 2, z: 0, yaw: 0 };

/** The waiting load: a candidate by phase, far out of reach by distance. */
const WAITING_AT = { x: 10, y: 2, z: 0, yaw: 0 };

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that would keep a surviving run running past the `attach`. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("passes over a placed load sitting on the hook point", async () => {
  await openSite(h, SITE);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await h.debug.addLoad(
    "crate",
    40,
    PLACED_FROM.x,
    PLACED_FROM.y,
    PLACED_FROM.z,
    PLACED_FROM.yaw,
  );
  await h.debug.setLoadTarget(0, PAD.x, PAD.y, PAD.z, PAD.yaw);
  await h.debug.addLoad(
    "crate",
    40,
    WAITING_AT.x,
    WAITING_AT.y,
    WAITING_AT.z,
    WAITING_AT.yaw,
  );
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setLoadPhase(0, "placed");

  const missed = await runTicks(h, 1);
  await h.capture("yard", "the placed load sitting at the hook point");

  assertEqual(
    missed.run.phase,
    "failed",
    "the run on the tick an `attach` executed with a PLACED load at the hook " +
      "point and the only waiting load 10 units away: only a waiting load is " +
      "a candidate (specs/rigging.md § Attaching)",
  );
  assertEqual(
    missed.run.cause,
    "attach-missed",
    "the cause an `attach` with no candidate ends the run with " +
      "(specs/rigging.md § Attaching)",
  );
  assertNull(
    missed.run.attached,
    "what the hook came away with: the load sitting on it was placed, not " +
      "waiting (specs/rigging.md § Attaching)",
  );
  assertEqual(
    missed.run.loads[0]?.phase,
    "placed",
    "the placed load's own phase across the `attach` that passed it over",
  );
});
