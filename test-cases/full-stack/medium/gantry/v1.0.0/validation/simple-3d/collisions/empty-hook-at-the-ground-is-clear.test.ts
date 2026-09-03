// collisions/empty-hook-at-the-ground-is-clear — the bare hook resting exactly on
// the ground plane has not gone through it.
//
// `specs/statics.md` § Collisions states the ground test and its edge in the same
// breath: "An attached load whose box dips below the ground, its lift point's `y`
// minus its class height falling BELOW `0`, ends the run as `load-struck-ground`.
// WITH NO LOAD ATTACHED, THE HOOK POINT BELOW `0` ends the run the same way. A
// load whose bottom face rests exactly on `y = 0` is on the ground, not through
// it." `specs/world.md` fixes the plane itself: "the ground is the plane `y = 0`".
//
// BELOW is the whole of this point, and the hook is its own body: the table in the
// same section gives "The hook | The ground, and only while no load is attached".
// A build that ended the run at `y <= 0` would fail every run whose hook was
// lowered to the floor, which is what a player does to pick a load off the ground.
//
// THE PENDULUM HOLDS THE HOOK EXACTLY THERE, through the rules rather than by
// assertion. `specs/rigging.md` puts the bob at "`p = P + L * n`" every tick, so a
// bob posed straight below a still pivot with no velocity is left where it is: the
// hoist is set to the pivot's own height, `4`, and the bob to `(0, 0, 0)`, so the
// constraint holds the hook on the ground plane tick after tick. The check reads
// the hook's height back on every one of them, so a build whose bob drifted would
// be graded on a scenario it never actually stood in.
//
// THE YARD IS EMPTY, so there is no attached load and the hook is under exactly
// the one test this point is about; the tape turns the grip at the slowest legal
// rate, so the arm never moves and the pivot never does either.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
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

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Half a second of run clock resting on the floor. */
const TICKS = 30;

/** The hook's height is a constraint's arithmetic, not an integration. */
const EXACT = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for a bare hook held exactly at the ground plane", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  const started = await startRun(h);

  // The cable is set to the pivot's OWN height, read off the run rather than
  // assumed, so the constraint hangs the hook on the ground plane whatever crane
  // a build stands (`specs/rigging.md`: the bob stays at distance L from the
  // pivot, and the constraint puts it at `p = P + L * n`).
  const pivot = started.run.pivot;
  assertGreaterThan(
    pivot.y,
    0,
    "the pivot's height above the ground, so a cable of that length reaches " +
      "the ground plane and no further",
  );
  await h.debug.setAxis("hoist", pivot.y);
  await h.debug.setBob(pivot.x, 0, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);

  let furthestFromTheGround = 0;
  let last = started;
  for (let tick = 0; tick < TICKS; tick += 1) {
    last = await runTicks(h, 1);
    furthestFromTheGround = Math.max(
      furthestFromTheGround,
      Math.abs(last.run.bob.pos.y),
    );
  }

  await h.capture("resting", "The bare hook resting on the yard floor");

  assertNull(
    last.run.attached,
    "the attachment, so the body under test is the bare hook " +
      "(specs/statics.md)",
  );
  assertTrue(
    furthestFromTheGround <= EXACT,
    "the hook to stand at exactly y 0 on every one of the " +
      `${TICKS} ticks, so what is graded is the hook ON the ground plane; ` +
      `the furthest it stood from it was ${furthestFromTheGround}`,
  );
  assertEqual(
    last.run.phase,
    "running",
    `the run after ${TICKS} ticks with the bare hook resting at exactly y 0: ` +
      "the ground test is the hook point BELOW 0 (specs/statics.md)",
  );
  assertNull(last.run.cause, "the cause of a run the ground never ended");
});
