// audio/break-cue — a tick that breaks a member sounds the break cue.
//
// specs/ui.md § Audio: "| `break` | a tick breaks one or more members, once for
// the tick |". specs/statics.md § Utilization and breakage says the same where
// the breakage is decided: "Breakage that leaves the structure standing plays
// the `break` cue and the run continues without the broken members."
//
// THE SCENARIO IS A BREAK THE CRANE SURVIVES, which is the case both sentences
// agree on. That takes a redundant crane: on the minimal crane every member is
// the only thing doing its job, so the first member to go takes the structure
// with it and the tick is a `collapse` as much as a break. Site 3's reference
// crane carries eighty-seven members with load paths to spare, so a member that
// goes over its capacity breaks and the run carries on — which is exactly the
// tick this point is about.
//
// THE OVERLOAD IS THE SPECIFICATION'S OWN ARITHMETIC. A crate of `220` hangs on
// the hook, so specs/rigging.md makes the cable tension `(HOOK_MASS + 220) *
// GRAVITY`, `2250`, comfortably under `HOIST_CABLE_CAP` (`3000`) so the cable
// holds, and specs/statics.md applies it at the trolley point. One member's
// utilization comes out above `1` under it and specs/statics.md breaks every
// such member at once.
//
// The load is hung with `setLoadPhase`, which specs/instrumentation.md says
// "hangs that load on the hook exactly as a successful `attach` leaves it,
// without the candidate search": this point is not about the candidate search,
// and reaching the breakage through the tape's `attach` would put a second
// verdict on the way to it. The tape is one long `grip` move, the one axis
// specs/rigging.md says "applies no force to anything", so the run stays alive
// and nothing but the load's weight is ever pushing on the crane.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_CABLE_CAP,
  HOOK_MASS,
} from "../constants";
import {
  DESIGNS,
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site whose reference crane is redundant enough to lose a member. */
const SITE = 2;

/**
 * Heavy enough for one member to pass its capacity, light enough for the cable
 * to hold: `(HOOK_MASS + 220) * GRAVITY` is `2250`, under `HOIST_CABLE_CAP`.
 */
const LOAD_MASS = 220;

/** A move that keeps the run alive and applies no force to the structure. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the break cue on the tick a member breaks", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, DESIGNS[SITE]!);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 0, y: 1, z: 0, yaw: 0 },
    { x: 0, y: 1, z: 0, yaw: 0 },
  );
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const bob = started.run.bob.pos;
  await h.debug.setLoadPose(0, bob.x, bob.y, bob.z, 0);
  await h.debug.setLoadPhase(0, "attached");
  await h.cues(); // the start's own `run-start`, drained

  const broke = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the crane on the tick a member broke under it");

  assertGreaterThan(
    broke.run.broken.length,
    0,
    `the members the tick broke under a cable tension of ` +
      `${(HOOK_MASS + LOAD_MASS) * GRAVITY}, under HOIST_CABLE_CAP ` +
      `(${HOIST_CABLE_CAP}) so the cable holds (specs/statics.md)`,
  );
  assertEqual(
    broke.run.phase,
    "running",
    "the run on that tick: the breakage left the structure standing, so the " +
      "run carries on without the broken members (specs/statics.md)",
  );
  assertContains(
    played,
    "break",
    "the cues that tick sounded: `break` plays when a tick breaks one or " +
      "more members (specs/ui.md § Audio)",
  );
});
