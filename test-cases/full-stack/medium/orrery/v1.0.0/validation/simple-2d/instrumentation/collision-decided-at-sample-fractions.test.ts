// instrumentation/collision-decided-at-sample-fractions — the eight sample
// fractions decide a collision, and the frames that covered the cycle do not.
//
// THE RULE. "Collision is decided at the sample fractions `specs/simulation.md`
// fixes, never at rendered frames" (`specs/instrumentation.md`, A deterministic
// core), which the same section places under the property the whole surface rests
// on: "an interval of game time reaches the same state however it was divided into
// frames ... the fault [comes out identical whatever the division]". The rule
// itself is `specs/simulation.md`, Collision: "every mote's position is evaluated
// at the sample fractions `t = k / 8` for `k` from `1` to `8`, in order. If at any
// sample the distance between the centers of two motes is strictly less than
// `2 * MOTE_COLLIDE_R` (`38`), the run faults as `collision` at that sample", and
// Cycles and the clock fixes where that leaves the run: "A `collision` leaves the
// fraction at that sample's `k / 8`."
//
// THE CONFIGURATION is the specification's own worked example A: "An arm at
// `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)` with
// `rotate-cw`. A mote rests on `(1, 1)`." Its first sample within `38` is `36.10`
// at `t = 3/8`; its nearest sampled approach is `35.14` at `t = 4/8`. It is posed
// three times over, and the one cycle it faults in is covered by ONE frame, by
// EIGHT, and by SIXTY.
//
// WHY THOSE THREE DIVISIONS. One frame crosses the whole cycle in a single step,
// so a build that evaluated collision at its rendered frames sees `t = 1` alone and
// misses `3/8` entirely. Eight frames land a frame boundary on every sample, which
// is the division a frame-driven build agrees with by accident. Sixty land on none
// of them. The three agreeing is what says the samples decided it.
//
// THE VERDICT reads the freeze twice over: the fraction is `3/8` in all three, and
// so is the SEPARATION the two named motes were frozen at — the distance between
// the drawn positions the snapshot reports, which are "derived from ...
// `sim.fraction`". A build that froze at its own nearest frame would report a
// different separation even where it happened to name the same cycle.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  COLLIDE_DISTANCE,
  FRACTION_TOLERANCE,
  HEX_PITCH,
  sampleFraction,
} from "../constants";
import { at, distance } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** See `frame-division-independent`: the drawn positions follow `sim.fraction`. */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** The sample example A first comes within `38` at. */
const FROZEN_AT = sampleFraction(3);

/** The three ways the one faulting cycle is covered. */
const DIVISIONS = [1, 8, 60] as const;

/** What one division of the cycle froze at. */
interface Frozen {
  fraction: number;
  separation: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The distance between the two motes the fault named, at the fraction it froze at. */
function separationOf(snapshot: OrrerySnapshot): number {
  const named = snapshot.sim?.fault?.motes ?? [];
  const a = moteById(snapshot, named[0] ?? -1);
  const b = moteById(snapshot, named[1] ?? -1);
  if (a === null || b === null) return Number.NaN;
  return distance({ x: a.x, y: a.y }, { x: b.x, y: b.y });
}

/** Pose example A, cover its cycle in `frames` frames, and read the freeze. */
async function exampleA(frames: number): Promise<Frozen> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm ?? -1, 0, carried);
  await spawnMote(h, at(1, 1), "dust");

  await advanceCycles(h, 1, frames);

  const snapshot = await h.snapshot();
  assertNotNull(snapshot.sim, "the run is still live after the faulting cycle");
  assertEqual(
    snapshot.sim?.status,
    "faulted",
    `example A comes within 38, so a cycle covered by ${frames} frame(s) faults`,
  );
  assertEqual(
    snapshot.sim?.fault?.kind,
    "collision",
    `and it faults as collision, whatever the ${frames} frame(s) that crossed the cycle`,
  );
  assertLength(
    snapshot.sim?.fault?.motes ?? [],
    2,
    "the fault names the pair within 38: the carried mote and the resting one",
  );
  return {
    fraction: snapshot.sim?.fraction ?? -1,
    separation: separationOf(snapshot),
  };
}

it("freezes at the same sample fraction and separation however the cycle is divided", async () => {
  const finest = DIVISIONS[DIVISIONS.length - 1];
  const frozen: Frozen[] = [];
  for (const frames of DIVISIONS) {
    // The finest division is the watchable one, so it is the evidence.
    frozen.push(
      frames === finest
        ? await captureReplay(h, "frozen", () => exampleA(frames))
        : await exampleA(frames),
    );
  }

  for (const [i, division] of DIVISIONS.entries()) {
    const read = frozen[i] ?? { fraction: -1, separation: Number.NaN };
    assertNear(
      read.fraction,
      FROZEN_AT,
      FRACTION_TOLERANCE,
      `a cycle covered by ${division} frame(s) freezes at t = 3/8, the first sample within 38`,
    );
    assertLessThan(
      read.separation,
      COLLIDE_DISTANCE,
      `and the pair it froze on is within 38 there, covered by ${division} frame(s)`,
    );
  }

  const first = frozen[0] ?? { fraction: -1, separation: Number.NaN };
  for (const [i, division] of DIVISIONS.entries()) {
    if (i === 0) continue;
    const read = frozen[i] ?? { fraction: -1, separation: Number.NaN };
    assertNear(
      read.separation,
      first.separation,
      POSITION_TOLERANCE,
      `${division} frames freeze the pair at the separation one frame did: the sample fractions decided it, not the frames`,
    );
  }
});
