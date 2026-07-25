// Automated validation for the Rime sub-item `cold-slows-most`.
//
// A cold Rime cuts a unit's speed by its full cold-slow ceiling (specs/heat.md,
// towers.md — `slowFactor(H) = slowCeil * (1 - H/100)`, level-I `slowCeil` 0.55). A
// cold Rime is placed by the lane with a real Mote walking through its range; the real
// firing/slow systems apply the slow, and we read the Mote's speed drop back.
//
// The ceiling and the APPLIED slow are checked separately, because they are two
// different claims and only one of them is about a moment in time. The ceiling is read
// off a Rime posed cold and not yet fired — the only state in which `H` really is 0.
//
// The applied slow is then checked against that ceiling with a tolerance sized to one
// shot of the Rime's own self-heating. The shot that applies the slow also adds
// `heatPerShot / mass` (7.0 / 1.1 = 6.36) heat, and the specs do not say whether the
// `slowFactor(H)` a hit applies is read from the heat before or after its own shot's
// contribution — so a conformant build lands anywhere in [0.515, 0.55], and both ends
// of that band are real: one reference build slows by the full 0.55, another by 0.515.
// A tight `0.55 ± 0.02` fails the latter for a choice the spec left open, while
// comparing against the tower's LIVE `slowFactor` fails the former. The band is narrow
// enough to still catch what matters: a build that reports `slowed` without reducing
// `speed` at all, or that slows by some unrelated fraction.

import { newGame, build, spawn, tower, unit, TICK } from "../_helpers.mjs";

export default function item() {
  let rimeId;
  let coldCeiling;
  let moteId;
  let r;
  let m;

  return {
    id: "rime.cold-slows-most",

    // A cold Rime by the lane with a real Mote walking into its range. It has to be
    // cold, because the ceiling is what a COLD Rime slows by.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      rimeId = await build(api, "rime", 3, 18);
      await api.call("setHeat", rimeId, 0);
      // Posed cold and not yet fired, so `slowFactor` here IS the level-I ceiling.
      coldCeiling = (await tower(api, rimeId)).slowFactor;
      moteId = await spawn(api, "mote", "left");
    },

    // 180 ticks = the old 3s cap. Polling every tick matters here: a Rime self-heats
    // as it fires, so the FIRST slowed instant is the one carrying the strongest slow,
    // and a coarse sweep would read a weaker slow a few shots later.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.slowed),
        { max: 180, poll: TICK },
      );
      m = await unit(api, moteId);
    },

    async assert(api, check) {
      check.expectOk("the cold Rime slowed the Mote", r.hit);

      // The published ceiling, read off the Rime while it is genuinely at H = 0.
      check.expectClose(
        "a cold Rime's slow ceiling is its full 0.55",
        coldCeiling,
        0.55,
        0.02,
      );

      // A Mote's base speed is 60; a ~0.5 slow leaves it around 30 or below.
      check.expectLt(
        "the slowed speed is well below the Mote's base speed",
        m.speed,
        60 * 0.5,
      );

      // The slow the surge actually took. A unit's `speed` "reflect[s] any active slow"
      // and "drops below its `baseSpeed` while a Rime slow is on it"
      // (specs/instrumentation.md), so a unit reporting `slowed` must already be
      // reporting the reduced speed. The tolerance admits one shot of self-heating,
      // per the note at the top of this file.
      check.expectClose(
        "the applied slow is the cold Rime's near-full ceiling",
        1 - m.speed / m.baseSpeed,
        0.55,
        0.05,
      );
    },
  };
}
