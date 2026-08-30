// Automated validation for abilities.multishot: a multishot combination tower fires at up to N
// distinct in-range targets per cadence, each a separate traveling projectile.
//
// A Fork Array (multishot 3) is assembled and three units released; in its first volley there
// must be projectiles homing on at least two distinct targets at once.
//
// WHY THE TARGETS ARE SPACED. The three units used to be released with `spawnUnit`'s `count`,
// which puts them all at the Entry on the SAME tick — identical coordinates, identical speed,
// perfectly superimposed for the whole clip. So the recording showed ONE Mote, and an item whose
// entire claim is "it fires at SEVERAL targets at once" gave a reviewer a single target to watch
// it shoot. The check could still read three distinct `targetId`s out of the snapshot, but the
// evidence could not corroborate it, and a reviewer had no way to tell a real fan-out from one
// tower shooting one unit three times. `releaseSpread` walks them apart instead, so the volley is
// seen crossing to three units standing in three different places.
//
// Assembling the combo and releasing the pack are control ops (the arrange); the volley itself
// is what consumes time, so it is the act and is what the clip shows.

import {
  assembleCombo,
  releaseSpread,
  skipToApproach,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Fork Array cadences, so a build that opens on a full cooldown still volleys inside
// the budget.
const VOLLEY_TICKS = 4 * SECOND;
// A volley is over in a moment, and the old clip stopped on the tick it was detected — before
// the projectiles had gone anywhere. Carrying on lets a reviewer watch the separate bolts fan
// out, cross to their different targets, and land.
const WATCH_TICKS = 3 * SECOND;

export default function item() {
  // The assembled combo, the pack it fires into, whether a multi-target volley was seen, and the
  // volley snapshot.
  let comboId;
  let ids = [];
  let volley;
  let s;

  return {
    id: "abilities.multishot",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "forkarray", { seed: 1, charge: 400 }));
      // A Fork Array is multishot 3 (`specs/towers.md`), so three targets is what "up to N" has
      // to be given for the volley to be worth watching — spaced, so they read as three.
      ids = await releaseSpread(api, { count: 3 });
      if (comboId != null && ids.length) await skipToApproach(api, comboId, ids[0]);
    },

    async act(api) {
      // Read every tick — a volley is in flight only briefly.
      volley = await api.until((st) => new Set(st.projectiles.map((p) => p.targetId)).size >= 2, {
        max: VOLLEY_TICKS,
        poll: TICK,
      });
      s = await snap(api);

      // The assertions are already fixed on `s`; this only lets the clip show the fan-out land.
      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      // Hard: without the combo there is no multishot tower to volley, and every reading below
      // would report an empty projectile list as "it engaged no targets", which is true of a
      // board with no tower on it and says nothing about multishot.
      check.assertOk("a Fork Array was assembled", comboId != null);
      check.expectEq("three targets are on the floor for it to choose between", ids.length, 3);
      check.expectOk("the multishot combo fired at multiple distinct targets at once", volley.hit);
      check.expectGe(
        "multiple distinct targets were engaged in one cadence",
        new Set(s.projectiles.map((p) => p.targetId)).size,
        2,
      );
    },
  };
}
