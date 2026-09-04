// simulation/holders-all-resting-agree — holders that all impose no motion agree,
// however many of them there are.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are ALL NO MOTION, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). Which instructions impose no
// motion is the motion table's last row: "| `grab`, `drop`, blank | None. |
// None. |". And that several grippers may hold at once is explicit: "A
// constellation may be held by several grippers at once, and the drop and grab
// steps may create that freely."
//
// THE CONFIGURATION. One constellation on `(1, 0)` — a lone mote, which
// `specs/field.md` makes "a constellation of one" — reached by THREE grippers, so
// the reading covers "however many holders it has" rather than only the two a pair
// would give. Each arm is placed so its gripper stands on `(1, 0)`: "one gripper
// per spoke at `base + length * DIRS[d]`" (`specs/parts.md`) with the offsets of
// `specs/field.md`:
//
//   * an arm on `(0, 0)` at rotation `0`  — `DIRS[0]` is `(+1, 0)`  — tape `grab`;
//   * an arm on `(2, 0)` at rotation `3`  — `DIRS[3]` is `(-1, 0)`  — tape BLANK;
//   * an arm on `(1, -1)` at rotation `1` — `DIRS[1]` is `(0, +1)` — tape `drop`.
//
// One of each of the three instructions the rule's first clause covers. Every hold
// is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so all three are holding when the cycle begins and
// no earlier cycle has moved anything. The one mote is the whole of the field, so
// the collision rule has no pair and only the agreement check can decide the
// cycle.
//
// THE THREE STEPS REALLY RAN, which is what separates this from a build whose
// simulation does nothing: at the boundary the arm that dropped holds nothing and
// the other two still hold, so the drop step and the grab step both acted, and the
// blank kept "whatever grip it has" (`specs/instructions.md`).
//
// THE VERDICT. No fault of any kind: `sim.status` is `running` and `sim.fault` is
// `null`. And at every one of the cycle's eight sample fractions `k / 8` the mote
// is still on `(1, 0)`, drawn exactly on that hex's center — it rests where it
// stands.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { COLLISION_SAMPLES, FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The hex all three grippers stand over. */
const SHARED = at(1, 0);

/** The three holders, in placement order: the spoke each reaches SHARED by. */
const HOLDERS = [
  { spoke: 0, keeps: true },
  { spoke: 3, keeps: true },
  { spoke: 1, keeps: false },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no fault when three holders all impose no motion", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, HOLDERS[0].spoke, 1, ["grab"]),
      armPart("arm", 2, 0, HOLDERS[1].spoke, 1, []),
      armPart("arm", 1, -1, HOLDERS[2].spoke, 1, ["drop"]),
    ]),
  });
  const placed = await partIds(h);
  const mote = await spawnMote(h, SHARED, "dust");
  for (const [index, holder] of HOLDERS.entries()) {
    await takeGrip(h, placed[index] ?? -1, holder.spoke, mote);
  }
  assertLength(
    (await h.snapshot()).sim?.grips ?? [],
    HOLDERS.length,
    "all three grippers are holding the one constellation when the cycle begins",
  );

  const readings = await captureReplay(h, "still", async () => {
    const taken: OrrerySnapshot[] = [];
    for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
      await advanceFraction(h, 1 / COLLISION_SAMPLES);
      taken.push(await h.snapshot());
    }
    return taken;
  });

  for (const [index, reading] of readings.entries()) {
    const where = `at sample ${index + 1} / ${COLLISION_SAMPLES} of the cycle`;
    assertNull(
      reading.sim?.fault ?? null,
      `grab, a blank and drop all impose no motion, so the three agree and nothing tears ${where}`,
    );
    const resting = moteById(reading, mote);
    assertNotNull(resting, `the run reports the shared constellation ${where}`);
    assertEqual(
      `${resting?.q},${resting?.r}`,
      `${SHARED.q},${SHARED.r}`,
      `a constellation whose holders all impose no motion rests where it stands ${where}`,
    );
    assertNear(
      resting?.x ?? Number.NaN,
      hexCenter(SHARED).x,
      DRAWN_TOLERANCE,
      `the shared constellation sits exactly on its hex center ${where}`,
    );
    assertNear(
      resting?.y ?? Number.NaN,
      hexCenter(SHARED).y,
      DRAWN_TOLERANCE,
      `the shared constellation sits exactly on its hex center ${where}`,
    );
  }

  const boundary = readings[readings.length - 1] as OrrerySnapshot;
  assertEqual(
    boundary.sim?.status,
    "running",
    "three agreeing holders raise no fault, so the cycle reaches its boundary",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  for (const [index, holder] of HOLDERS.entries()) {
    assertLength(
      gripsOf(boundary, placed[index] ?? -1),
      holder.keeps ? 1 : 0,
      holder.keeps
        ? `holder ${index} executed grab or a blank, so it is still holding: the cycle's steps really ran`
        : `holder ${index} executed drop, so it let go: the cycle's steps really ran`,
    );
  }
});
