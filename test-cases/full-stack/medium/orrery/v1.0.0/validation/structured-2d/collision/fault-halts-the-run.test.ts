// collision/fault-halts-the-run — a fault freezes the run where it stood, and
// further game time changes nothing.
//
// THE RULE. "A fault freezes the run where it stood: the status becomes `faulted`
// and nothing advances further" (`specs/simulation.md`, Faults). The clock rule
// says the same from the other side: "The fraction advances only while the status
// is `running`" (Cycles and the clock).
//
// THE CONFIGURATION is example A, which faults as `collision` part way through its
// cycle — at `t = 3/8` — so the freeze catches the machine MID-MOTION, with a live
// pose, a live grip and a fraction that is neither `0` nor `1`. That is the state
// most at risk of drifting on under further time.
//
// THE VERDICT. Everything the snapshot reports of the run is identical before and
// after a further span of game time many cycles long: `sim.cycle`,
// `sim.fraction`, every mote's hex and drawn position, every live pose, every
// grip, and the fault itself. The reading covers the drawn positions as well as
// the hexes because a mote's `x`, `y` are "derived from ... `sim.fraction`"
// (`specs/instrumentation.md`), so a build that kept integrating would show it
// there first.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  type Harness,
  type OrrerySnapshot,
} from "../harness";
import { exampleA } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Everything of the frozen run a further span of game time must leave alone. */
function frozen(snapshot: OrrerySnapshot): unknown {
  const sim = snapshot.sim;
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    fraction: sim?.fraction,
    motes: sim?.motes.map((mote) => ({
      id: mote.id,
      q: mote.q,
      r: mote.r,
      x: mote.x,
      y: mote.y,
    })),
    poses: sim?.poses,
    grips: sim?.grips,
    fault: sim?.fault,
  };
}

it("changes nothing over further game time once it has faulted", async () => {
  await exampleA(h);
  await advanceCycles(h, 1);

  const atFault = await h.snapshot();
  assertNotNull(atFault.sim, "the run is still live after the fault");
  assertEqual(
    atFault.sim?.status,
    "faulted",
    "example A faults, which is the state this check freezes",
  );

  await captureReplay(h, "frozen", () => advanceCycles(h, 12));

  const later = await h.snapshot();
  assertDeepEqual(
    frozen(later),
    frozen(atFault),
    "a faulted run advances no cycle, no fraction, no mote, no pose and no grip",
  );
});
