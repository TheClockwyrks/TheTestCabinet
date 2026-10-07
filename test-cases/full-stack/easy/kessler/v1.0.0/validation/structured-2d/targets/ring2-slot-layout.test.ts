// targets/ring2-slot-layout — ring 2's 16 slots of 22.5 degrees put each
// target arc where specs/rings.md lays it.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "Slot `k` of a ring, with `k`
// running from `0` to the slot count minus one, begins at the ring's angle plus
// `k` times the slot width. The slot's target arc begins `2` degrees into the
// slot and spans the target arc width, leaving a structural gap of `2` degrees
// at each side of the slot." — and ring 2's row of the table reads 16 slots
// of 22.5 degrees with a 18.5-degree target arc. Angular membership is by
// the ball's center with the boundaries inclusive (specs/field.md), so the arc
// is probed 0.75 degrees INSIDE each edge and 1 degree into each gap — never at
// the boundary itself, whose exact float reading the specs do not promise.
//
// HOW THE LAYOUT IS READ. The way it bears on play: a ball crossing the outer
// contact radius inside a live arc scores a hit (the target's hit points fall),
// and the same crossing in a structural gap passes untouched (specs/rings.md's
// two contact events and its gap sentence). The ring is posed at a NONZERO
// angle and a nonzero slot is probed beside slot 0, so the reading binds the
// ring-angle offset AND the per-slot stride, not just one arc's position.
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE BALL PER PROBE. The field
// is isolated, the ring is frozen at the posed angle, and every probe replaces
// the lone target and the ball, so no probe inherits another's spent crossing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcStartDeg,
  figures,
  freezeRing,
  GAP_DEG,
  probeArc,
  PROBE_HP,
} from "./rig";

const RING = 2;
/** Where the ring is posed: a nonzero angle, so the offset term is exercised. */
const POSE_DEG = 17;
/** The nonzero slot probed beside slot 0, binding the `k * 22.5` stride. */
const SLOT = 5;
/** How far inside an inclusive arc edge a hit probe stands. */
const IN = 0.75;
/** How far into a 2-degree structural gap a miss probe stands. */
const OUT = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays each target arc 2 degrees into its slot, spanning 18.5 degrees", async () => {
  await isolate(h);
  await freezeRing(h, RING, POSE_DEG);
  const fig = figures(RING);

  const hpLeft: number[] = [];
  await captureReplay(h, "probes", async () => {
    const slot0Start = arcStartDeg(RING, 0, POSE_DEG);
    const slotKStart = arcStartDeg(RING, SLOT, POSE_DEG);
    hpLeft.push(await probeArc(h, RING, 0, slot0Start + IN));
    hpLeft.push(await probeArc(h, RING, SLOT, slotKStart + IN));
    hpLeft.push(await probeArc(h, RING, SLOT, slotKStart + fig.arcDeg - IN));
    hpLeft.push(await probeArc(h, RING, SLOT, slotKStart - GAP_DEG + OUT));
    hpLeft.push(await probeArc(h, RING, SLOT, slotKStart + fig.arcDeg + OUT));
  });

  assertEqual(
    hpLeft[0],
    PROBE_HP - 1,
    "a crossing just inside slot 0's arc start hits its target",
  );
  assertEqual(
    hpLeft[1],
    PROBE_HP - 1,
    `a crossing just inside slot ${SLOT}'s arc start hits its target`,
  );
  assertEqual(
    hpLeft[2],
    PROBE_HP - 1,
    `a crossing just inside slot ${SLOT}'s arc end hits its target`,
  );
  assertEqual(
    hpLeft[3],
    PROBE_HP,
    `a crossing in slot ${SLOT}'s leading structural gap passes untouched`,
  );
  assertEqual(
    hpLeft[4],
    PROBE_HP,
    `a crossing in slot ${SLOT}'s trailing structural gap passes untouched`,
  );
});
