// Meltdown — surge/swarm-stats: the Swarm's row of the roster.
//
// THE RULE. `specs/surge.md` tabulates six columns for each of the six types, and
// the Swarm's row reads HP `12`, Speed `70`, Slowable `yes`, Flies `no`,
// Bounty `2`, Leak `1`. Every one of the six is read here, and the item stands
// or falls on the row being the specification's row.
//
// WHAT THIS ROW IS FOR. `specs/surge.md`: "The Swarm is tiny and arrives in dense
// counts." Its `12` is the smallest hp pool in the game and its `2` the smallest
// bounty, so a build that paid a flat bounty or floored every hp pool at the
// Mote's `40` is named here. Its `70` sits ten units from the Mote's `60`, which
// is why the speed reading below is held to a bound three orders tighter than
// that gap.
//
// WHERE EACH FIGURE IS READ, AND WHY IT CANNOT BE READ ANYWHERE ELSE. Three of
// the six are fields the snapshot reports and three are not:
//
//   HP, SPEED AND FLIGHT are read off the unit the moment `addUnit` entered it,
//   on Wave 1, where `hpScale(1)` is `1` and the maximum hp is the base hp
//   unscaled (`specs/waves.md`). Nothing is driven first: a drive would only give
//   something else the chance to move one of them.
//
//   SLOWABILITY is decided by a shot. `specs/combat.md` states the rule as "A unit
//   that is not slowable never carries a slow, WHATEVER HITS IT", which is a claim
//   about a hit rather than about a field, and `setUnitSlow` poses the field
//   directly and says nothing about the column. So a cold level-I Rime — the one
//   emitter in the game that slows — fires one shot at the unit, and what the
//   Swarm carries afterwards is the reading.
//
//   THE BOUNTY is paid "On the frame a unit's hp reaches `0`" and the LEAK is
//   charged on the frame the unit reaches its exhaust (`specs/economy.md`,
//   `specs/surge.md`). Both are transitions rather than fields, and neither can be
//   posed — `setUnitHp` "does not kill the unit: death belongs to the damage path"
//   (`specs/instrumentation.md`) — so each is reached through the event itself,
//   with nothing else on the floor that could pay or charge anything
//   (`surge/roster.ts`).
//
// EACH SCENARIO OPENS ITS OWN RUN, so the gun a slow reading needed is not
// standing on the floor while a leak is read, and the fire clock a kill ran on is
// not carried into the next drive.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import { RIME_SLOW_CEIL, SURGE_DEFS, TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import {
  SLOW_GUN,
  SLOW_GUN_LEVEL,
  enterUnit,
  readBounty,
  readLeak,
  readSlow,
} from "./roster";

/** The row `specs/surge.md` gives this type, restated in `constants.ts`. */
const ROW = SURGE_DEFS.swarm;

/**
 * The slow a cold level-I Rime asks for: `slowCeil * (1 - H / 100)` at `H` `0`,
 * which is `RIME_SLOW_CEIL[0]` (`specs/combat.md`).
 *
 * The gun is pinned at heat `0`, so the factor cannot drift under the reading.
 */
const OFFERED_SLOW = RIME_SLOW_CEIL[SLOW_GUN_LEVEL - 1] * (1 - 0 / TRIP_HEAT);

/**
 * How close a figure read off the snapshot must come, as decimal places.
 *
 * Three places is `0.0005`. Every figure below is exact arithmetic on both
 * sides — a table lookup, or that lookup times `1 - slowFactor` — so a conformant
 * build reads it exactly and the bound admits nothing but the last bits of a
 * double. It is three orders under the closest two figures the table has to keep
 * apart: the `60` and `70` of the Mote and the Swarm.
 */
const DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries the Swarm's hp, speed, flight, slowability, bounty and leak", async () => {
  // HP, SPEED AND FLIGHT: the unit as it entered, on Wave 1.
  await startRun(h);
  const entered = await enterUnit(h, "swarm");
  await h.advance(1);
  await captureStill(h, "swarm");

  assertCloseTo(
    entered.maxHp,
    ROW.hp,
    DIGITS,
    "the maximum hp a Swarm entering on Wave 1 carries (specs/surge.md)",
  );
  assertCloseTo(
    entered.baseSpeed,
    ROW.speed,
    DIGITS,
    "the Swarm's unslowed speed, in logical units per second (specs/surge.md)",
  );
  assertEqual(
    entered.flying,
    ROW.flies,
    "whether the Swarm flies (specs/surge.md)",
  );

  // SLOWABILITY: what one cold level-I Rime shot leaves on it.
  const slow = await readSlow(h, "swarm");
  assertGreaterThan(
    slow.removed,
    0,
    `precondition: hp a level-${SLOW_GUN_LEVEL} ${SLOW_GUN} removed from the ` +
      "Swarm it fired on",
  );
  assertEqual(
    slow.unit.slowed,
    true,
    "whether the Swarm, which specs/surge.md marks Slowable: yes, carries " +
      "the slow the Rime applied",
  );
  assertCloseTo(
    slow.unit.slowFactor,
    OFFERED_SLOW,
    DIGITS,
    "the fraction of speed the cold level-I Rime's slow removes (specs/combat.md)",
  );
  assertCloseTo(
    slow.unit.speed,
    ROW.speed * (1 - OFFERED_SLOW),
    DIGITS,
    "the slowed Swarm's speed, baseSpeed * (1 - slowFactor) (specs/combat.md)",
  );

  // THE BOUNTY: what the death paid into the money.
  const bounty = await readBounty(h, "swarm");
  assertTrue(bounty.died, "precondition: the Arc's shot killed the Swarm");
  assertEqual(
    bounty.paid,
    ROW.bounty,
    "the money a killed Swarm paid (specs/surge.md, specs/economy.md)",
  );

  // THE LEAK: what reaching its exhaust cost in lives.
  const leak = await readLeak(h, "swarm");
  assertTrue(
    leak.leaked,
    "precondition: the Swarm reached its exhaust and left the floor",
  );
  assertEqual(
    leak.spent,
    ROW.leak,
    "the lives a leaked Swarm cost (specs/surge.md)",
  );
});
