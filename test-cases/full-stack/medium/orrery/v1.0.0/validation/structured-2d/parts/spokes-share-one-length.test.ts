// parts/spokes-share-one-length — every spoke of a multi-gripper arm stands at the
// one length.
//
// THE RULE. "All spokes of a multi-gripper arm share the one length"
// (`specs/parts.md`, Arms), which is the arm's single `length`: "a base fixed on
// the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]` for each spoke direction `d`". There is one length,
// not one per spoke, so a hexarm at length `2` has all six grippers exactly two
// hexes out.
//
// HOW A GRIPPER'S HEX IS OBSERVED. `grab` closes every gripper and "A gripper over
// a mote takes hold of that mote's constellation" (`specs/instructions.md`);
// `sim.grips` then reports which mote each gripper took
// (`specs/instrumentation.md`). So the hexarm below is ringed TWICE: a mote on
// every hex two out, which every spoke should take, and a mote on every hex one
// out, which no spoke may. A spoke standing at a length of its own grips an inner
// mote or nothing, and either shows.
//
// THE CONFIGURATION. One `hexarm` at `(0, 0)`, rotation `0`, length `2`, tape
// `["grab"]`, on an emptied field carrying nothing but the twelve posed motes. The
// hexarm is the variant with a gripper on every spoke — "`hexarm` — all six" — so
// all six lengths are under test at once. Nothing moves during the cycle —
// "`grab`, `drop`, blank — None" (`specs/simulation.md`) — and no two of the
// twelve motes are closer than one hex, `HEX_PITCH` (`48`), so
// `2 * MOTE_COLLIDE_R` (`38`) is never reached.
//
// THE VERDICT. The cycle reaches its boundary with no fault; the hexarm holds
// exactly six motes, spoke `d` holding the one on `base + 2 * DIRS[d]`; and the
// total grip count of six settles that not one of the inner ring was taken.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
} from "../harness";

/** The one length every spoke must stand at, and the shorter one none may. */
const LENGTH = 2;
const INNER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands all six grippers two hexes out and leaves the inner ring untouched", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("hexarm", ORIGIN.q, ORIGIN.r, 0, LENGTH, ["grab"]),
    ]),
  });
  const hexarm = (await partIds(h))[0] ?? -1;

  const outer: number[] = [];
  const inner: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    outer.push(await spawnMote(h, gripperHex(ORIGIN, d, LENGTH), "dust"));
  }
  for (const d of [0, 1, 2, 3, 4, 5]) {
    inner.push(await spawnMote(h, gripperHex(ORIGIN, d, INNER), "dust"));
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "hexarm");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(sim?.status, "running", "the grab cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );
  assertEqual(
    poseOf(snapshot, hexarm)?.length,
    LENGTH,
    "the hexarm runs the cycle at the one length it was placed at",
  );

  assertLength(
    gripsOf(snapshot, hexarm),
    6,
    "six spokes, six grippers, and every one of them found a mote two hexes out",
  );
  for (const d of [0, 1, 2, 3, 4, 5]) {
    const hex = gripperHex(ORIGIN, d, LENGTH);
    assertEqual(
      heldBy(snapshot, hexarm, d),
      outer[d] ?? -1,
      `spoke ${d} stands at the shared length ${LENGTH}, on (${hex.q}, ${hex.r})`,
    );
  }
  for (const [d, mote] of inner.entries()) {
    assertEqual(
      (sim?.grips ?? []).some((grip) => grip.mote === mote),
      false,
      `no spoke stands one hex out: the inner mote on DIRS[${d}] is held by nothing`,
    );
  }
});
