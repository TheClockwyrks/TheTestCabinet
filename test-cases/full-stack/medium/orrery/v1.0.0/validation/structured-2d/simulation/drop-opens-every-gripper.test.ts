// simulation/drop-opens-every-gripper — one `drop` opens all of a part's grippers,
// not just one.
//
// THE RULE. The cycle's drop step is written over the whole part: "2. Drops. Every
// gripper of every part whose instruction is `drop` opens" (`specs/simulation.md`).
// The instruction says the same: "`drop` — Every gripper opens, releasing whatever
// it held" (`specs/instructions.md`). What it leaves behind is fixed by the motion
// table's last row — "`grab`, `drop`, blank | None. | None." — so the released
// constellations are not moved by the release, and by `specs/instrumentation.md`
// on releasing a grip: it leaves "what it held resting where it stands".
//
// WHICH GRIPPERS A PART HAS. `specs/parts.md` (Arms): one gripper per spoke at
// `base + length * DIRS[d]`, and a `triarm` carries the spokes "`rotation`,
// `rotation + 2`, `rotation + 4`". The suite reads those spokes and hexes out of
// `parts.ts`, which carries the same rule.
//
// THE CONFIGURATION. A triarm on `(0, 0)` at rotation `0`, length `1`, so its
// three grippers stand on `(1, 0)`, `(-1, 1)` and `(0, -1)`. One lone mote rests
// under each, and each is HELD before the cycle begins — the holds are given with
// `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so the only instruction that has ever run on this
// machine is the `drop` under test. The three motes are the whole of the field and
// stand `HEX_PITCH * sqrt(3)` (`83.14`) apart, outside the `38` the collision rule
// watches.
//
// THE HOLDS ARE READ BEFORE THE CYCLE, so a build that reports no grips at all is
// caught there rather than passing on an empty `sim.grips` afterwards.
//
// THE VERDICT. After the cycle the run reports NO grip for that part — `sim.grips`
// holds no entry naming it, on any spoke — and all three released motes are still
// resting on the hexes they stood on. A build that opens only the first spoke ends
// with two grips left.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The triarm's anchor, rotation and length. */
const BASE = at(0, 0);
const ROTATION = 0;
const LENGTH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens all three of a triarm's grippers on one drop", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("triarm", BASE.q, BASE.r, ROTATION, LENGTH, ["drop"]),
    ]),
  });
  const triarm = (await partIds(h))[0] ?? -1;

  const spokes = spokesOf("triarm", ROTATION);
  assertLength(
    spokes,
    3,
    "a triarm carries the spokes rotation, rotation + 2 and rotation + 4",
  );
  const held: { spoke: number; mote: number; hex: ReturnType<typeof at> }[] =
    [];
  for (const spoke of spokes) {
    const hex = gripperHex(BASE, spoke, LENGTH);
    const mote = await spawnMote(h, hex, "dust");
    await takeGrip(h, triarm, spoke, mote);
    held.push({ spoke, mote, hex });
  }

  assertLength(
    gripsOf(await h.snapshot(), triarm),
    spokes.length,
    "all three grippers are holding when the dropping cycle begins",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "released");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "drop imposes no motion, so three motes resting 83.14 apart never come within 38",
  );
  assertLength(
    gripsOf(boundary, triarm),
    0,
    "drop opens EVERY gripper of the part, so sim.grips holds no entry for it afterwards",
  );
  for (const entry of held) {
    const mote = moteById(boundary, entry.mote);
    assertNotNull(
      mote,
      `the run reports the mote released from spoke ${entry.spoke}`,
    );
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${entry.hex.q},${entry.hex.r}`,
      `the constellation released from spoke ${entry.spoke} stays on the hex it stood on`,
    );
    assertNear(
      mote?.x ?? Number.NaN,
      hexCenter(entry.hex).x,
      DRAWN_TOLERANCE,
      `the constellation released from spoke ${entry.spoke} rests on its hex center`,
    );
    assertNear(
      mote?.y ?? Number.NaN,
      hexCenter(entry.hex).y,
      DRAWN_TOLERANCE,
      `the constellation released from spoke ${entry.spoke} rests on its hex center`,
    );
  }
});
