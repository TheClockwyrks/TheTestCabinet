// sigils/acts-on-motes-at-rest — the sigil phase reads the field as the boundary
// leaves it, not as the cycle found it.
//
// THE RULE. A sigil "acts at each boundary, the settle included, in the sigil
// phase `specs/simulation.md` defines, on the motes resting on its hexes"
// (`specs/sigils.md`) — the motes AT REST, at the boundary. `specs/simulation.md`
// orders the cycle so that everything a cycle does to the field happens first:
// "2. Drops. Every gripper of every part whose instruction is `drop` opens", then
// grabs, then motion, and only then "5. Boundary. Motes are at rest on hex centers
// again. The boundary sequence runs: the sigil phase, then sets, then rises …". So
// a mote a gripper let go of during the cycle is resting on its hex when that same
// cycle's sigil phase runs.
//
// THE CONFIGURATION. One `void` engraved on `(0, 0)` — "An unbonded, unheld mote
// on the maw is consumed" — and one `arm` anchored on `(1, 0)` at rotation `3` and
// length `1`, whose one gripper stands at "`base + length * DIRS[d]`"
// (`specs/parts.md`), `(1, 0) + (-1, 0)`, which is the maw. An anchor "may sit on
// any sigil footprint hex" (`specs/parts.md`, Placement rules), and `(1, 0)` is
// one of the void's six rim hexes. The arm's tape for the cycle is `drop`, which
// imposes no motion at all ("`grab`, `drop`, blank | None", `specs/simulation.md`),
// so the only thing this cycle does is open that gripper.
//
// THE HOLD IS POSED, NOT TAKEN. `setGrip` "takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so no earlier cycle runs and no earlier
// boundary passes: the boundary under test is the first one the mote is on the maw
// for.
//
// THE VERDICT. ONE cycle, and the mote is gone. The gripper opened at step 2 of
// that cycle, the mote came to rest on the maw unbonded and unheld, and the sigil
// phase of the SAME cycle consumed it. A build whose sigils read the field as it
// stood when the cycle began finds the mote held, waits, and consumes it a cycle
// later — which this fails, because it reads after exactly one cycle.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The void's maw, at rotation `0`: the hex that consumes. */
const MAW = at(0, 0);

/** The arm's anchor: a rim hex, one step east of the maw. */
const ANCHOR = at(1, 0);

/** The arm's rotation, which is its one spoke: `DIRS[3]` is `(-1, 0)`, west. */
const SPOKE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes a mote dropped onto the maw at that same cycle's boundary", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("void", MAW.q, MAW.r, 0),
      armPart("arm", ANCHOR.q, ANCHOR.r, SPOKE, 1, ["drop"]),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const carried = await spawnMote(h, MAW, "dust");
  await takeGrip(h, arm, SPOKE, carried);

  const held = await h.snapshot();
  assertEqual(
    heldBy(held, arm, SPOKE),
    carried,
    "the gripper over the maw is holding the mote when the cycle begins",
  );
  assertLength(
    held.sim?.motes ?? [],
    1,
    "the one mote the check spawned is the only mote on the field",
  );

  await captureReplay(h, "dropped", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the cycle that dropped it");
  assertEqual(
    sim?.status,
    "running",
    "dropping a mote onto a maw halts nothing",
  );
  assertNull(sim?.fault ?? null, "no fault is raised by the drop");
  assertEqual(
    sim?.cycle,
    1,
    "exactly one cycle ran, so anything consumed was consumed at ITS boundary",
  );
  assertNull(
    heldBy(snapshot, arm, SPOKE),
    "the drop step opened the gripper, so nothing holds the mote at the boundary",
  );
  assertNull(
    moteById(snapshot, carried),
    "the mote came to rest on the maw during this cycle and the sigil phase of this cycle consumed it",
  );
  assertLength(
    sim?.motes ?? [],
    0,
    "the field is empty: the dropped mote is the one the maw took",
  );
});
