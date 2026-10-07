// simulation/fetch-precedes-the-grippers — a fetch fault halts the cycle before
// any gripper moves.
//
// THE RULE, from the cycle order of `specs/simulation.md` (Cycles and the clock):
//
//   1. Fetch. "Each part reads its tape cell for this cycle... A non-blank cell
//      the part cannot perform raises the fault named for it under Faults."
//   2. Drops. "Every gripper of every part whose instruction is `drop` opens."
//   3. Grabs. "Every gripper of every part whose instruction is `grab` closes; a
//      gripper over a mote that is not a fixture takes hold of that mote's
//      constellation."
//
// And under Faults: "A fault freezes the run where it stood: the status becomes
// `faulted` and nothing advances further." Fetch is step 1, so a fault raised
// there stops the cycle before steps 2 and 3 ever run: no gripper of any part
// opens or closes, and nothing moves that cycle.
//
// THE CONFIGURATION. Two parts, far enough apart that neither reaches the other:
//
//   * an `arm` on `(0, 0)` with `extend` in cell `0`, which the fetch refuses as
//     `impossible` — "`extend` or `retract` on a part that is not a piston"
//     (`specs/simulation.md`, Faults);
//   * an `arm` on `(0, 3)` at rotation `0`, whose gripper is therefore `(1, 3)`
//     ("one gripper per spoke at `base + length * DIRS[d]`", `specs/parts.md`),
//     with `grab` in cell `0`, and one mote resting on that gripper hex.
//
// Only the first of the two faults, so which part the run names is not in question
// here; what is in question is whether the second one's grab ran.
//
// AND THE GRAB WOULD OTHERWISE HAVE TAKEN HOLD. The suite poses the grabbing arm
// ALONE first and runs the same cycle, reading the hold back off `sim.grips`.
// Without that reading a build whose grippers never close at all would pass the
// check that follows on the strength of doing nothing.
//
// THE VERDICT. With the faulting part on the field the run ends the cycle
// `faulted` as `impossible`, and `sim.grips` is EMPTY: the grab step never ran.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  heldBy,
  openBareRun,
  partIds,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves sim.grips empty when the fetch faulted, though the grab would have closed", async () => {
  // The control: the grabbing arm alone, on the same cycle, with nothing to
  // fault the fetch. Its gripper closes over the mote resting on (1, 3).
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 3, 0, 1, ["grab"])]),
  });
  const lone = (await partIds(h))[0] ?? -1;
  const loose = await spawnMote(h, at(1, 3), "dust");

  await advanceCycles(h, 1);

  const control = await h.snapshot();
  assertNotNull(control.sim, "the run is live through the control cycle");
  assertEqual(
    control.sim?.status,
    "running",
    "nothing on the field faults the control cycle",
  );
  assertLength(
    control.sim?.grips ?? [],
    1,
    "the grab step closes the arm's one gripper over the mote beneath it",
  );
  assertEqual(
    heldBy(control, lone, 0),
    loose,
    "a gripper over a mote that is not a fixture takes hold of that mote's constellation",
  );

  // The subject: the same grabbing arm, with an arm whose `extend` the fetch
  // refuses standing beside it.
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["extend"]),
      armPart("arm", 0, 3, 0, 1, ["grab"]),
    ]),
  });
  const placed = await partIds(h);
  const faulting = placed[0] ?? -1;
  await spawnMote(h, at(1, 3), "dust");

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "faulted");

  const after = await h.snapshot();
  const sim = after.sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "extend on a plain arm is refused at the fetch, so the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "impossible",
    "extend on a part that is not a piston is impossible",
  );
  assertEqual(
    sim?.fault?.parts[0],
    faulting,
    "a fetch fault names the faulting part",
  );
  assertLength(
    sim?.grips ?? [],
    0,
    "fetch is the first step of the cycle, so the fault stopped it before any gripper closed",
  );
  assertEqual(
    sim?.cycle,
    0,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
});
