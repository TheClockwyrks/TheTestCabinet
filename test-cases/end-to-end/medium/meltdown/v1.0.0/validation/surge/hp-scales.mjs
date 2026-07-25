// Automated validation for the Surge sub-item `hp-scales`.
//
// A unit's HP scales up with the wave number (specs/gameplay.md — +62% per wave over
// wave 1), so a deep-wave unit is far tankier. A Mote is 40 HP at wave 1; at wave 6
// it is 40 * (1 + 0.62*5) = 164. We spawn a Mote on wave 1 and on wave 6 and compare.
//
// The wave has to be RUNNING for the unit to belong to it. `setWave(n)` "rebuilds the
// run to the build phase just before wave `n`" (specs/instrumentation.md), and in that
// build phase the current wave number is `n - 1` — the convention the snapshot spells
// out for the opening phase ("`wave`: 0 in the opening phase before wave 1"), and the
// one the wave PREVIEW rests on, since the coming wave it advertises is wave `n`.
// Spawning straight after `setWave(6)` therefore yields a wave-FIVE unit (139.2 HP),
// and asserting 164 on it fails a build whose scaling is exactly right. So each sample
// releases the wave first, and the expectation is computed from the wave the snapshot
// actually reports rather than hardcoded, so the two cannot drift apart.

import { newGame, spawn, unit } from "../_helpers.mjs";

// specs/gameplay.md: a unit's HP is its base HP times `1 + 0.62 * (w - 1)`.
const BASE_MOTE_HP = 40;
const scaledHp = (wave) => BASE_MOTE_HP * (1 + 0.62 * (wave - 1));

// Pose the run so that wave `wave` is the one RUNNING, and read back a freshly spawned
// Mote alongside the wave the game says it is on.
//
// Where `setWave(n)` leaves the counter is read back rather than assumed. The spec says
// it "sets the current wave AND rebuilds the run to the build phase just before wave
// `n`" — which admits two honest readings: land on wave `n` directly, or land in the
// build phase ahead of it with the counter still at `n - 1` (the convention the
// snapshot states for the opening phase, where `wave` is 0 before wave 1). Both are
// conformant, so the wave is released only if the pose has not already arrived, and the
// caller asserts the counter landed where it wanted. Hardcoding either reading fails
// half of the conformant builds.
async function spawnOnWave(api, wave) {
  await api.call("setWave", wave);
  if ((await api.snapshot()).wave !== wave) await api.call("startWave");
  const id = await spawn(api, "mote", "left");
  return { wave: (await api.snapshot()).wave, mote: await unit(api, id) };
}

export default function item() {
  let w1;
  let w6;

  return {
    id: "surge.hp-scales",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
    },

    // The same unit type spawned on two different waves. The scaling is applied at
    // spawn, so no fresh match is needed between the two.
    async act(api) {
      w1 = await spawnOnWave(api, 1);
      w6 = await spawnOnWave(api, 6);

      await api.settle(80);
      await api.screenshot("scale");
    },

    async assert(api, check) {
      // Guard the premise: if the wave was not actually posed, the HP readings below
      // are about some other wave and their labels would be misleading.
      check.expectEq("the run was posed on wave 1", w1.wave, 1);
      check.expectEq("the run was posed on wave 6", w6.wave, 6);

      check.expectClose(
        `a wave-${w1.wave} Mote has base HP (${scaledHp(w1.wave)})`,
        w1.mote.maxHp,
        scaledHp(w1.wave),
        0.5,
      );
      check.expectClose(
        `a wave-${w6.wave} Mote has scaled HP (${scaledHp(w6.wave)})`,
        w6.mote.maxHp,
        scaledHp(w6.wave),
        0.5,
      );
      check.expectGt(
        "HP scales up with the wave",
        w6.mote.maxHp,
        w1.mote.maxHp,
      );
    },
  };
}
