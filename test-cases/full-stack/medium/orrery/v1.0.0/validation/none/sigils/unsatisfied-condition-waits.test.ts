// sigils/unsatisfied-condition-waits — a sigil whose condition does not hold at a
// boundary does nothing, and the run carries on.
//
// THE RULE. "A sigil whose condition does not hold at a boundary waits"
// (`specs/sigils.md`). Waiting is not a fault: `FAULTS` in `specs/simulation.md`
// names every way a run halts and an unsatisfied sigil is none of them, so the
// boundary completes like any other — "When the run does not complete,
// `sim.cycle` increments and the next cycle begins" — and `sim.status` stays
// `running`.
//
// THE CONFIGURATION. One `wane` engraved on `(0, 0)`, and one `dust` resting on
// its seat. `wane`'s condition is "An essence mote on the seat becomes `dust`"
// (`specs/sigils.md`), and `dust` is not an essence: `specs/field.md` classes it
// `base` and "`ESSENCES` holds `nebula`, `comet`, `nova`, `meteor` in that order".
// So the condition does not hold, at this boundary and at every boundary after it.
// Nothing else is placed and nothing else is on the field, so the only sigil that
// could act is the one under test and the only mote it could act on is the one
// under test.
//
// THREE BOUNDARIES, NOT ONE. The item is that a machine carrying an idle sigil
// KEEPS CYCLING, so the check runs three cycles and reads the counter afterwards:
// a build that halted, faulted or froze on the first unsatisfied boundary answers
// something other than `3`.
//
// THE VERDICT. `sim.status` is `running`, `sim.fault` is `null`, `sim.cycle` is
// `3`, and the fraction is back on a boundary. The `dust` is still resting on the
// seat and is still `dust` — the sigil waited rather than acting — and the machine
// is still carrying the `wane` that waited.
//
// `sim.fraction` IS READ WITH A TOLERANCE, never for equality: it is one of the
// three figures `specs/instrumentation.md` carries as a running sum of the frames'
// own delta times, which "agree to within the rounding of that sum rather than bit
// for bit", and `0` is a value of that sum like any other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** The seat of the `wane` under test: its whole footprint, at rotation `0`. */
const SEAT = at(0, 0);

/** How many boundaries the idle sigil is carried through. */
const CYCLES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("waits at every boundary its condition fails at, and the run keeps cycling", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("wane", SEAT.q, SEAT.r, 0)]),
  });
  const seated = await spawnMote(h, SEAT, "dust");

  await advanceCycles(h, CYCLES);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "idle");
  const sim = snapshot.sim;
  assertNotNull(
    sim,
    "the run is still live after three unsatisfied boundaries",
  );
  assertEqual(
    sim?.status,
    "running",
    "a sigil whose condition does not hold waits, and waiting halts nothing",
  );
  assertNull(
    sim?.fault ?? null,
    "an unsatisfied sigil raises none of the faults FAULTS names",
  );
  assertEqual(
    sim?.cycle,
    CYCLES,
    "the machine kept cycling: three cycles of game time completed three cycles",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );

  assertNotNull(
    solePartOfKind(snapshot, "wane"),
    "the machine is still carrying the one wane whose condition never held",
  );
  const rested = moteById(snapshot, seated);
  assertNotNull(rested, "the mote on the seat is still on the field");
  assertEqual(
    `${rested?.q},${rested?.r}`,
    `${SEAT.q},${SEAT.r}`,
    "a mote held by nothing rests on its hex for the whole cycle",
  );
  assertEqual(
    moteAt(snapshot, SEAT)?.type,
    "dust",
    "dust is not one of the four ESSENCES, so the wane's condition never held and it acted on nothing",
  );
  assertLength(
    sim?.motes ?? [],
    1,
    "the field holds the one mote the check spawned and nothing else",
  );
});
