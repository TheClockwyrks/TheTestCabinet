// collision/move-onto-occupied-hex-faults — a move that ends on an occupied hex
// faults rather than landing two motes on one hex.
//
// THE RULE, stated on its own beneath the worked examples: "A move ending on a hex
// another mote rests on faults: the sample at `t = 8/8` finds the two motes at
// distance `0`" (`specs/simulation.md`, Collision). It follows from the sampling
// rule rather than from a separate occupancy test — `t = 8/8` is one of the eight
// samples, and `0` is strictly less than `38` — and it is what keeps the invariant
// `specs/field.md` states: "At rest a mote sits exactly on a hex center, and at
// most one mote occupies a hex."
//
// THE CONFIGURATION. An arm at `(0, 0)`, length 1, rotation `0`, carries a mote
// from its gripper hex `(1, 0)` with `rotate-cw`, which turns the offset `(1, 0)`
// into `(0, 1)` (`specs/field.md`). A second mote rests on `(0, 1)`, the hex the
// carry ends on. The two motes are the whole of the field.
//
// THE VERDICT. The run faults as `collision` and names both motes. The freeze
// fraction is deliberately NOT asserted: the pair closes steadily as the carry
// sweeps in, so the first sample within `38` precedes `t = 8/8`, and which sample
// that is depends on the arc rather than on the rule under test. What the rule
// fixes is that the cycle does not complete with the two motes sharing `(0, 1)`,
// so the reading is that the run faulted and that no hex ends up holding two.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
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

it("faults as collision rather than ending two motes on one hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm, 0, carried);
  const resting = await spawnMote(h, at(0, 1), "dust");

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "a carry onto an occupied hex faults rather than completing its cycle",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "the two motes reach distance 0 at t = 8/8, which is within 38",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [carried, resting].sort((a, b) => a - b),
    "the fault names the carried mote and the mote it was ending on",
  );

  const occupancy = new Map<string, number>();
  for (const mote of sim?.motes ?? []) {
    const hex = `${mote.q},${mote.r}`;
    occupancy.set(hex, (occupancy.get(hex) ?? 0) + 1);
  }
  assertEqual(
    [...occupancy.values()].filter((count) => count > 1).length,
    0,
    "at most one mote occupies a hex, so the faulted run left none doubled up",
  );
});
