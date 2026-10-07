// runs/bank-counts-each-hex-once — the bank is a SET of hexes, so a hex reached
// again adds nothing.
//
// THE RULE. "The area bank is a set of hexes accumulated across the run ...
// `area` is how many distinct hexes the bank holds when the run completes"
// (`specs/simulation.md`, Completion and metrics), reported live as "distinct
// hexes banked so far" (`specs/instrumentation.md`). Everything the bank takes
// goes through that one word: the seeds at the start of the run, and "After every
// boundary, the settle included, it takes the hex of every mote and of every
// gripper."
//
// THE CONFIGURATION MAKES ONE HEX ARRIVE THREE WAYS. One `arm` at the origin,
// rotation `0`, length `1` — so its gripper rests on `(1, 0)` — carrying one
// `sol` spawned on that same hex, with the tape `rotate-cw`, `rotate-ccw`. The
// hold is given through the gate `specs/instrumentation.md` names, "`setGrip`,
// which takes hold with no `grab` ever running", so the only cycles that run are
// the two under test.
//
// `(1, 0)` is then banked three times over: once at the start of the run as a
// gripper hex at rest, and again at cycle `1`'s boundary as BOTH the gripper's
// hex and the mote's, because `rotate-ccw` carries the pair straight back onto
// it. `(0, 1)`, where cycle `0` leaves them, is banked twice for the same reason.
// Three hexes are ever touched — the anchor, `(1, 0)` and `(0, 1)` — and `area`
// counts three.
//
// THE VERDICT. The bank opens at two, cycle `0` takes it to three, and cycle
// `1` — which moves the machine right back onto hexes it has already banked —
// leaves it at three. Each reading is taken beside the mote's own hex, so the
// figures belong to a machine that really carried it out and back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** One arm whose two-cell tape carries out and straight back. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw", "rotate-ccw"]),
]);

/** The gripper's resting hex, the hex `rotate-cw` carries to, and the spoke. */
const START_HEX = at(1, 0);
const TURNED_HEX = at(0, 1);
const SPOKE = 0;

/** What the bank opens holding: the anchor and the resting gripper hex. */
const OPENED = new Set(
  [ORIGIN, START_HEX].map((hex: Hex) => `${hex.q},${hex.r}`),
);

/** Every hex the whole scenario ever touches. */
const TOUCHED = new Set(
  [ORIGIN, START_HEX, TURNED_HEX].map((hex: Hex) => `${hex.q},${hex.r}`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds nothing when a mote is carried back onto a hex the bank already holds", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, START_HEX, "sol");
  await takeGrip(h, arm, SPOKE, mote);

  const opened = await h.snapshot();

  const turned = await captureReplay(h, "revisit", async () => {
    await advanceCycles(h, 1);
    const midway = await h.snapshot();
    await advanceCycles(h, 1);
    return midway;
  });

  assertNotNull(opened.sim, "the run is live once it has been started");
  assertEqual(
    opened.sim?.area,
    OPENED.size,
    "the bank opens holding the arm's anchor and its one resting gripper hex",
  );
  assertNotNull(turned.sim, "the run is still live after the first cycle");
  assertEqual(
    moteAt(turned, TURNED_HEX)?.id,
    mote,
    "rotate-cw carries the mote onto a hex the bank did not hold, so the bank has something new to take",
  );
  assertEqual(
    turned.sim?.area,
    TOUCHED.size,
    "cycle 0's boundary banks that new hex, taking the bank to every hex the scenario ever touches",
  );

  const returned = await h.snapshot();
  assertNotNull(returned.sim, "the run is still live after the two cycles");
  assertEqual(
    returned.sim?.cycle,
    2,
    "both cycles reached their boundary, so both bankings really happened",
  );
  assertEqual(
    moteAt(returned, START_HEX)?.id,
    mote,
    "rotate-ccw carries the mote back onto the hex it started on, which the bank already holds",
  );
  assertEqual(
    returned.sim?.area,
    TOUCHED.size,
    "area is how many DISTINCT hexes the bank holds, so a hex banked at several boundaries, and banked once as a gripper hex and again as a mote's hex, adds 1 in total",
  );
});
