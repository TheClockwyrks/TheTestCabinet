// parts/biarm-carries-opposite-spokes — a `biarm` carries two grippers, on
// directly opposite spokes.
//
// THE RULE. "one gripper per spoke at `base + length * DIRS[d]` for each spoke
// direction `d`. The part's rotation names its first spoke, and the variant names
// the rest" (`specs/parts.md`, Arms), and the variant table's row for the biarm
// is "`biarm` — `rotation`, `rotation + 3`". `specs/field.md` fixes what `+ 3`
// means: "Rotating a direction index clockwise adds `1` modulo `6`", so
// `rotation + 3` modulo `6` is the direction three 60 degree steps round, which
// is directly opposite.
//
// HOW A GRIPPER IS OBSERVED. `grab` makes every gripper visible at once: "Every
// gripper closes. A gripper over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`), and `sim.grips` reports one entry per holding
// gripper as `{ part, spoke, mote }` (`specs/instrumentation.md`). So a mote is
// laid on every one of the six hexes a gripper could stand on at this length, and
// the cycle's one instruction is `grab`: the two spokes that exist take hold, and
// the four that do not leave their motes where they lie.
//
// THE CONFIGURATION. One `biarm` at `(0, 0)`, rotation `1`, length `1`, tape
// `["grab"]`, on an emptied field carrying nothing but the six posed motes. The
// rotation is deliberately not `0`, so the pair under test is spokes `1` and `4`
// rather than the `0` and `3` a build might carry fixed. Nothing moves during the
// cycle — "`grab`, `drop`, blank — None" (`specs/simulation.md`) — and the six
// motes sit `HEX_PITCH` (`48`) apart, clear of `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. The cycle reaches its boundary with no fault, `sim.grips` holds
// exactly two entries for the biarm, and they are on spokes `1` and `4`, each
// holding the mote resting on its own `base + 1 * DIRS[d]`. The four spokes
// between them hold nothing, though a mote was waiting on each.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
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

/** The biarm's pose: a rotation that is not `0`, and the shortest length. */
const ROTATION = 1;
const LENGTH = 1;

/** The spokes `specs/parts.md` gives a biarm at this rotation: `1` and `1 + 3`. */
const SPOKES = spokesOf("biarm", ROTATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes two grippers, on opposite spokes, with a mote waiting on all six", async () => {
  assertEqual(
    SPOKES.join(","),
    "1,4",
    "a biarm's spoke set is rotation and rotation + 3 modulo 6, which at rotation 1 is 1 and 4",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("biarm", ORIGIN.q, ORIGIN.r, ROTATION, LENGTH, ["grab"]),
    ]),
  });
  const biarm = (await partIds(h))[0] ?? -1;

  const waiting: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    waiting.push(await spawnMote(h, gripperHex(ORIGIN, d, LENGTH), "dust"));
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "biarm");

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
    poseOf(snapshot, biarm)?.rotation,
    ROTATION,
    "the biarm stands at the rotation it was placed at",
  );

  assertLength(
    gripsOf(snapshot, biarm),
    2,
    "a biarm carries exactly two grippers, so two of the six waiting motes are held",
  );
  for (const d of [0, 1, 2, 3, 4, 5]) {
    assertEqual(
      heldBy(snapshot, biarm, d),
      SPOKES.includes(d) ? (waiting[d] ?? -1) : null,
      SPOKES.includes(d)
        ? `spoke ${d} is one of the opposite pair, and holds the mote on base + ${LENGTH} * DIRS[${d}]`
        : `spoke ${d} lies between the pair and carries no gripper, so its mote is untouched`,
    );
  }
});
