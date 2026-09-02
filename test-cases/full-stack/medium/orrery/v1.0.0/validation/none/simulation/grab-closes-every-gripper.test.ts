// simulation/grab-closes-every-gripper — one `grab` closes all of a part's
// grippers, not just one.
//
// THE RULE. The cycle's grab step is written over the whole part: "3. Grabs.
// Every gripper of every part whose instruction is `grab` closes; a gripper over a
// mote that is not a fixture takes hold of that mote's constellation"
// (`specs/simulation.md`). The instruction says the same: "`grab` — Every gripper
// closes" (`specs/instructions.md`).
//
// WHICH GRIPPERS A PART HAS. `specs/parts.md` (Arms): the arm kinds "share one
// anatomy: a base fixed on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]` for each spoke direction `d`", and a `triarm` carries
// the spokes "`rotation`, `rotation + 2`, `rotation + 4`". "All spokes of a
// multi-gripper arm share the one length." The suite reads those spokes and hexes
// out of `parts.ts`, which carries the same rule, rather than writing three
// numbers down.
//
// THE CONFIGURATION. A triarm on `(0, 0)` at rotation `0`, length `1`, so its
// three grippers stand on `(1, 0)`, `(-1, 1)` and `(0, -1)`. One lone mote rests
// under each — three separate constellations, since "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) and no filament joins them. The
// triarm's tape holds `grab` alone, and "`grab`, `drop`, blank — None" of the
// motion table, so nothing moves and the three motes stay a full `HEX_PITCH *
// sqrt(3)` (`83.14`) apart, well outside the `38` the collision rule watches.
//
// The three motes are the whole of the field, so a grip the run reports can only
// be a grip on one of them.
//
// THE VERDICT. After the cycle the run reports THREE grips for that one part, one
// per spoke, each holding the mote its own gripper stands over. A build that
// closes only the first spoke, or only the spoke the part's rotation names, ends
// with fewer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  spawnMote,
  type Harness,
} from "../harness";

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

it("closes all three of a triarm's grippers on one grab", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("triarm", BASE.q, BASE.r, ROTATION, LENGTH, ["grab"]),
    ]),
  });
  const triarm = (await partIds(h))[0] ?? -1;

  const spokes = spokesOf("triarm", ROTATION);
  assertLength(
    spokes,
    3,
    "a triarm carries the spokes rotation, rotation + 2 and rotation + 4",
  );
  const under = new Map<number, number>();
  for (const spoke of spokes) {
    under.set(
      spoke,
      await spawnMote(h, gripperHex(BASE, spoke, LENGTH), "dust"),
    );
  }

  await advanceCycles(h, 1);
  await captureStill(h, "grips");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "grab imposes no motion, so three motes resting 83.14 apart never come within 38",
  );
  assertLength(
    gripsOf(boundary, triarm),
    spokes.length,
    "grab closes EVERY gripper of the part, so a triarm over three constellations ends with three grips",
  );
  for (const spoke of spokes) {
    assertEqual(
      heldBy(boundary, triarm, spoke),
      under.get(spoke),
      `the gripper on spoke ${spoke} took hold of the constellation on its own hex`,
    );
  }
});
