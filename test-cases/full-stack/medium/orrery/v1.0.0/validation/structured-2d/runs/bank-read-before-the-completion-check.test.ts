// runs/bank-read-before-the-completion-check — the completing boundary is banked
// before the check that ends the run reads the bank.
//
// THE RULE. The boundary sequence fixes the order: "the sigil phase, then sets,
// then rises, then the area bank, then the completion check"
// (`specs/simulation.md`, Cycles and the clock), and the bank's own clause says
// it again: "After every boundary, the settle included, it takes the hex of every
// mote and of every gripper, BEFORE that boundary's completion check reads it"
// (Completion and metrics). What the check records is that reading: "After the
// rises, if every set's tally has reached the challenge's `target`, the run
// completes: the status becomes `complete` and the metrics are recorded", with
// `area` "The size of the area bank below".
//
// THE CONFIGURATION PUTS A FRESH HEX UNDER THE COMPLETING BOUNDARY. The challenge
// is `ONE_DELIVERY`, whose `target` is `1`, so a single acceptance completes the
// run; `specs/formats.md` requires only that a target is "at least `1`", and a
// loaded document is a challenge like any other. The machine is the set for its
// one product, placed on `(0, -3)`, and one `arm` at the origin, rotation `0`, at
// `ARM_MAX_LEN` (`3`), whose tape is a single `rotate-cw`. A `sol` is spawned
// resting, unbonded and unheld, on the set's footprint hex.
//
// So cycle `0`'s boundary does two things at once. Its sets step accepts the
// `sol` and takes the one tally to the target; and its gripper, which carried
// nothing and touched nothing, has come to rest three hexes away on a hex NO
// EARLIER BOUNDARY BANKED. The bank must take that hex before the completion
// check reads it, so the recorded `area` is four: the arm's anchor, the set's
// footprint hex, the gripper's resting hex, and the hex the sweep reached. A
// build that read the bank first would record three.
//
// THE VERDICT. The run completes on that boundary, and `sim.metrics.area` is
// four — the count `specs/field.md`'s own rotation predicts for the hexes above.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { at, rotateAbout, type Hex } from "../field";
import { armPart, setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";
import { gripperHexes } from "../parts";

/** Where the set stands, which is also where the delivery rests. */
const SET_HEX = at(0, -3);

/** The set for the one product, and one long arm that sweeps beside it. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["rotate-cw"]),
  setPart(0, SET_HEX.q, SET_HEX.r),
]);

const key = (hex: Hex): string => `${hex.q},${hex.r}`;

/** The arm's resting gripper hex, and the one its single clockwise step reaches. */
const RESTING_HEX = gripperHexes("arm", ORIGIN, 0, ARM_MAX_LEN)[0] as Hex;
const SWEPT_HEX = rotateAbout(RESTING_HEX, ORIGIN, 1);

/** What the bank holds when the completion check reads it. */
const BANKED = new Set([ORIGIN, SET_HEX, RESTING_HEX, SWEPT_HEX].map(key));

/** The same bank read one step too early: what a wrong order would record. */
const BANKED_TOO_EARLY = new Set([ORIGIN, SET_HEX, RESTING_HEX].map(key));

/** The product the delivery counts against, and the target it reaches. */
const PRODUCT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records an area that includes the hex the completing boundary reached", async () => {
  await openRun(h, { challenge: ONE_DELIVERY, machine: MACHINE });
  await spawnMote(h, SET_HEX, "sol");

  const opened = await h.snapshot();

  await captureReplay(h, "completing", () => advanceCycles(h, 1));

  const completed = await h.snapshot();
  assertEqual(
    BANKED.size - BANKED_TOO_EARLY.size,
    1,
    "the scenario turns on one hex: the one the completing boundary itself banks",
  );
  assertNotNull(opened.sim, "the run is live once it has been started");
  assertEqual(
    opened.sim?.area,
    BANKED_TOO_EARLY.size,
    "before the completing cycle the bank holds the anchor, the set's hex and the resting gripper hex",
  );
  assertNotNull(completed.sim, "the run is still reported after it completed");
  assertEqual(
    completed.sim?.status,
    "complete",
    "the boundary's sets step takes the one tally to the target of 1, so the completion check completes the run",
  );
  assertEqual(
    tallyOf(completed, PRODUCT),
    ONE_DELIVERY.target,
    "the delivery really happened: the set consumed the sol resting on its footprint",
  );
  assertNotNull(completed.sim?.metrics, "a completed run records its metrics");
  assertEqual(
    completed.sim?.metrics?.area,
    BANKED.size,
    "the bank takes that boundary's motes and grippers BEFORE that boundary's completion check reads it, so the recorded area includes the hex the machine reached at the completing boundary",
  );
});
