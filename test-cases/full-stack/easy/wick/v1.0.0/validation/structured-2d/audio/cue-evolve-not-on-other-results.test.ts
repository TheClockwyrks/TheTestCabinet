// Wick — audio/cue-evolve-not-on-other-results: a chest that levels an item
// or heals plays no `evolve`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `evolve` to "A weapon evolves" and to nothing else, and the paragraph under
// it fixes the whole of what a tick plays: "Each is played on the tick its
// event happens ... and at most once on that tick." `specs/evolutions.md`,
// Opening a chest, puts the cue on rule 1 alone — "the `evolve` cue plays" is
// stated for the evolution result — while rule 2 levels an item and rule 3
// heals, neither naming a cue. A chest that did not evolve is therefore a
// tick on which the count of `evolve` plays is zero.
//
// WHY BOTH OTHER RESULTS ARE DRIVEN HERE. The requirement is "no `evolve` on
// a chest that did not evolve", and `specs/evolutions.md` gives a chest
// exactly three results. Rules 2 and 3 are the two that are not an evolution,
// and a build that stays silent on one and sounds on the other has met the
// requirement on one route and missed it on the other.
//
// WHY THE WORLDS ARE POSED AS THEY ARE. Both are isolated runs with every
// driver switch off, holding no enemy, projectile, zone, gem, or pickup, with
// one chest on the lamplighter's own center — inside `PICKUP_ITEM_RADIUS`
// (`16`) plus `PLAYER_RADIUS` (`12`) whatever the build's pickup radius, so
// the collection lands on the first tick (`specs/world.md`, Collection).
//
//   - The LEVEL run holds Taper at level `1` and no passive at all. Rule 1
//     needs a weapon "held at `MAX_WEAPON_LEVEL`" whose recipe passive is
//     held, and neither holds, so no reading of the recipe reaches an
//     evolution; Taper is the one held item below its max, so rule 2 levels
//     it.
//   - The HEAL run holds no weapon and no passive, so neither rule 1 nor rule
//     2 has anything to act on and rule 3 heals. `hp` is posed below `maxHp`
//     so the heal is a real one.
//
// THE TOLERANCE. None: the count of a cue the specification does not put on
// these ticks is zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** Health posed below `maxHp`, so the heal result has somewhere to go. */
const WOUNDED_HP = BASE_MAX_HP / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays no evolve on a chest that levels an item or heals", async () => {
  await captureReplay(h, "silent", async () => {
    await isolatedRun(h);
    holdWeapon(h, "taper", 1);
    const levelled = await cuesOf(h, () => openChest(h));

    assertEqual(
      levelled.result.run.chestResult?.kind,
      "level",
      "the chest's result with one held weapon below its max (specs/evolutions.md, rule 2)",
    );
    assertEqual(
      heard(levelled.played, CUES.evolve),
      0,
      "evolve cues on the tick a chest levelled an item (specs/ui.md, Audio)",
    );

    await isolatedRun(h);
    h.debug.setHp(WOUNDED_HP);
    const healed = await cuesOf(h, () => openChest(h));

    assertEqual(
      healed.result.run.chestResult?.kind,
      "heal",
      "the chest's result with nothing held (specs/evolutions.md, rule 3)",
    );
    assertEqual(
      heard(healed.played, CUES.evolve),
      0,
      "evolve cues on the tick a chest healed (specs/ui.md, Audio)",
    );
  });
});
