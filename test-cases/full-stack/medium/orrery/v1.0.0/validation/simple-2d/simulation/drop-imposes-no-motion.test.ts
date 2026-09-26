// simulation/drop-imposes-no-motion — the cycle a part drops in moves neither the
// part nor what it lets go of.
//
// THE RULE, from the last row of the motion table of `specs/simulation.md`
// (Motion and carrying): "| `grab`, `drop`, blank | None. | None. |" — no motion
// of the part, and no motion imposed on each held constellation. The instruction
// itself says only what it opens: "`drop` — Every gripper opens, releasing
// whatever it held" (`specs/instructions.md`), and the surface says the same of
// releasing a grip by hand: it leaves "what it held resting where it stands"
// (`specs/instrumentation.md`).
//
// WHAT "THE PART" IS. A part's live pose is its "rotation, length and cell"
// (`specs/instrumentation.md`, Snapshot shape), each moved by a different
// instruction family, so the part posed here is one that has all three to move: a
// `piston` (its length "changes at run time", `specs/parts.md`) mounted on a
// track. A build that let `drop` disturb any one of the three is caught by the
// reading for that one.
//
// THE CONFIGURATION. An open track along `r = 1` through `(0, 1)`, `(1, 1)`,
// `(2, 1)`; a piston anchored on its middle cell `(1, 1)` at rotation `4` and
// length `2`, whose gripper is therefore `(1, 1) + 2 * DIRS[4]` = `(1, -1)`
// (`specs/parts.md`, with `DIRS[4]` = `(0, -1)` from `specs/field.md`); and a
// two-mote constellation resting on `(1, -1)` and `(2, -1)`, joined by a filament,
// already HELD by that gripper. The hold is given with `setGrip`, "which takes
// hold with no `grab` ever running" (`specs/instrumentation.md`), so the cycle
// under test is the first cycle and the only instruction that has run is the
// `drop` on the piston's tape.
//
// The two motes rest `HEX_PITCH` (`48`) apart, outside the `38` the collision rule
// watches, and they are the whole of the field.
//
// THE DROP REALLY RAN, which is the reading that separates this from a build whose
// simulation does nothing at all: at the boundary the run reports no grip for the
// piston at all, so the gripper this cycle held open really did open.
//
// THE VERDICT. At every one of the cycle's eight sample fractions `k / 8`
// (`specs/simulation.md`, Collision, which is where the fractions a cycle is
// evaluated at are fixed) the piston still reports rotation `4`, length `2` and
// cell `(1, 1)`, and both released motes are still drawn exactly on their own hex
// centers, by the formulas of `specs/field.md`. At the boundary they still report
// the hexes they stood on: the release left them where they were.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { COLLISION_SAMPLES, FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnConstellation,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The gripper's spoke, and the piston's rotation: `DIRS[4]` is `(0, -1)`. */
const SPOKE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the dropping part and what it releases still for the whole cycle", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 1), at(1, 1), at(2, 1)]),
      armPart("piston", 1, 1, SPOKE, 2, ["drop"]),
    ]),
  });
  const piston = (await partIds(h))[1] ?? -1;
  const [near, far] = await spawnConstellation(
    h,
    [
      { hex: at(1, -1), type: "dust" },
      { hex: at(2, -1), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, piston, SPOKE, near ?? -1);

  const readings = await captureReplay(h, "still", async () => {
    const taken: OrrerySnapshot[] = [];
    for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
      await advanceFraction(h, 1 / COLLISION_SAMPLES);
      taken.push(await h.snapshot());
    }
    return taken;
  });

  for (const [index, reading] of readings.entries()) {
    const sample = index + 1;
    const where = `at sample ${sample} / ${COLLISION_SAMPLES} of the dropping cycle`;

    const pose = poseOf(reading, piston);
    assertNotNull(pose, `the run reports the piston's live pose ${where}`);
    assertEqual(
      pose?.rotation,
      SPOKE,
      `drop imposes no motion on the part, so its rotation is unchanged ${where}`,
    );
    assertEqual(
      pose?.length,
      2,
      `drop imposes no motion on the part, so its length is unchanged ${where}`,
    );
    assertEqual(
      `${pose?.cell.q},${pose?.cell.r}`,
      "1,1",
      `drop imposes no motion on the part, so its base cell is unchanged ${where}`,
    );

    for (const [mote, hex] of [
      [near ?? -1, at(1, -1)],
      [far ?? -1, at(2, -1)],
    ] as const) {
      const seen = moteById(reading, mote);
      assertNotNull(seen, `the run reports mote ${mote} ${where}`);
      assertNear(
        seen?.x ?? Number.NaN,
        hexCenter(hex).x,
        DRAWN_TOLERANCE,
        `drop imposes no motion on what it releases, so x is still the hex center ${where}`,
      );
      assertNear(
        seen?.y ?? Number.NaN,
        hexCenter(hex).y,
        DRAWN_TOLERANCE,
        `drop imposes no motion on what it releases, so y is still the hex center ${where}`,
      );
    }
  }

  const boundary = readings[readings.length - 1] as OrrerySnapshot;
  assertEqual(
    boundary.sim?.status,
    "running",
    "two motes resting 48 apart never come within 38, so the cycle reaches its boundary",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertLength(
    gripsOf(boundary, piston),
    0,
    "drop opens every gripper of the part, so the cycle under test is one the part really dropped in",
  );
  assertEqual(
    `${moteById(boundary, near ?? -1)?.q},${moteById(boundary, near ?? -1)?.r}`,
    "1,-1",
    "the released constellation is left on the hexes it stood on",
  );
  assertEqual(
    `${moteById(boundary, far ?? -1)?.q},${moteById(boundary, far ?? -1)?.r}`,
    "2,-1",
    "the released constellation is left on the hexes it stood on",
  );
});
