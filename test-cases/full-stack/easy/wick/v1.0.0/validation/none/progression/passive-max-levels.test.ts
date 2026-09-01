// progression/passive-max-levels — a passive at its max level is not a
// candidate.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// the pool holds "every held passive BELOW its max level ... as a `+1 level`
// offer", and "Slots": "a passive levels up to its own max level, given in
// `specs/passives.md`". `PASSIVES` there "gives each one its display name and
// its max level": Brass `3`, Mirror `2`, and each of the other eight `5`. So a
// passive posed at its own max is in no pool, whichever of the three maxima it
// carries.
//
// WHY THE WORLD IS POSED AS IT IS. Ten isolated nights, one per passive, each
// with every faculty held, nothing alive, and that passive alone held at exactly
// its own max. Every passive is posed rather than one, because the maxima
// differ: a build that caps every passive at `5` passes on the eight and fails
// on Brass and Mirror, and a build that caps every passive at `3` fails on the
// eight. The boundary is posed at the max itself, because that is the value the
// rule turns on. The nine other passive slots stay free, so a build that dropped
// the maxed passive from the loadout would show it back as a new item.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PASSIVES, PASSIVE_IDS, type PassiveId } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves each of the ten passives out of the pool at its own max", async () => {
  const offered: PassiveId[] = [];
  for (const id of PASSIVE_IDS) {
    await isolate(h);
    await holdPassive(h, id, PASSIVES[id].maxLevel);

    const overlay = await openLevelUp(h);
    assertEqual(
      overlay.screen,
      "levelup",
      `the screen the queued level-up opened, with ${id} at its max`,
    );
    assertEqual(
      overlay.run.passives[0]?.level,
      PASSIVES[id].maxLevel,
      `the level ${id} stands at`,
    );
    if (overlay.run.pool.includes(id)) offered.push(id);
  }
  await captureStill(h, "maxed");

  assertDeepEqual(offered, [], "the maxed passives a pool offered anyway");
});
