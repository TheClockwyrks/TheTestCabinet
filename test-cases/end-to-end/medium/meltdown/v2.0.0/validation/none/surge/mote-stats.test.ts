// Meltdown — surge/mote-stats: the Mote's row of the roster.
//
// THE RULE. `specs/surge.md` tabulates six columns for each of the six types, and
// the Mote's row reads HP `40`, Speed `60`, Slowable `yes`, Flies `no`,
// Bounty `3`, Leak `1`. Every one of the six is read here, and the item stands
// or falls on the row being the specification's row.
//
// THE BASELINE ROW. `specs/surge.md` calls the Mote "the baseline", and every
// other row on the roster is described against it. Nothing about it is
// distinctive, which is exactly what makes it the row a build that ignored the
// table and used one set of figures for everything would pass — so the five
// companion items are what turn six readings into a reading of a TABLE.
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
//   emitter in the game that slows — fires one shot at the unit, and whether the
//   unit carries a slow afterwards is the reading. The column is a BOOLEAN, so
//   that is all this point reads: how deep a cold Rime's slow runs is
//   `combat.rime-slows-when-cold`'s figure, and reading it here would fail six
//   roster items for one wrong ceiling.
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
import { SURGE_DEFS } from "../constants";
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
const ROW = SURGE_DEFS.mote;

/**
 * How close a figure read off the snapshot must come, as decimal places.
 *
 * Three places is `0.0005`. Every figure below is a table lookup read straight
 * back, so a conformant build reads it exactly and the bound admits nothing but
 * the last bits of a double. It is three orders under the closest two figures the table has to keep
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

it("carries the Mote's hp, speed, flight, slowability, bounty and leak", async () => {
  // HP, SPEED AND FLIGHT: the unit as it entered, on Wave 1.
  await startRun(h);
  const entered = await enterUnit(h, "mote");
  await h.advance(1);
  await captureStill(h, "mote");

  assertCloseTo(
    entered.maxHp,
    ROW.hp,
    DIGITS,
    "the maximum hp a Mote entering on Wave 1 carries (specs/surge.md)",
  );
  assertCloseTo(
    entered.hp,
    entered.maxHp,
    DIGITS,
    "the hp a Mote enters on, which is full (specs/surge.md)",
  );
  assertCloseTo(
    entered.baseSpeed,
    ROW.speed,
    DIGITS,
    "the Mote's unslowed speed, in logical units per second (specs/surge.md)",
  );
  assertCloseTo(
    entered.speed,
    ROW.speed,
    DIGITS,
    "the Mote's current speed as it entered, carrying no slow (specs/surge.md)",
  );
  assertEqual(
    entered.flying,
    ROW.flies,
    "whether the Mote flies (specs/surge.md)",
  );

  // SLOWABILITY: what one cold level-I Rime shot leaves on it.
  const slow = await readSlow(h, "mote");
  assertGreaterThan(
    slow.removed,
    0,
    `precondition: hp a level-${SLOW_GUN_LEVEL} ${SLOW_GUN} removed from the ` +
      "Mote it fired on",
  );
  assertEqual(
    slow.unit.slowed,
    ROW.slowable,
    "whether the Mote, which specs/surge.md marks Slowable: " +
      `${ROW.slowable ? "yes" : "no"}, carries the slow the one emitter that ` +
      "applies one left on it (specs/surge.md, specs/combat.md)",
  );

  // THE BOUNTY: what the death paid into the money.
  const bounty = await readBounty(h, "mote");
  assertTrue(bounty.died, "precondition: the Arc's shot killed the Mote");
  assertEqual(
    bounty.paid,
    ROW.bounty,
    "the money a killed Mote paid (specs/surge.md, specs/economy.md)",
  );

  // THE LEAK: what reaching its exhaust cost in lives.
  const leak = await readLeak(h, "mote");
  assertTrue(
    leak.leaked,
    "precondition: the Mote reached its exhaust and left the floor",
  );
  assertEqual(
    leak.spent,
    ROW.leak,
    "the lives a leaked Mote cost (specs/surge.md)",
  );
});
