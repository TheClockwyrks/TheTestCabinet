// parts/triarm-carries-alternating-spokes — a `triarm` carries three grippers, one
// on every second spoke.
//
// THE RULE. "one gripper per spoke at `base + length * DIRS[d]` for each spoke
// direction `d`. The part's rotation names its first spoke, and the variant names
// the rest" (`specs/parts.md`, Arms), and the variant table's row for the triarm
// is "`triarm` — `rotation`, `rotation + 2`, `rotation + 4`". `specs/field.md`
// fixes the arithmetic: "Rotating a direction index clockwise adds `1` modulo
// `6`", so the three spokes are two 60 degree steps apart all the way round, and
// the three directions between them carry nothing.
//
// HOW A GRIPPER IS OBSERVED. `grab` makes every gripper visible at once: "Every
// gripper closes. A gripper over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`), and `sim.grips` reports one entry per holding
// gripper as `{ part, spoke, mote }` (`specs/instrumentation.md`). So a mote is
// laid on every one of the six hexes a gripper could stand on at this length, and
// the cycle's one instruction is `grab`.
//
// THE CONFIGURATION. One `triarm` at `(0, 0)`, rotation `3`, length `1`, tape
// `["grab"]`, on an emptied field carrying nothing but the six posed motes. The
// rotation is deliberately not `0`, so the alternating set under test is `3`, `5`,
// `1` rather than the `0`, `2`, `4` a build might carry fixed. Nothing moves
// during the cycle — "`grab`, `drop`, blank — None" (`specs/simulation.md`) — and
// the six motes sit `HEX_PITCH` (`48`) apart, clear of `2 * MOTE_COLLIDE_R`
// (`38`).
//
// THE VERDICT. The cycle reaches its boundary with no fault, `sim.grips` holds
// exactly three entries for the triarm, they are on spokes `3`, `5` and `1`, and
// each holds the mote resting on its own `base + 1 * DIRS[d]`. The three spokes
// between them hold nothing, though a mote was waiting on each.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull, assertNull } from "../assert";
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

/** The triarm's pose: a rotation that is not `0`, and the shortest length. */
const ROTATION = 3;
const LENGTH = 1;

/** The spokes `specs/parts.md` gives a triarm at this rotation. */
const SPOKES = spokesOf("triarm", ROTATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes three grippers, on every second spoke, with a mote waiting on all six", async () => {
  assertEqual(
    SPOKES.join(","),
    "3,5,1",
    "a triarm's spoke set is rotation, rotation + 2 and rotation + 4 modulo 6",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("triarm", ORIGIN.q, ORIGIN.r, ROTATION, LENGTH, ["grab"]),
    ]),
  });
  const triarm = (await partIds(h))[0] ?? -1;

  const waiting: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    waiting.push(await spawnMote(h, gripperHex(ORIGIN, d, LENGTH), "dust"));
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "triarm");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(sim?.status, "running", "the grab cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(sim?.cycle, 1, "the cycle ran to its boundary rather than freezing");
  assertEqual(
    poseOf(snapshot, triarm)?.rotation,
    ROTATION,
    "the triarm stands at the rotation it was placed at",
  );

  assertLength(
    gripsOf(snapshot, triarm),
    3,
    "a triarm carries exactly three grippers, so three of the six waiting motes are held",
  );
  for (const d of [0, 1, 2, 3, 4, 5]) {
    assertEqual(
      heldBy(snapshot, triarm, d),
      SPOKES.includes(d) ? (waiting[d] ?? -1) : null,
      SPOKES.includes(d)
        ? `spoke ${d} is one of the alternating three, and holds the mote on base + ${LENGTH} * DIRS[${d}]`
        : `spoke ${d} lies between two spokes and carries no gripper, so its mote is untouched`,
    );
  }
});
