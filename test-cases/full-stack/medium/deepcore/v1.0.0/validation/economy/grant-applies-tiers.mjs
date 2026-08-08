// Automated validation for economy.grant-applies-tiers.
//
// Setting upgrade tiers must go through the real upgrade path. `grantGear` "applies through the real
// upgrade path (raising maxima and granting new capacity as `specs/upgrades.md` describes)"
// (`specs/instrumentation.md`), and what `specs/upgrades.md` describes is a tank or hull that
// "raises the maximum and grants the added capacity as usable fuel/hull right then". Raising only
// the ceiling is a different thing: it leaves the miner with a bigger empty tank it has to go and
// buy the rest of, which is not what asking for a tier means on either reading.
//
// Why this is its own item. A grant that moves the ceiling and nothing else does not announce
// itself — it quietly under-equips whatever scenario relied on it, and the item that relied on it
// then fails on ITS OWN claim. That is what a hull granted to tier 5 and left at `100/450` did
// across this suite: a plunge "did not land hard enough", a lava bore "cost no hull", a size-scaled
// thrust burn "did not scale" — four or five separate diagnoses, none of them naming the one thing
// that was actually wrong. Those scenarios now fill the resource explicitly with `setFuel`/`setHull`
// so each measures only what it is about, and the grant contract is checked once, here, where a
// failure says what it means.

import { newRun } from "../_helpers.mjs";

// The tier-5 maxima from the tracks in `specs/upgrades.md`.
const TIER5_MAX_FUEL = 550;
const TIER5_MAX_HULL = 450;

// A deliberately PART-FULL starting point, so a grant that moves the ceiling and grants nothing is
// visible: from `30/100` a build that only raises the maximum lands on `30/550`, which no reading
// of the contract allows. Starting full would hide it — every behavior would read as `550/550`.
const START_FUEL = 30;
const START_HULL = 40;

export default function item() {
  let before;
  let after;

  return {
    id: "economy.grant-applies-tiers",

    // A fresh miner on tier 1 of every track, with fuel and hull posed part-full.
    async arrange(api) {
      await newRun(api);
      await api.call("setFuel", START_FUEL);
      await api.call("setHull", START_HULL);
      before = await api.snapshot();
    },

    // The grant IS the behavior under test, so it happens here and the clip shows both gauges
    // jump — the bars lengthening AND filling by the capacity that was added.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s on the tier-1 gauges, part full
      await api.call("grantGear", { fuel: 5, hull: 5 });
      after = await api.snapshot();
      await api.advance(90); // 90 ticks = 1.5 s on the raised, part-filled gauges
    },

    async assert(api, check) {
      check.expectEq("starts on fuel tier 1", before.tiers.fuel, 1);
      check.expectEq("starts on hull tier 1", before.tiers.hull, 1);
      check.expectEq("the granted fuel tier is set", after.tiers.fuel, 5);
      check.expectEq("the granted hull tier is set", after.tiers.hull, 5);

      // The maxima are the tracks' own tier-5 values, not an arbitrary raise.
      check.expectEq(
        "the tank's maximum rises to the tier-5 value",
        after.miner.maxFuel,
        TIER5_MAX_FUEL,
      );
      check.expectEq(
        "the hull's maximum rises to the tier-5 value",
        after.miner.maxHull,
        TIER5_MAX_HULL,
      );

      // ...and the capacity that was added arrives as USABLE fuel/hull.
      //
      // At least, not exactly. The shop's rule is precise — a purchase adds the capacity increase
      // and no more, never a free top-up — and `economy.buy-upgrade` pins that exactly, on the
      // path where it is specified and where it matters to a player. A debug grant is a different
      // thing: `specs/instrumentation.md` asks it to apply the upgrade path and grant the new
      // capacity, without settling whether a scenario that asks for tier-5 gear should be handed
      // it ready to use or part-full. Both readings honour the sentence, and nothing in play turns
      // on which one a build picks, so requiring equality here would pin a genuinely free choice.
      //
      // What is NOT free is the failure this item exists for: the ceiling moving on its own, so a
      // scenario that asked for a tier-5 hull is quietly handed `100/450` and every measurement
      // taken against it is wrong. That is a floor, and a floor is what is checked.
      check.expectGe(
        "the granted tank capacity arrives as usable fuel",
        after.miner.fuel - before.miner.fuel,
        after.miner.maxFuel - before.miner.maxFuel,
      );
      check.expectGe(
        "the granted hull capacity arrives as usable hull",
        after.miner.hull - before.miner.hull,
        after.miner.maxHull - before.miner.maxHull,
      );
    },
  };
}
