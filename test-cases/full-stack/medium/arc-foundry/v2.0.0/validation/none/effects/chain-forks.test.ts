// Arc Foundry — effects/chain-forks: a Coil's chain forks between the units it
// strikes.
//
// THE REQUIREMENT, from `specs/assets.md`: the chain system is spawned when "a
// Coil's hit chains", it carries "forked lightning between each unit the chain
// strikes, dimming per leap", and it is spawned "at the position of the event that
// raised it: ... the chain threaded through each unit a Coil's hit strikes".
//
// THE WORLD, AND WHY IT IS SHAPED LIKE THIS. Three Motes held in a column fifty
// units apart, and one Scrap Coil level with the top one and ninety units to its
// side. `specs/components.md` gives the Coil `COIL_LEAP_RANGE` (`70`) and, at
// Scrap, two additional leaps, so a hit on the top Mote leaps to the middle one and
// on to the bottom one: three units struck and two gaps between them. The Coil is
// set to `nearest` so the primary target is the one the geometry was built around
// rather than whichever the chain ordering happens to reach first. The column runs
// across the line the shot travels down, so the two gaps read are nowhere the
// projectile ever goes.
//
// WHAT IS READ. The two gaps between struck units, sampled clear of the `20 x 20`
// frame a Mote is drawn at, on the frame the chain resolves and the few after it.
// `specs/components.md` puts the hit on the projectile's arrival, so the frame the
// primary's health drops is the frame the chain resolved. The comparison is against
// the same gaps before the shot, which is the second half of the requirement:
// nothing is drawn there before the chain.
//
// A MOTE SURVIVES EVERY LEAP. A Scrap Coil deals `5`, the first leap `0.7` of it
// and the second `0.49`, against the ten health `specs/enemies.md` scales a Mote
// to on wave one at Medium — so nothing dies and no death burst can stand in for a
// fork.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  unitById,
  type Harness,
} from "../harness";
import { between, read, scan } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 22, row: 15 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Three held units in a column, fifty apart: inside `COIL_LEAP_RANGE` (`70`). */
const FIRST = { x: HEAD.x + 90, y: HEAD.y };
const SECOND = { x: FIRST.x, y: FIRST.y + 50 };
const THIRD = { x: FIRST.x, y: FIRST.y + 100 };

/** The two gaps, sampled clear of each unit's own `20 x 20` frame. */
const POINTS = [
  ...between(FIRST, SECOND, 14, 5),
  ...between(SECOND, THIRD, 14, 5),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws between the units a chain strikes, and nothing there before", async () => {
  await openYard(h, { wave: 1 });
  const coil = await standComponent(h, "coil", 1, ANCHOR.col, ANCHOR.row);
  await h.debug.setTargeting(coil, "nearest");
  const primary = await parkUnit(h, "mote", FIRST);
  await parkUnit(h, "mote", SECOND);
  await parkUnit(h, "mote", THIRD);
  await h.advance(1);
  const before = await read(h, POINTS);
  const full = unitById(await h.snapshot(), primary).maxHp;

  const struck = await captureReplay(h, "chain", async () => {
    const landed = await h.until(
      (s) => s.units.some((u) => u.id === primary && u.hp < full),
      { maxFrames: ticks(3) },
    );
    return { landed: landed.hit, readings: await scan(h, POINTS, ticks(0.1)) };
  });

  assertEqual(
    struck.landed,
    true,
    "a Scrap Coil's shot to connect with the nearest Mote within three " +
      "seconds (specs/components.md)",
  );
  assertGreaterThan(
    struck.readings.filter((reading) => reading !== before).length,
    0,
    "the gaps between the units a Coil's chain strikes to be drawn on from " +
      "the frame the chain resolves, having been bare before the shot, so a " +
      "chain is played through them (specs/assets.md)",
  );
});
