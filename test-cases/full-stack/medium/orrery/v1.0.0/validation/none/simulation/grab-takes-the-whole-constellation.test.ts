// simulation/grab-takes-the-whole-constellation — one gripper takes the whole
// group, however long the chain.
//
// THE RULE. "3. Grabs. Every gripper of every part whose instruction is `grab`
// closes; a gripper over a mote that is not a fixture takes hold of that mote's
// CONSTELLATION" (`specs/simulation.md`) — the constellation, not the mote. What a
// constellation is comes from `specs/field.md`: "A constellation is a maximal
// group of motes connected by filaments." And what being held means comes from the
// motion table: an instruction imposes its motion "on each held constellation",
// and "A carried constellation moves as one rigid body: every mote of it follows
// the motion".
//
// THE CONFIGURATION. A piston on `(0, 0)` at rotation `0`, length `1`, so its one
// gripper stands on `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`). A chain of FOUR motes rests east along `r = 0` — `(1, 0)`,
// `(2, 0)`, `(3, 0)`, `(4, 0)` — joined head to tail by three filaments, so the
// tail is three links from the mote the gripper is over. Only the head is under a
// gripper; the other three are reached along the chain or not at all.
//
// The piston's tape is `grab`, then `extend`, so the two cycles separate the two
// questions: the first takes the hold, the second carries it. `extend` imposes
// "Translation by the same vector, linearly in `t`" on each held constellation,
// and its gripper "translat[es] one hex along its spoke" — east, by `(1, 0)`.
//
// THE CHAIN IS THE WHOLE OF THE FIELD, and a rigid translation holds every
// distance in it, so the nearest pair stands `HEX_PITCH` (`48`) apart at every
// sample of both cycles, outside the `38` the collision rule watches. `(4, 0)`
// slides to `(5, 0)`, which is still on the field of radius `FIELD_R` (`5`).
//
// THE VERDICT. After the grab the run reports exactly one grip, on the head. After
// the extend, ALL FOUR motes have moved one hex east — the tail included, three
// filaments from the mote that was actually gripped. A build that carries only the
// gripped mote, or only its immediate neighbours, leaves the far ones behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  type Harness,
} from "../harness";

/** The chain, head first: the head is the only mote under a gripper. */
const CHAIN: readonly Hex[] = [at(1, 0), at(2, 0), at(3, 0), at(4, 0)];

/** Where each link of the chain stands after one `extend` carries it east. */
const CARRIED: readonly Hex[] = [at(2, 0), at(3, 0), at(4, 0), at(5, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a four-mote chain by the one gripper that closed over its head", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 1, ["grab", "extend"])]),
  });
  const piston = (await partIds(h))[0] ?? -1;
  const ids = await spawnConstellation(
    h,
    CHAIN.map((hex) => ({ hex, type: "dust" as const })),
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ],
  );

  const seen = await captureReplay(h, "carried", async () => {
    await advanceCycles(h, 1);
    const grabbed = await h.snapshot();
    await advanceCycles(h, 1);
    return { grabbed, carried: await h.snapshot() };
  });

  assertLength(
    gripsOf(seen.grabbed, piston),
    1,
    "the piston has one gripper, and it closed over the mote on its hex",
  );
  assertEqual(
    heldBy(seen.grabbed, piston, 0),
    ids[0] ?? -1,
    "grab closes the gripper over the head of the chain",
  );

  assertEqual(
    seen.carried.sim?.status,
    "running",
    "a rigid translation holds every distance in the chain, so no pair comes within 38",
  );
  assertEqual(
    seen.carried.sim?.cycle,
    2,
    "the grab cycle and the extend cycle both reached their boundaries",
  );
  for (const [index, landed] of CARRIED.entries()) {
    const mote = moteById(seen.carried, ids[index] ?? -1);
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${landed.q},${landed.r}`,
      `mote ${index} of the chain, ${index} filaments from the gripped head, followed the part's motion`,
    );
  }
  assertLength(
    seen.carried.sim?.filaments ?? [],
    3,
    "the carried chain keeps the three filaments that make it one constellation",
  );
});
