// runs/settle-spawns-the-rises — the settle runs before cycle `0`, so a placed
// rise has already delivered its reagent by the time the counter reads `0`.
//
// THE RULE. "Starting a run: ... 2. The settle runs: one pass of the boundary
// sequence defined below, on a field holding only fixtures. 3. The cycle counter
// starts at `0` and the machine begins cycle `0`" (`specs/simulation.md`, The
// run). The boundary sequence is "the sigil phase, then sets, then rises, then
// the area bank, then the completion check", so the settle is a pass of it that
// reaches the rises; and the rise's own condition is `specs/sigils.md`: "When
// every footprint hex is vacant, the reagent appears: one new mote per pattern
// mote and one filament per pattern filament, at the placed pose, unheld."
//
// THE CONFIGURATION. `BARE`, whose one reagent is a single `sol` on `(0, 0)`, so
// the rise's footprint is the one hex it is anchored on and what it delivers is
// one unbonded mote there. Beside it, one arm whose tape is a single `rotate-cw`.
// The arm is the check's witness that NO CYCLE HAS RUN: cycle `0` would execute
// its tape cell and turn it, so an arm still at rotation `0` is an arm whose
// cycle has not been fetched. Nothing else is placed, and no frame is advanced
// before the reading — the reagent is read out of the state `startRun` left.
//
// THE VERDICT. A `sol` rests on the rise's footprint hex; `sim.cycle` is `0` and
// `sim.fraction` is `0`; and the arm's live rotation is still its placed `0`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { armPart, risePart, solution } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteAt,
  openRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The rise for `BARE`'s one reagent, and one arm whose cycle `0` would turn it. */
const MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
]);

/** Where the arm sits in the machine's placement order. */
const ARM_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has spawned the rise's reagent by the time the counter reads cycle 0", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[ARM_INDEX] ?? -1;

  const settled = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "settled");

  assertNotNull(settled.sim, "the run is live once it has been started");

  const reagent = moteAt(settled, WEST);
  assertNotNull(
    reagent,
    "the settle reached the rises, so the rise whose footprint hex was vacant has spawned its reagent",
  );
  assertEqual(
    reagent?.type,
    "sol",
    "BARE's one reagent is a single sol, and the rise delivers one new mote per pattern mote",
  );
  assertLength(
    settled.sim?.motes ?? [],
    1,
    "the machine holds one rise and no wheel, so the reagent is the whole of what the settle raised",
  );

  assertEqual(
    settled.sim?.cycle,
    0,
    "the settle runs BEFORE cycle 0 begins, so the counter reads 0 with the reagent already on the field",
  );
  assertNear(
    settled.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "no cycle has run, so no fraction has accumulated",
  );

  assertNotNull(
    poseOf(settled, arm),
    "the run reports a live pose for the arm",
  );
  assertEqual(
    poseOf(settled, arm)?.rotation,
    0,
    "no cycle has run: cycle 0 would have fetched the arm's rotate-cw and turned it off its placed rotation",
  );
});
