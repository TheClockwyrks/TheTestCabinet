// Automated validation for the Rime sub-item `ceiling-scales`.
//
// Upgrading a Rime raises its cold-slow ceiling (0.55/0.68/0.80; specs/heat.md,
// towers.md) rather than its damage. We read the Rime's cold (heat 0) slow fraction
// across its three levels (upgraded through the real upgrade code); it rises.
//
// A CLIP, WITH THE RIME SELECTED, RATHER THAN A STILL. What this item claims is a
// PROGRESSION, and a still can only ever hold the end of one: a screenshot of a level-III
// Rime reading 80% is equally a screenshot of a build whose ceiling was 80% from the
// start, and the two readings it has to be compared against are in frames the reviewer
// does not have. The clip holds a beat at each level, so the upgrade is watched
// happening and the number is watched going up with it — I to II to III, on screen, in
// order.
//
// The Rime is SELECTED throughout, for two reasons: the slow percentage is an inspector
// read ("the heat-averse Rime shows its live slow percentage in place of a damage read",
// specs/controls.md), and upgrading is an inspector action, so the level and the Upgrade
// button's cost are on screen beside the number they are changing.
//
// Heat is re-posed to 0 after every upgrade, so the three readings differ only by level
// and not by any heat the upgrade left behind — the ceiling is what a COLD Rime slows
// by.

import { newGame, build, tower } from "../_helpers.mjs";

// The beat held at each level, so the level, the ceiling, and the upgrade cost are all
// legible before the next upgrade lands. 72 ticks is 1.2 s.
const HOLD = 72;

export default function item() {
  let rimeId;
  const ceilings = [];

  return {
    id: "rime.ceiling-scales",

    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      rimeId = await build(api, "rime", 12, 12);
      // The ceiling is an inspector read, so the inspector has to be open on it.
      await api.call("selectTower", rimeId);
    },

    // Read the ceiling at each level, holding a beat on each so the clip shows the
    // upgrade and the number it moves.
    async act(api) {
      for (let level = 1; level <= 3; level += 1) {
        if (level > 1) await api.call("upgradeTower", rimeId);
        await api.call("setHeat", rimeId, 0);
        ceilings.push((await tower(api, rimeId)).slowFactor);
        await api.advance(HOLD);
      }
      await api.advance(HOLD); // hold on the maxed Rime rather than cutting on it
    },

    async assert(api, check) {
      const [l1, l2, l3] = ceilings;
      check.expectClose("level-I cold-slow ceiling", l1, 0.55, 0.02);
      check.expectClose("level-II cold-slow ceiling", l2, 0.68, 0.02);
      check.expectClose("level-III cold-slow ceiling", l3, 0.8, 0.02);
      check.expectGt("upgrading raises the ceiling (II > I)", l2, l1);
      check.expectGt("upgrading raises the ceiling (III > II)", l3, l2);
    },
  };
}
