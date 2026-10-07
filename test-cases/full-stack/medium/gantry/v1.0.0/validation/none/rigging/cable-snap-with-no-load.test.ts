// rigging/cable-snap-with-no-load — the cap is checked on the bare hook too.
//
// specs/rigging.md § Cable tension and snapping ends on the clause this point is
// about: a tension past `HOIST_CABLE_CAP` snaps the cable "whether or not a load
// is attached". The bob is then the hook alone, of `HOOK_MASS` (`5`), so nothing
// but a violent motion can reach `3000` — and a build that only ever tested the
// cap while it was carrying something would never be caught by a lift.
//
// THE MOTION IS POSED ON THE BOB, WHICH IS WHAT MAKES THE READING EXACT. The yard
// is emptied, so there is nothing to attach and `run.attached` is `null` by
// construction. `setBobVelocity` then gives the hook `WHIP` (`45`) units a second
// ACROSS the cable, at the bottom of a `HOIST_START` (`2`) cable: the pendulum's
// constraint step keeps the bob on the sphere, which turns that speed into a
// centripetal acceleration of the order of `v^2 / L` — some `1000` — and
// `T = m * (a - g)` is then some `5000`, comfortably past the cap. The pose is
// across the cable rather than along it deliberately: a velocity along the cable
// is removed by the same tick's constraint, so what the tick reports depends on
// which velocity a build reads back as `v_prev`, while a velocity across it
// survives the constraint and snaps the cable on that tick under either reading.
//
// THE RUN'S FIRST TICK IS PUT BEHIND US FIRST, because specs/rigging.md § The
// pendulum tick exempts it: "On a run's first tick the acceleration is zero,
// whatever velocity the steps above leave."
//
// The tape is one long `grip` move, which keeps the run running while moving
// neither the pivot nor the cable ("Turning the grip applies no force to
// anything").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The speed the bare hook is whipped across its cable at, units a second. */
const WHIP = 45;

/** Ticks the snap is waited for; the tension is past the cap on the first. */
const CAP = 4;

/** A move that keeps the run running and moves neither pivot nor cable. */
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

it("snaps the cable on a bare hook whipped past the cap", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);

  await startRun(h);
  const swinging = await runTicks(h, 2);
  assertEqual(
    swinging.run.phase,
    "running",
    "the run with the bare hook hanging still, before it is whipped",
  );
  assertNull(
    swinging.run.attached,
    "the load on the hook of a run whose yard was emptied: there is none",
  );

  await h.debug.setBobVelocity(WHIP, 0, 0);
  const snapped = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the cable to snap under a bare hook whipped across it",
  );
  await h.capture("whip", "the bare hook whipped past the cap");

  assertEqual(
    snapped.run.cause,
    "cable-snap",
    "the cause a tension past HOIST_CABLE_CAP ends the run with, with no " +
      "load attached (specs/rigging.md § Cable tension and snapping)",
  );
  assertNull(
    snapped.run.attached,
    "the attachment the run carried when the cable snapped: none, so the cap " +
      "was checked on the bare hook (specs/rigging.md)",
  );
});
