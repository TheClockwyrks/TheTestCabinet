// instructions/cycle-zero-executes-cell-zero — the first cycle of a run runs cell
// `0`, because cycles are counted from `0`.
//
// THE RULE. "On cycle `c`, counted from `0`, each part executes the cell at index
// `c` modulo `P` of its own tape" (`specs/instructions.md`, Tapes and the
// period), and `specs/simulation.md` fixes where the counter starts and what it
// means: "The cycle counter starts at `0` and the machine begins cycle `0`" (The
// run), "`sim.cycle` counts completed cycles. The cycle now running is cycle
// `sim.cycle`, and each arm and wheel executes its tape cell at index `sim.cycle`
// modulo the period `P`" (Cycles and the clock). `startRun` states the same
// figure: "`sim.cycle` at `0`, `sim.fraction` at `0` ... `sim.status` `running`"
// (`specs/instrumentation.md`). `0 modulo P` is `0`, so the FIRST cycle is cell
// `0`'s.
//
// THE CONFIGURATION. A bare run — reset, a posed challenge, an empty machine, the
// completion switch held off, a live run, an empty field — with one `piston` at
// `(0, 0)` spawned back and nothing else. Its tape is two cells long, and the two
// cells move DIFFERENT things: cell `0` is `extend`, "A piston's length rises by
// one", and cell `1` is `rotate-cw`, "The part turns one 60 degree step clockwise
// about its base" (`specs/instructions.md`). So the pose at the first boundary
// says which cell ran, with no third answer available. The field is empty, so
// nothing can collide and no sigil can act.
//
// THE REST POSE IS READ FIRST. "Each run starts every arm at its rest pose"
// (`specs/parts.md`), and the piston is placed at rotation `0` and length
// `ARM_MIN_LEN` (`1`), so the reading before the cycle is `(0, 1)` and every
// change in the reading after it belongs to the one cycle that ran.
//
// THE VERDICT. The run begins with `sim.cycle` at `0` and the fraction at `0`;
// one cycle of game time later the piston stands at length `2` and rotation `0` —
// cell `0` ran and cell `1` did not, where a build counting its first cycle as
// cycle `1` would have turned the piston instead — and `sim.cycle` reads `1`,
// naming the cycle just run as cycle `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
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

/** Cell 0 lengthens the piston; cell 1 turns it. Only one of them can have run. */
const TAPE = ["extend", "rotate-cw"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs cell 0 on the first cycle, with sim.cycle at 0", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...TAPE]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const start = await h.snapshot();
  assertNotNull(start.sim, "the run is live before the first cycle");
  assertEqual(
    start.sim?.cycle,
    0,
    "the cycle counter starts at 0 and the machine begins cycle 0",
  );
  assertNear(
    start.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the run begins at the start of cycle 0, with the fraction at 0",
  );
  assertEqual(
    poseOf(start, piston)?.length,
    ARM_MIN_LEN,
    "the run starts the piston at its rest length of 1",
  );
  assertEqual(
    poseOf(start, piston)?.rotation,
    0,
    "the run starts the piston at its rest rotation of 0",
  );

  await captureReplay(h, "first-cycle", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live at the first boundary");
  assertEqual(
    poseOf(after, piston)?.length,
    ARM_MIN_LEN + 1,
    "cycle 0 executed cell 0, the extend: the piston's length rose by one",
  );
  assertEqual(
    poseOf(after, piston)?.rotation,
    0,
    "cell 1's rotate-cw did NOT run: cycles are counted from 0, not from 1",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "the boundary leaves the counter at 1, naming the cycle just run as cycle 0",
  );
});
