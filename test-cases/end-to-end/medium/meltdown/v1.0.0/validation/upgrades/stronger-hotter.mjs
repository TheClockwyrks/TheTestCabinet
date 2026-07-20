// Automated validation for the Upgrades sub-item `stronger-hotter`.
//
// Upgrading an emitter makes it hit harder AND run hotter (specs/towers.md). At a
// fixed heat, the upgraded emitter reports higher per-shot damage; and when firing at
// a real target from the same start, a maxed emitter heats up faster (more heat per
// shot, faster fire rate).

import {
  newGame,
  restartGame,
  build,
  spawn,
  tower,
  heatOf,
} from "../_helpers.mjs";

// Pose an Arc upgraded to `level` firing at a real Core from heat 40, and return its
// id. `start` is the fresh-match helper to use: `newGame` in arrange, and
// `restartGame` in act — this item runs THREE configurations in sequence, so every
// setup after the first lands mid-drive, where `reset()` (and therefore `newGame`)
// throws.
async function poseFiring(api, start, level) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 3, 20);
  for (let l = 1; l < level; l += 1) await api.call("upgradeTower", arc);
  await spawn(api, "core", "left");
  await api.call("setHeat", arc, 40);
  return arc;
}

// 60 ticks = the old 1s of firing, applied identically to both levels.
const FIRE_TICKS = 60;

// Heat gained by `arc` over one identical burst of real firing.
async function heatGain(api, arc) {
  const before = await heatOf(api, arc);
  await api.advance(FIRE_TICKS);
  return (await heatOf(api, arc)) - before;
}

export default function item() {
  let arcId;
  let d1;
  let d2;
  let d3;
  let gainL1;
  let gainL3;

  return {
    id: "upgrades.stronger-hotter",

    // Configuration one: a plain Arc off the lane, whose damage is read at a FIXED
    // heat across all three levels, so the only thing changing is the level and not
    // the heat curve.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
    },

    async act(api) {
      // Stronger: damage at a fixed heat climbs with each upgrade. Re-posing heat 80
      // after every upgrade keeps the heat multiplier identical between readings.
      await api.call("setHeat", arcId, 80);
      d1 = (await tower(api, arcId)).damage;
      await api.call("upgradeTower", arcId);
      await api.call("setHeat", arcId, 80);
      d2 = (await tower(api, arcId)).damage;
      await api.call("upgradeTower", arcId);
      await api.call("setHeat", arcId, 80);
      d3 = (await tower(api, arcId)).damage;

      // Hotter: a maxed emitter heats faster when firing. Each level gets its own
      // fresh match so neither drive inherits the other's heat or surge.
      const a1 = await poseFiring(api, restartGame, 1);
      gainL1 = await heatGain(api, a1);

      const a3 = await poseFiring(api, restartGame, 3);
      gainL3 = await heatGain(api, a3);
    },

    async assert(api, check) {
      check.expectGt("level II hits harder than level I", d2, d1);
      check.expectGt("level III hits harder than level II", d3, d2);
      check.expectGt(
        "a maxed emitter heats faster under fire than a level-I one",
        gainL3,
        gainL1,
      );
    },
  };
}
