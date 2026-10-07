// simulation/retract-carries-the-constellation — `retract` translates the held
// constellation one hex inward.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`extend`, `retract` — The piston's length changes by one, its gripper
// translating one hex along its spoke. | Translation by the same vector, linearly
// in `t`." "The same vector" is the gripper's own step, and what it applies to is
// the whole group: "A carried constellation moves as one rigid body: every mote of
// it follows the motion, and at `t = 1` every mote lands exactly on a hex center",
// with `specs/field.md` fixing rigidity — "when any mote of one is carried, the
// whole group moves as a body and every filament keeps its length and relative
// direction".
//
// WHICH VECTOR. `specs/parts.md` puts "one gripper per spoke at
// `base + length * DIRS[d]`", so lowering the length of a piston based on `(0, 0)`
// at rotation `0` from `2` to `1` carries its gripper from `(2, 0)` to `(1, 0)` —
// a translation by the negative of `DIRS[0]`, which `specs/field.md` gives as
// `(+1, 0)`.
//
// THE CONFIGURATION. One `piston` on `(0, 0)` at rotation `0`, rest length `2`,
// with `retract` in cell `0`. The constellation is TWO motes, on `(2, 0)` and
// `(2, 1)`, joined by one filament — adjacent hexes, as `specs/field.md` requires
// — held by the gripper through the mote on its own hex. Only one of the two is on
// a gripper, which is what makes "every mote of a constellation" a reading rather
// than a restatement.
//
// A translation carries both motes by the same vector, so they stay one hex apart
// the whole slide and nothing comes within the `38` the collision rule watches.
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), and the field holds these two motes alone.
//
// THE VERDICT. After one cycle the held mote rests on `(1, 0)` and its partner on
// `(1, 1)` — each translated by `(-1, 0)`, the vector the gripper travelled — and
// the filament still joins them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, translate, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The vector the gripper travels: one step in along spoke 0, the negative of `DIRS[0]`. */
const INWARD: Hex = at(-1, 0);

/** The constellation's two hexes when the cycle begins. */
const START: readonly Hex[] = [at(2, 0), at(2, 1)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("translates every mote of the held constellation one hex in along the spoke", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 2, ["retract"])]),
  });
  const piston = (await partIds(h))[0] ?? -1;
  const motes = await spawnConstellation(
    h,
    START.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  const held = motes[0] ?? -1;
  const trailing = motes[1] ?? -1;
  await takeGrip(h, piston, 0, held);

  await captureReplay(h, "carry", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a rigid pair translated by one vector stays 48 apart, so nothing collides",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertEqual(
    poseOf(after, piston)?.length,
    1,
    "the piston really retracted, so its gripper really travelled one hex in",
  );

  for (const [index, mote] of motes.entries()) {
    const from = START[index] as Hex;
    const to = translate(from, INWARD);
    const landed = moteById(after, mote);
    assertNotNull(
      landed,
      `mote ${index} of the constellation is still reported`,
    );
    assertEqual(
      `${landed?.q},${landed?.r}`,
      `${to.q},${to.r}`,
      `every mote of the held constellation translates by the one-hex vector the gripper travels: (${from.q}, ${from.r}) lands on (${to.q}, ${to.r})`,
    );
  }

  assertNotNull(
    filamentBetween(after, held, trailing),
    "a constellation moves as one rigid body, so the filament still joins the pair",
  );
});
