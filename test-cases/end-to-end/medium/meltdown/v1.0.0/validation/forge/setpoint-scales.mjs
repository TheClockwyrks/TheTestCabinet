// Automated validation for the Forge sub-item `setpoint-scales`.
//
// A Forge's setpoint rises with its level (72/84/96%; specs/heat.md, towers.md), so
// a maxed Forge settles a fed gun hotter than a level-I one. We settle the same Arc
// against a level-I and a level-III Forge (upgraded through the real upgrade code)
// and compare the heat it reaches.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Pose a cold-ish Arc fed by a Forge upgraded to `forgeLevel` through the real
// upgrade code, and return the Arc's id. `start` is the fresh-match helper to use:
// `newGame` in arrange, and `restartGame` in act — this is a genuine
// two-configuration comparison, so the second layout has to be posed mid-drive, where
// `reset()` (and therefore `newGame`) throws.
async function poseFed(api, start, forgeLevel) {
  await start(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const forge = await build(api, "forge", 12, 14);
  for (let l = 1; l < forgeLevel; l += 1) await api.call("upgradeTower", forge);
  await api.call("setHeat", arc, 50);
  return arc;
}

// The old settle was 60 steps of 0.25s; 15 ticks = 0.25s, so 60 x 15 = 900 ticks of
// warming, long enough for the heat to reach the setpoint and hold there.
//
// Almost all of that warming is skipped. What this item compares is where two guns
// SETTLE, and a settled value is only legible once it has stopped moving — the climb
// to it is fifteen seconds of a number going up, twice over, and filming both put the
// whole comparison out of reach of any sane clip length. So each configuration is
// warmed to just short of its plateau unfilmed and the last two seconds are recorded,
// which is exactly the part that shows a heat holding steady at its setpoint. The
// total warming, and so the heat read back, is unchanged.
const SETTLE_TICKS = 900;
const FILMED_TICKS = 120;

async function settle(api) {
  await api.skip(SETTLE_TICKS - FILMED_TICKS);
  await api.advance(FILMED_TICKS);
}

export default function item() {
  let aId;
  let l1;
  let l3;

  return {
    id: "forge.setpoint-scales",

    // This is an A/B item, and an A/B item is only evidence if the clip carries BOTH
    // halves. On the default budget the recording stopped half-way through
    // configuration A: the clip showed a level-I Forge warming a gun and nothing else,
    // which is a level with no reference to compare it against — exactly the reading
    // that cannot be made from it. Skipping the warm-ups (see `settle`) brings both
    // settled states inside the default budget, so no override is needed.

    // Configuration A: a level-I Forge.
    async arrange(api) {
      aId = await poseFed(api, newGame, 1);
    },

    // Settle A, then re-pose the same layout with a level-III Forge and settle that
    // for exactly as long. Both drives are filmed back to back.
    async act(api) {
      await settle(api);
      l1 = await heatOf(api, aId);

      const b = await poseFed(api, restartGame, 3);
      await settle(api);
      l3 = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectGt(
        "a level-III Forge settles a gun hotter than a level-I Forge",
        l3,
        l1,
      );
    },
  };
}
