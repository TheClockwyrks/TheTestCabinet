// instructions/wheel-runs-rotate-ccw — a wheel performs `rotate-ccw`.
//
// THE RULE. "A wheel executes only `rotate-cw` and `rotate-ccw`"
// (`specs/instructions.md`, The instruction set), and `rotate-ccw` is the 60
// degree step of `rotate-cw` taken "The same, counterclockwise." A wheel "carries
// a tape like an arm; `specs/instructions.md` states which instructions it
// accepts" (`specs/parts.md`). So the cycle that fetches `rotate-ccw` on a wheel
// raises no fault and runs to its boundary.
//
// THE CONFIGURATION. One wheel at the origin, rest rotation `0`, its whole tape
// the single cell `rotate-ccw`, so the machine's period is `1` and cycle `0`
// fetches that cell. `openBareRun` empties the field, which takes the wheel's six
// fixtures with it — "`clearMotes` removes every mote, fixtures included" — so no
// mote is on the field and nothing else can fault or clear in the wheel's place.
//
// THE VERDICT, in two halves. The cycle reaches its boundary: "A cycle completes
// when the accumulated fraction reaches `1`", one cycle of game time leaves
// `sim.cycle` at `1` and the fraction back at `0`, `sim.status` is `running` and
// `sim.fault` is `null` (`specs/simulation.md`).
//
// AND THE WHEEL REALLY TURNED, THE OTHER WAY. A run whose parts never move
// satisfies "no fault" for nothing, so the live rotation is read back as well:
// `sim.poses` carries "one entry per arm and wheel: its live rotation, length,
// and base cell" (`specs/state.md`), and "Rotating a direction index clockwise
// adds `1` modulo `6`; counterclockwise subtracts `1`" (`specs/field.md`), so a
// wheel that began the cycle at rotation `0` ends it at rotation `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a rotate-ccw cycle to its boundary, turning the wheel one step counterclockwise", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-ccw"]),
    ]),
  });
  const wheel = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    poseOf(before, wheel),
    "the run carries a live pose for the wheel, one entry per arm and wheel",
  );
  assertEqual(
    poseOf(before, wheel)?.rotation,
    0,
    "the run starts the wheel at its rest rotation",
  );

  await captureReplay(h, "wheel-turns-ccw", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "a wheel given rotate-ccw performs it, so the cycle does not fault",
  );
  assertNull(
    sim?.fault ?? null,
    "a cycle that raised no fault carries no fault payload",
  );
  assertEqual(
    sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );
  assertNotNull(
    poseOf(snapshot, wheel),
    "the run still carries a live pose for the wheel",
  );
  assertEqual(
    poseOf(snapshot, wheel)?.rotation,
    5,
    "rotate-ccw turns the part one 60 degree step counterclockwise, and a direction index turned counterclockwise subtracts 1 modulo 6",
  );
});
