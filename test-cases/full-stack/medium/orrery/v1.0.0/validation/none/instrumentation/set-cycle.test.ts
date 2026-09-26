// instrumentation/set-cycle — `setCycle` sets the run's cycle counter, and the
// next cycle runs the cell that counter names.
//
// THE RULE. "`setCycle(n)` | Sets `sim.cycle` to `n`, a whole number of at least
// `0`, so the next cycle executes tape cell `n mod P` on every part, where `P` is
// the machine's period" (`specs/instrumentation.md`, The run). `P` is
// "the largest tape length across its arms and wheels"
// (`specs/instructions.md`), and "On cycle `c`, counted from `0`, each part
// executes the cell at index `c` modulo `P` of its own tape".
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run — reset, a posed challenge, an
// empty machine, the completion switch held off, a live run, an empty field —
// with one arm spawned back and nothing else. Its tape is three cells long, so
// `P` is `3`, and the three cells are chosen so that only ONE of them leaves the
// arm where the rule says it must be left: cells `0` and `2` are `rotate-cw` and
// cell `1` is `rotate-ccw`. The field is empty, so the cycle has nothing to
// decide but the arm's own live rotation, and no mote can fault it.
//
// THE VERDICT. `sim.cycle` reads back the posed `7` at the call. `7 mod 3` is
// `1`, and cell `1` is `rotate-ccw` — "The part turns one 60 degree step
// counterclockwise about its base" (`specs/instructions.md`), and "Rotating a
// direction index clockwise adds `1` modulo `6`; counterclockwise subtracts `1`"
// (`specs/field.md`) — so the arm stands at rotation `5` at the boundary, where
// either `rotate-cw` cell would have left it at `1`. The counter carries on from
// the posed figure rather than from zero, so the boundary leaves `8`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The posed counter: `7 mod 3` is cell `1`, which no other cell of the tape is. */
const POSED_CYCLE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets sim.cycle, and the next cycle runs the cell n mod P names", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [
        "rotate-cw",
        "rotate-ccw",
        "rotate-cw",
      ]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setCycle(POSED_CYCLE);
  const posed = await h.snapshot();

  await captureReplay(h, "cycle", () => advanceCycles(h, 1));
  const after = await h.snapshot();

  assertNotNull(posed.sim, "the run is live at the pose");
  assertEqual(
    posed.sim?.cycle,
    POSED_CYCLE,
    "setCycle(7) sets sim.cycle to 7, and the snapshot reads the posed figure back",
  );
  assertNotNull(after.sim, "the run is still live after the cycle it posed");
  assertEqual(
    poseOf(after, arm)?.rotation,
    5,
    "the cycle ran cell 7 mod 3, which is cell 1's rotate-ccw: one step counterclockwise from rotation 0 is 5, where either rotate-cw cell would have left 1",
  );
  assertEqual(
    after.sim?.cycle,
    POSED_CYCLE + 1,
    "the counter carries on from the posed figure: the cycle just run was cycle 7",
  );
});
