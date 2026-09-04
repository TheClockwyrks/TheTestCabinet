// collisions/empty-hook-strikes-the-ground — the bare hook below the ground ends
// the run as `load-struck-ground`.
//
// `specs/statics.md` § Collisions gives the hook its own line in the ground test:
// "An attached load whose box dips below the ground ... ends the run as
// `load-struck-ground`. WITH NO LOAD ATTACHED, THE HOOK POINT BELOW `0` ENDS THE
// RUN THE SAME WAY." The table below it says the same from the other side: "The
// hook | The ground, and only while no load is attached." So the empty hook is a
// tested body, and the cause it raises is the carried load's cause and not one of
// its own — `specs/statics.md`'s vocabulary carries no other.
//
// This is the failing direction of that test, and its own point: a build that
// tested the ground only while a load was attached lets a tape drive the bare hook
// through the floor and carries on.
//
// THE HOOK IS PUT BELOW THE PLANE THROUGH THE RULES. `specs/instrumentation.md`:
// "`setBob` puts the bob where it is asked for, so a caller that wants a bob the
// cable can hold sets the hoist axis to the distance it left between the pivot and
// the bob. The pendulum's own constraint runs on the next tick either way." So the
// hoist is set to `4.1` — a tenth of a unit longer than the pivot's own height of
// `4` — and the bob to `(0, -0.1, 0)`: the constraint puts the hook back at
// exactly that point on the tick that follows, a tenth of a unit under the floor,
// rather than fabricating the outcome.
//
// THE YARD IS EMPTY, so nothing is attached and the hook is under the one test
// this point is about; the tape turns the grip at the slowest legal rate, so the
// arm never moves and no member can reach anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tenth of a unit more cable than the pivot's height above the ground. */
const OVERSHOOT = 0.1;

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as load-struck-ground for a bare hook below the ground", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  const started = await startRun(h);
  const pivot = started.run.pivot;
  await h.debug.setAxis("hoist", pivot.y + OVERSHOOT);
  await h.debug.setBob(pivot.x, -OVERSHOOT, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const struck = await runTicks(h, 1);

  await h.capture("through", "The bare hook below the yard floor");

  assertNull(
    struck.run.attached,
    "the attachment, so the body that struck the ground is the bare hook " +
      "(specs/statics.md)",
  );
  assertLessThan(
    struck.run.bob.pos.y,
    0,
    "the hook point the constraint left, which the ground test reads",
  );
  assertEqual(
    struck.run.phase,
    "failed",
    "the run with the bare hook a tenth of a unit below the ground plane " +
      "(specs/statics.md)",
  );
  assertEqual(
    struck.run.cause,
    "load-struck-ground",
    "the cause the empty hook below 0 ends the run with, the same one a " +
      "carried load's dip below the ground raises (specs/statics.md)",
  );
});
