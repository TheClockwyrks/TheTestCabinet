// Automated validation for the Surge sub-item `stats`.
//
// The surge types field their specified base HP and speed (specs/surge.md). We spawn
// one of each at wave 1 (no HP scaling yet) and read its base HP and speed back.
//
// THE SIX ARE SPACED OUT, NOT STACKED.
//
// All six used to be spawned in a single instant, which put them on the same vent tile
// at the same moment: the still was six units drawn on top of one another, a single
// coloured blob with one health bar visible and the other five behind it. The stats are
// read off the snapshot so the verdict was unaffected, but the frame backing it showed
// nothing a reviewer could count, let alone compare.
//
// So each spawn is followed by a beat, and the six are split across BOTH vents. The
// stagger strings them out along their lanes and the split puts three on the left run
// and three on the top one, so every unit is separately visible with its own health bar
// — and the frame incidentally shows the thing the table is about, which is that these
// six are visibly different sizes, colours and paces.

import { newGame, spawn, unit } from "../_helpers.mjs";

// How long each unit is given to clear the vent before the next one appears. 40 ticks
// is two thirds of a second: enough that even the 30 px/s Core is a body-length clear of
// the unit behind it, and short enough that all six are still on screen together.
const SPACING = 40;

const EXPECTED = {
  mote: { hp: 40, speed: 60 },
  sprint: { hp: 24, speed: 120 },
  hulk: { hp: 220, speed: 38 },
  swarm: { hp: 12, speed: 70 },
  drift: { hp: 60, speed: 80 },
  core: { hp: 1600, speed: 30 },
};

export default function item() {
  const got = {};

  return {
    id: "surge.stats",

    // Wave 1, so no HP scaling has been applied yet and the numbers read back are the
    // base stats. Lives are posed high because every one of these will walk off.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
    },

    // Spawn one of each type, alternating vents and holding a beat between each, and
    // read its stats straight off the unit as it appears.
    async act(api) {
      const types = Object.keys(EXPECTED);
      for (let i = 0; i < types.length; i += 1) {
        const id = await spawn(api, types[i], i % 2 === 0 ? "left" : "top");
        const u = await unit(api, id);
        got[types[i]] = { hp: u.maxHp, speed: u.baseSpeed };
        await api.advance(SPACING);
      }
      // A last beat, so the slowest of them is clear of its vent before the frame is
      // taken and nothing is still overlapping an opening.
      await api.advance(SPACING);
      await api.settle(120);
      await api.screenshot("stats");
    },

    async assert(api, check) {
      // The labels name the snapshot field each figure is read from, because an ABSENT
      // field and a wrong value fail identically here otherwise. A build that omits
      // `baseSpeed` (specs/instrumentation.md lists it on every surge entry) reports no
      // value at all, and "mote base speed: expected 60, actual —" reads as a speed
      // defect when what happened is that nothing was reported to compare.
      for (const [type, want] of Object.entries(EXPECTED)) {
        check.expectClose(
          `${type} base HP (snapshot maxHp)`,
          got[type].hp,
          want.hp,
          0.5,
        );
        check.expectClose(
          `${type} base speed (snapshot baseSpeed)`,
          got[type].speed,
          want.speed,
          0.5,
        );
      }
    },
  };
}
