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

import {
  newGame,
  build,
  spawn,
  tower,
  unit,
  actTail,
  TICK,
} from "../_helpers.mjs";

// A Mote's base speed in px/s (specs/surge.md). Speeds do not scale with the wave
// (specs/gameplay.md), so this is exact for the wave-1 Mote spawned below.
const MOTE_BASE_SPEED = 60;

export default function item() {
  let rimeId;
  let coldCeiling;
  let moteId;
  let r;
  let m;

  return {
    id: "rime.cold-slows-most",

    // The Mote is slowed within a second of walking in, and the tail below is what puts
    // the reduced pace on screen. The ceiling stops a build that walks the Mote the long
    // way round from turning that into a ten-second clip.
    clipMs: 5500,

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
    //
    // The reading is taken the moment the slow lands, and then the drive runs on: a
    // slow is only visible as a CHANGE OF PACE, so a clip that stops on the tick the
    // Mote is first flagged `slowed` shows a Mote walking at its normal speed and
    // nothing else. The tail is what puts the crawl on screen.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.slowed),
        { max: 180, poll: TICK },
      );
      m = await unit(api, moteId);
      await actTail(api, 180); // 3 s — long enough to read the slowed pace as slow
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
        MOTE_BASE_SPEED * 0.5,
      );

      // The slow the surge actually took. A unit's `speed` "reflect[s] any active slow"
      // and "drops below its `baseSpeed` while a Rime slow is on it"
      // (specs/instrumentation.md), so a unit reporting `slowed` must already be
      // reporting the reduced speed. The tolerance admits one shot of self-heating,
      // per the note at the top of this file.
      //
      // Measured against the Mote's PUBLISHED base speed (60, specs/surge.md) and not
      // against the build's own `baseSpeed` read. The claim is how much speed the slow
      // removed, and dividing the build's `speed` by the build's `baseSpeed` cannot
      // state it: a build reporting both as 7 satisfies the ratio while its Mote crawls,
      // and one that omits `baseSpeed` yields NaN and fails the item for a missing field
      // rather than for an absent slow. Nothing scales the figure here — this is a
      // wave-1 Mote, and "speeds, bounties, and leak values do not scale"
      // (specs/gameplay.md) — so 60 is exact. Whether `baseSpeed` is reported at all is
      // `surge.stats`'s claim, and it is checked there.
      check.expectClose(
        "the applied slow is the cold Rime's near-full ceiling",
        1 - m.speed / MOTE_BASE_SPEED,
        0.55,
        0.05,
      );
    },
  };
}
