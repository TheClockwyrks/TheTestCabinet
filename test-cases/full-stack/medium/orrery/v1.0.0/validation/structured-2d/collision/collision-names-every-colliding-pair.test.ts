// collision/collision-names-every-colliding-pair — a collision names EVERY pair
// within `38` at the sample it froze on, not one pair alone.
//
// THE RULE. The run "faults as `collision` at that sample, naming every pair
// within the threshold at that sample" (`specs/simulation.md`, Collision), and the
// payload table spells the list out: "`motes`: every mote of every pair within
// `38` at that sample", with "Both lists name each part and each mote once,
// however many pairs or grips reached it" and "`motes` is in ascending mote id"
// (Faults).
//
// THE CONFIGURATION. TWO disjoint copies of example A — "An arm at `(0, 0)`,
// length 1, carries a mote from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote
// rests on `(1, 1)`" — the second translated three rows south, onto `(0, 3)`,
// `(1, 3)` and `(1, 4)`. Both copies are identical in shape, so both first come
// within `38` at the same sample, `t = 3/8`, and the run freezes on a sample where
// two separate pairs are within the threshold at once. The two copies are far
// enough apart that no mote of one is near a mote of the other: the nearest
// cross-copy pair is two rows apart, well outside `38`.
//
// THE VERDICT. `sim.fault.motes` holds all four motes, in ascending id — both
// pairs rather than whichever pair the check happened to find first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names every mote of both pairs within 38 at the sample it froze on", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 0, 3, 0, 1, ["rotate-cw"]),
    ]),
  });
  const placed = await partIds(h);

  const carriedNorth = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, placed[0] ?? -1, 0, carriedNorth);
  const restingNorth = await spawnMote(h, at(1, 1), "dust");

  const carriedSouth = await spawnMote(h, at(1, 3), "dust");
  await takeGrip(h, placed[1] ?? -1, 0, carriedSouth);
  const restingSouth = await spawnMote(h, at(1, 4), "dust");

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "named");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(sim?.fault?.kind, "collision", "both copies come within 38");
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "both copies first come within 38 at t = 3/8, so that is the sample the run froze on",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [carriedNorth, restingNorth, carriedSouth, restingSouth].sort(
      (a, b) => a - b,
    ),
    "the fault names every mote of both pairs, each once, in ascending mote id",
  );
});
