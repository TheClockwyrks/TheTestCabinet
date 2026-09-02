// runs/step-at-a-boundary-runs-one-whole-cycle — `step` on a run standing at a
// boundary runs exactly one cycle, all five of its phases, and leaves the run paused
// on the next boundary.
//
// THE RULE. "After that, `step` acts immediately and always leaves the run paused: a
// run mid-cycle, running or paused, completes its current cycle to the boundary, and
// a run paused at a boundary runs one full cycle, as `specs/simulation.md` defines
// one" (`specs/editor.md`, Running the machine). What one cycle is, and what its
// boundary leaves behind, is `specs/simulation.md`: the five steps Fetch, Drops,
// Grabs, Motion, Boundary, ending "Motes are at rest on hex centers again ...
// `sim.cycle` increments and the next cycle begins."
//
// THE CONFIGURATION. One `arm` at `(0, 0)`, rotation `0`, length `ARM_MIN_LEN` (`1`),
// on the one-cell tape `rotate-cw`, holding one mote on `(1, 0)`. `specs/parts.md`
// puts an arm's gripper at "`base + length * DIRS[d]`", so at rotation `0` and length
// `1` that gripper is on `(1, 0)`; the hold is posed with `setGrip`, "which takes hold
// with no `grab` ever running" (`specs/instrumentation.md`), so no earlier cycle is
// needed to take it. The motion table gives the cycle its whole effect: "`rotate-cw`,
// `rotate-ccw` | The part's direction turns 60 degrees about its base ... The same
// rotation about the base" for the held constellation, and "at `t = 1` every mote
// lands exactly on a hex center". One clockwise step from `(1, 0)` about `(0, 0)` is
// `(0, 1)`, by the rotation formula of `specs/field.md`.
//
// Nothing else is on the field, so no second mote can collide and no sigil can act.
// The run is opened PAUSED at its settle, where `sim.cycle` is `0` and `sim.fraction`
// is `0` — a boundary, which is where this point presses.
//
// THE VERDICT. One press leaves `sim.cycle` at `1`, `sim.fraction` at `0` and
// `sim.status` `paused`, and the cycle really ran all the way through: the arm's live
// rotation is `1`, its gripper is still holding the same mote — "Grips persist across
// cycles until dropped and ride the motion of the part that holds them" — and that
// mote is resting on `(0, 1)`, the hex a whole clockwise step lands it on. A build
// that ran only part of the cycle leaves the mote short of it; one that ran two leaves
// it on `(-1, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  stepAction,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's one spoke at rotation `0`, and the hex its gripper stands on. */
const SPOKE = 0;
const GRIPPED = at(1, 0);

/** Where one clockwise step about the arm's base carries the held mote. */
const LANDING = rotateAbout(GRIPPED, ORIGIN, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs one full cycle and leaves the run paused on the next boundary", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["rotate-cw"]),
    ]),
    paused: true,
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, GRIPPED, "dust");
  await takeGrip(h, arm, SPOKE, carried);

  const posed = await h.snapshot();
  assertNotNull(posed.sim, "startRun leaves a live run, held at its settle");
  assertEqual(
    posed.sim?.status,
    "paused",
    "the run stands paused, which is the status this point presses step in",
  );
  assertEqual(
    posed.sim?.cycle,
    0,
    "the run stands at a boundary: no cycle has run",
  );
  assertNear(
    posed.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the run stands at a boundary, with nothing of cycle 0 accumulated",
  );
  assertEqual(
    heldBy(posed, arm, SPOKE),
    carried,
    "the arm's gripper holds the mote on (1, 0) before the cycle runs",
  );
  assertLength(
    gripsOf(posed, arm),
    1,
    "the arm holds exactly one constellation, and nothing else on the field is held",
  );

  await captureReplay(h, "stepped", () => stepAction(h));

  const stepped = await h.snapshot();
  assertEqual(
    stepped.sim?.status,
    "paused",
    "step always leaves the run paused",
  );
  assertEqual(
    stepped.sim?.cycle,
    1,
    "one whole cycle ran, so its boundary raised sim.cycle by exactly 1",
  );
  assertNear(
    stepped.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the step stopped on the boundary, with nothing of the next cycle accumulated",
  );
  assertEqual(
    poseOf(stepped, arm)?.rotation,
    1,
    "the cycle's motion step ran: the arm's direction turned one step clockwise",
  );
  assertLength(
    gripsOf(stepped, arm),
    1,
    "the grip persists across the cycle, since nothing dropped it",
  );
  assertEqual(
    gripsOf(stepped, arm)[0]?.mote,
    carried,
    "the arm is still holding the same mote it began the cycle holding",
  );
  assertEqual(
    moteById(stepped, carried)?.q,
    LANDING.q,
    `the held mote landed on a hex center one clockwise step round, at q ${LANDING.q}`,
  );
  assertEqual(
    moteById(stepped, carried)?.r,
    LANDING.r,
    `the held mote landed on a hex center one clockwise step round, at r ${LANDING.r}`,
  );
});
