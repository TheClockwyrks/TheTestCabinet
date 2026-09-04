// collision/fetch-fault-precedes-drops-and-grabs — a fetch fault stops the cycle
// before its drops.
//
// THE RULE, in the cycle order (`specs/simulation.md`, Cycles and the clock):
//
//   1. Fetch. ... "A non-blank cell the part cannot perform raises the fault named
//      for it under Faults."
//   2. Drops. "Every gripper of every part whose instruction is `drop` opens."
//   3. Grabs. ...
//
// And "A fault freezes the run where it stood: the status becomes `faulted` and
// nothing advances further" (Faults). So the fault raised at step 1 stops the
// cycle before step 2, and a gripper whose cell for this cycle is `drop` is still
// holding what it held.
//
// THE CONFIGURATION. Two parts, far apart so neither reaches the other:
//
//   * an arm at `(0, 0)` standing on no track with `advance` in cell `0`, which
//     the fetch refuses as `unmounted` — "`unmounted` — `advance` or `recede` on a
//     part not on a track";
//   * an arm at `(0, 3)` at rotation `0`, gripper `(1, 3)`, with `drop` in cell
//     `0`, holding one mote there.
//
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so the grip under test was never taken by a cycle
// that could also have dropped it.
//
// THE FAULT IS A VEHICLE, NOT THE SUBJECT. Any fetch fault would serve, and this
// one is deliberately not the fault the `overextended` and `track-end` items
// decide, so a build that broke one of those loses those points rather than also
// hiding this one.
//
// THE VERDICT. The run faults as `unmounted`, and the arm's gripper still holds
// the mote it held before the cycle: the drop that its tape called for never ran.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a dropping gripper still holding once the fetch has faulted", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["advance"]),
      armPart("arm", 0, 3, 0, 1, ["drop"]),
    ]),
  });
  const placed = await partIds(h);
  const dropper = placed[1] ?? -1;
  const held = await spawnMote(h, at(1, 3), "dust");
  await takeGrip(h, dropper, 0, held);

  const before = await h.snapshot();
  assertEqual(
    heldBy(before, dropper, 0),
    held,
    "the arm holds the mote before the cycle runs",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "grips");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live after the fault");
  assertEqual(
    after.sim?.fault?.kind,
    "unmounted",
    "advance on a part standing on no track is refused at the fetch",
  );
  assertLength(
    gripsOf(after, dropper),
    1,
    "the dropping gripper is still closed after the fault",
  );
  assertEqual(
    heldBy(after, dropper, 0),
    held,
    "the fetch fault stopped the cycle before its drops, so the gripper is still holding",
  );
});
