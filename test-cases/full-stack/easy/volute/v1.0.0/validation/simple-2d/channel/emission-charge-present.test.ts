// channel/emission-charge-present — a core placed at the inlet carries a charge
// already standing on the channel.
//
// THE SPEC LINE. `specs/channel.md`, "Emission": "An emitted core's charge is
// drawn from the game's seeded generator, uniformly over the set of distinct
// charges on the channel at the moment of emission, and uniformly over the
// level's charge set when the channel carries no core." Both halves are read
// here, because the specification states both: an emission onto an occupied
// channel is confined to what stands on it, and an emission onto an empty one
// falls back to the level's set (`specs/progression.md`'s table).
//
// THE DRIVE. Level 5, whose charge set is all five charges, with the channel
// posed as a short run of halide alone. A build drawing from the level's set
// instead of the channel's would produce a non-halide core four times out of
// five, so the arrangement separates the two rules as sharply as the case
// allows. Twenty cores are left in the quota and the hall is stepped one tick at
// a time until ten have been placed.
//
// WHY THE CHECK IS WRITTEN AGAINST THE SET ON THE CHANNEL RATHER THAN AGAINST
// "halide". A channel carrying one charge is a channel every emission adds to,
// and `specs/extraction.md` extracts "the maximal same-charge run spanning that
// join" the moment a merge carries the run to three — so a single-charge channel
// empties itself as it fills, and the specification's own fallback then draws
// the next core from the level's set. "Every emitted core is halide" is
// therefore not a consequence of the specification, and a check asserting it
// would fail a conformant build. What the specification does fix, on every
// emission without exception, is the SET the draw comes from, so that is what is
// read: for each emission, the charges standing on the channel at that moment,
// or the level's charge set when nothing stood on it.
//
// WHERE THE SET IS READ. The emission is step 7 of the tick, the last step, so
// the state at the emission is the state at the end of the tick less the core
// just placed — and that core is the one at the inlet, which is the tail, since
// the train is reported head first. An emission is identified by the quota
// falling by one ("Each emission decrements the level's quota by one"), which is
// the one reading that survives a tick on which an extraction also removed
// cores.
//
// THE TOLERANCE. None: a charge id is exact. Membership of a set is a yes or a
// no, and one stray charge fails the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertTrue } from "../assert";
import { levelSpec, type ChargeId } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  spacedBlock,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The level: five charges in play, so a wrong draw is four times as likely. */
const LEVEL = 5;

/** The single-charge run the channel is posed with. */
const POSED_CHARGE: ChargeId = "halide";
const POSED_HEAD_S = 300;
const POSED_COUNT = 3;

/** Cores left in the quota, twice what the drive reads. */
const QUOTA = 20;

/** Emissions read. */
const WANTED = 10;

/** Ticks the drive may take to see them. */
const MAX_TICKS = 1500;

/** One emission: the tick it landed on, its charge, and the set it was drawn from. */
interface Emission {
  tick: number;
  charge: string;
  allowed: readonly string[];
  onto: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an emitted core's charge from the charges on the channel", async () => {
  await poseHall(h, {
    level: LEVEL,
    // The requirement IS what the inlet emits, so its gate is open.
    emission: true,
    quotaRemaining: QUOTA,
    cores: spacedBlock(POSED_HEAD_S, POSED_COUNT, POSED_CHARGE),
  });

  const levelCharges = levelSpec(LEVEL).charges;
  const emissions: Emission[] = [];
  let quota = (await h.snapshot()).quotaRemaining;

  const note = (snapshot: VoluteSnapshot, tick: number): void => {
    // An emission, and only an emission, takes exactly one off the quota.
    if (snapshot.quotaRemaining !== quota - 1) return;
    const train = snapshot.train ?? [];
    const placed = train[train.length - 1];
    if (placed === undefined) return;
    // Everything else standing on the channel when the core was placed.
    const standing = train.slice(0, -1);
    emissions.push({
      tick,
      charge: placed.charge,
      allowed:
        standing.length === 0
          ? levelCharges
          : [...new Set(standing.map((core) => core.charge))],
      onto: standing.length,
    });
  };

  await h.stepWatching(MAX_TICKS, (snapshot, tick) => {
    note(snapshot, tick);
    quota = snapshot.quotaRemaining;
    return emissions.length >= WANTED;
  });

  await captureStill(h, "emitted");

  assertEqual(
    emissions.length,
    WANTED,
    `the cores the inlet placed within ${MAX_TICKS} ticks`,
  );
  // The drive is only worth reading if some of those emissions landed on an
  // occupied channel; that is where the rule bites.
  assertTrue(
    emissions.some((emission) => emission.onto > 0),
    "at least one core placed onto an occupied channel",
  );

  for (const emission of emissions) {
    assertContains(
      emission.allowed,
      emission.charge,
      `the charge of the core placed on tick ${emission.tick}, drawn from ` +
        `the ${emission.onto === 0 ? "level's" : "channel's"} charges`,
    );
  }
});
