// instructions/blank-on-an-unable-part-never-faults — a part's limits raise
// nothing on a blank cell.
//
// THE RULE. "A blank cell is a rest on every part, a wheel included, and never
// faults" (`specs/simulation.md`, Cycles and the clock). Every fetch fault is
// written against a NON-BLANK cell — "A non-blank cell the part cannot perform
// raises the fault named for it under Faults" — so a part whose limits would
// refuse `extend`, `retract`, `advance` and `recede` still rests on a blank.
//
// THE CONFIGURATION, a part that both limits reach at once. One plain `arm` at
// the origin, on an otherwise empty machine and an empty field. It is not a
// piston, so "`impossible` — `extend` or `retract` on a part that is not a
// piston" would refuse both length instructions; and the machine holds no track,
// so its anchor is a cell of none — "An arm or wheel whose anchor hex is a cell
// of a track is mounted on that track" (`specs/parts.md`) — and "`unmounted` —
// `advance` or `recede` on a part not on a track" would refuse both track
// instructions.
//
// Its tape holds a blank at column `0` and `rotate-cw` at column `1`, so the
// tape's length is `2`, the machine's period is `2`, and cycle `0` fetches a
// WRITTEN blank rather than a cell past the tape's end. The cell at column `1` is
// deliberately one the arm CAN perform, so no reading here turns on when an
// unperformable cell is noticed — that is a point of its own.
//
// THE VERDICT. Cycle `0` reaches its boundary: `sim.status` is `running`,
// `sim.fault` is `null` — neither `impossible` nor `unmounted` — and `sim.cycle`
// is `1`. And the arm RESTED rather than being skipped: its live rotation is the
// rotation it began the cycle with.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  partsOfKind,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs an unmounted plain arm's blank cell to the boundary, raising neither impossible nor unmounted", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [null, "rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertLength(
    partsOfKind(before, "track"),
    0,
    "no track is placed, so the arm's anchor hex is a cell of none",
  );
  const was = poseOf(before, arm);
  assertNotNull(
    was,
    "the run carries a live pose for the arm before the cycle",
  );

  await captureReplay(h, "no-fault", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a blank cell is a rest on every part, so the cycle runs to its boundary",
  );
  assertNull(
    after.sim?.fault ?? null,
    "a blank cell never raises the fault the part's limits would: neither impossible nor unmounted",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );
  const now = poseOf(after, arm);
  assertNotNull(now, "the run still carries a live pose for the arm");
  assertEqual(
    now?.rotation,
    was?.rotation,
    "the arm rested through its blank cell rather than turning",
  );
});
