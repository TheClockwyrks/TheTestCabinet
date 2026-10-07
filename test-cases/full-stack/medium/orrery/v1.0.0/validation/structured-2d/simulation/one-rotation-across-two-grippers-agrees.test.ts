// simulation/one-rotation-across-two-grippers-agrees — two grippers of ONE
// rotating arm impose the same motion, so the constellation they both hold turns
// rather than tearing.
//
// THE RULE. "A constellation may be held by several grippers at once, and the drop
// and grab steps may create that freely. At the start of the motion step, every
// held constellation's imposed motions must agree: each holding gripper imposes
// the motion of its own part's instruction, and unless every imposed motion is the
// same one, the run faults as `torn`. Motions agree when they are all no motion,
// all the same translation vector, or all rotation about the same center in the
// same direction" (`specs/simulation.md`, Held more than once).
//
// Both grippers here belong to ONE part, so both impose that part's own
// instruction: "`rotate-cw`, `rotate-ccw` — The part's direction turns 60 degrees
// about its base, clockwise or counterclockwise ... Motion imposed on each held
// constellation: The same rotation about the base" (`specs/simulation.md`, Motion
// and carrying). One base, one direction, so the two agree, and "A carried
// constellation moves as one rigid body: every mote of it follows the motion, and
// at `t = 1` every mote lands exactly on a hex center."
//
// THE CONFIGURATION. A `biarm` on `(0, 0)` at rotation `0`, length `1`. Its
// anatomy is "a base fixed on the anchor hex, a length, and one gripper per spoke
// at `base + length * DIRS[d]`", and a `biarm`'s spokes are "`rotation`,
// `rotation + 3`" (`specs/parts.md`), so its two grippers stand on `(1, 0)` and
// `(-1, 0)` — `DIRS[0]` is `(+1, 0)` and `DIRS[3]` is `(-1, 0)` (`specs/field.md`).
//
// A chain of three `dust` motes on `(1, 0)`, `(0, 0)` and `(-1, 0)`, joined by two
// plain filaments. "A filament is a rigid link between two motes on adjacent
// hexes" and "A constellation is a maximal group of motes connected by filaments"
// (`specs/field.md`), so the three are ONE constellation and both grippers of the
// biarm hold it. Each hold is given with `setGrip`, "which takes hold with no
// `grab` ever running" (`specs/instrumentation.md`), so no earlier cycle has
// turned the biarm.
//
// Nothing else is on the field, so the rigid body keeps `HEX_PITCH` (`48`) between
// neighbouring motes at every sample and never reaches `2 * MOTE_COLLIDE_R`
// (`38`).
//
// BOTH DIRECTIONS. The item's rule is stated for "rotate-cw or rotate-ccw", so the
// same world is posed twice, once per direction, and each is decided on its own.
//
// THE VERDICT. No fault: the cycle reaches its boundary with `sim.status` still
// `running` and `sim.cycle` at `1`. And it really TURNED rather than clearing by
// standing still: each of the three motes stands on its hex rotated one step about
// `(0, 0)` by the formulas of `specs/field.md` — the mote on the base among them,
// which the rotation leaves where it lies.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE, type InstructionName } from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The biarm's pose: one base, one length, two opposite spokes. */
const ROTATION = 0;
const LENGTH = 1;
const FIRST_SPOKE = 0;
const SECOND_SPOKE = 3;

/** The three hexes the chain of motes rests on, held at the two outer ones. */
const CHAIN = [at(1, 0), ORIGIN, at(-1, 0)] as const;

/** The two directions the rule is stated for, and the step each turns. */
const TURNS: readonly { cell: InstructionName; steps: number }[] = [
  { cell: "rotate-cw", steps: 1 },
  { cell: "rotate-ccw", steps: -1 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns a constellation held by both grippers of one rotating biarm", async () => {
  for (const turn of TURNS) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([
        armPart("biarm", ORIGIN.q, ORIGIN.r, ROTATION, LENGTH, [turn.cell]),
      ]),
    });
    const biarm = (await partIds(h))[0] ?? -1;
    const chain = await spawnConstellation(
      h,
      CHAIN.map((hex) => ({ hex, type: "dust" as const })),
      [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
      ],
    );
    await takeGrip(h, biarm, FIRST_SPOKE, chain[0] ?? -1);
    await takeGrip(h, biarm, SECOND_SPOKE, chain[2] ?? -1);

    const posed = await h.snapshot();
    assertLength(
      gripsOf(posed, biarm),
      2,
      `${turn.cell}: both grippers of the one biarm hold the chain before the cycle begins`,
    );

    await captureReplay(h, "turned", () => advanceCycles(h, 1));

    const snapshot = await h.snapshot();
    const sim = snapshot.sim;
    assertNotNull(sim, `${turn.cell}: the run is live through the cycle`);
    assertNull(
      sim?.fault ?? null,
      `${turn.cell}: two grippers of one part impose the same rotation about the same base in the same direction, so they agree and nothing tears`,
    );
    assertEqual(
      sim?.status,
      "running",
      `${turn.cell}: a cycle that raises no fault leaves the run running`,
    );
    assertEqual(
      sim?.cycle,
      1,
      `${turn.cell}: the cycle ran to its boundary rather than freezing`,
    );
    assertNear(
      sim?.fraction ?? -1,
      0,
      FRACTION_TOLERANCE,
      `${turn.cell}: a completed cycle leaves the fraction on the boundary it reached`,
    );

    for (const [index, from] of CHAIN.entries()) {
      const landed = rotateAbout(from, ORIGIN, turn.steps);
      const mote = moteById(snapshot, chain[index] ?? -1);
      assertEqual(
        `${mote?.q},${mote?.r}`,
        `${landed.q},${landed.r}`,
        `${turn.cell}: the mote from (${from.q}, ${from.r}) rode the one agreed rotation about (0, 0) as part of the rigid body`,
      );
    }
  }
});
